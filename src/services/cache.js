const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const fetch = require('node-fetch');
const db = require('../db/database');
const config = require('../../config');
const { BackgroundService } = require('./backgroundService');

const CACHE_DIR = path.join(__dirname, '../../cache/papers');

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').substring(0, 80);
}

function findCachedFile(arxivId) {
  if (!fs.existsSync(CACHE_DIR)) return null;
  const files = fs.readdirSync(CACHE_DIR);
  for (const file of files) {
    if (file.startsWith(arxivId + '_') && file.endsWith('.pdf')) {
      return path.join(CACHE_DIR, file);
    }
  }
  return null;
}

function getCachedPaper(paperId) {
  return db.queryOne('SELECT * FROM cached_papers WHERE paper_id = ?', [paperId]);
}

function getAllCachedPapers() {
  return db.queryAll('SELECT cp.*, p.title, p.arxiv_id FROM cached_papers cp JOIN papers p ON cp.paper_id = p.id');
}

function getFailedCachedPapers() {
  return db.queryAll('SELECT cp.*, p.title, p.arxiv_id FROM cached_papers cp JOIN papers p ON cp.paper_id = p.id WHERE cp.status = ?', ['failed']);
}

async function downloadPaper(paper) {
  if (!paper.arxiv_id || !paper.title) {
    return { success: false, msg: 'missing arxiv_id or title' };
  }

  ensureCacheDir();

  const existing = getCachedPaper(paper.id);
  if (existing && existing.status === 'completed') {
    return { success: true, msg: 'already cached', file_path: existing.file_path };
  }

  const reuseExisting = config.BG_WORKER?.REUSE_CACHED_PAPERS !== false;
  const existingFile = reuseExisting ? findCachedFile(paper.arxiv_id) : null;

  if (existingFile && fs.existsSync(existingFile)) {
    console.log(`[Cache] Reusing existing file for #${paper.id}: ${paper.arxiv_id}`);
    const fileSize = fs.statSync(existingFile).size;
    const previewPath = path.join(CACHE_DIR, 'previews', `${paper.id}_preview.png`);
    const hasPreview = fs.existsSync(previewPath);

    if (existing) {
      db.runQuery(`UPDATE cached_papers SET file_path = ?, file_size = ?, preview_image = ?, status = 'completed' WHERE paper_id = ?`, [existingFile, fileSize, hasPreview ? previewPath : null, paper.id]);
    } else {
      db.runQuery(`INSERT INTO cached_papers (paper_id, file_path, file_size, preview_image, status) VALUES (?, ?, ?, ?, 'completed')`, [paper.id, existingFile, fileSize, hasPreview ? previewPath : null]);
    }
    return { success: true, msg: 'reuse cached', file_path: existingFile, preview: hasPreview };
  }

  const pdfUrl = `https://arxiv.org/pdf/${paper.arxiv_id}.pdf`;
  const safeTitle = sanitizeFilename(paper.title);
  const fileName = `${paper.arxiv_id}_${safeTitle}.pdf`;
  const filePath = path.join(CACHE_DIR, fileName);

  console.log(`[Cache] Downloading #${paper.id}: ${paper.arxiv_id}`);

  db.runQuery(`INSERT OR IGNORE INTO cached_papers (paper_id, file_path, file_size, status) VALUES (?, '', 0, 'downloading')`, [paper.id]);
  db.runQuery(`UPDATE cached_papers SET status = 'downloading', error_message = NULL WHERE paper_id = ?`, [paper.id]);

  try {
    const res = await fetch(pdfUrl, {
      timeout: config.CACHE?.DOWNLOAD_TIMEOUT_MS || (5 * 60 * 1000),
      headers: {
        'user-agent': config.CACHE?.USER_AGENT || 'Mozilla/5.0'
      }
    });
    if (!res.ok) {
      db.runQuery(`UPDATE cached_papers SET status = 'failed', error_message = ? WHERE paper_id = ?`, [`HTTP ${res.status}`, paper.id]);
      return { success: false, msg: `HTTP ${res.status}` };
    }

    const buffer = await res.buffer();
    fs.writeFileSync(filePath, buffer);

    const previewImage = await extractPreview(filePath);
    let previewPath = null;
    if (previewImage) {
      const previewDir = path.join(CACHE_DIR, 'previews');
      if (!fs.existsSync(previewDir)) fs.mkdirSync(previewDir, { recursive: true });
      previewPath = path.join(previewDir, `${paper.id}_preview.png`);
      fs.writeFileSync(previewPath, previewImage);
    }

    db.runQuery(`
      UPDATE cached_papers SET file_path = ?, file_size = ?, preview_image = ?, status = 'completed' WHERE paper_id = ?
    `, [filePath, buffer.length, previewPath, paper.id]);

    return { success: true, msg: 'cached', file_path: filePath, preview: !!previewPath };
  } catch (e) {
    console.error('[Cache] Download failed:', e.message);
    db.runQuery(`UPDATE cached_papers SET status = 'failed', error_message = ? WHERE paper_id = ?`, [e.message, paper.id]);
    return { success: false, msg: e.message };
  }
}

async function extractPreview(pdfPath) {
  try {
    const previewDir = path.join(path.dirname(pdfPath), 'previews');
    if (!fs.existsSync(previewDir)) {
      fs.mkdirSync(previewDir, { recursive: true });
    }

    const baseName = path.basename(pdfPath, '.pdf');
    const outputPrefix = path.join(previewDir, baseName);

    execSync(`pdftoppm -png -singlefile -f 1 -l 1 "${pdfPath}" "${outputPrefix}"`, { timeout: config.CACHE?.PREVIEW_TIMEOUT_MS || 30000 });

    const pngFile = `${outputPrefix}.png`;
    if (fs.existsSync(pngFile)) {
      const imageBuffer = fs.readFileSync(pngFile);
      fs.unlinkSync(pngFile);
      return imageBuffer;
    }
  } catch (e) {
    console.log('[Cache] Preview extraction failed:', e.message);
  }
  return null;
}

function deleteCachedPaper(paperId) {
  const cached = getCachedPaper(paperId);
  if (!cached) return false;

  try {
    if (cached.file_path && fs.existsSync(cached.file_path)) {
      fs.unlinkSync(cached.file_path);
    }
    db.runQuery('DELETE FROM cached_papers WHERE paper_id = ?', [paperId]);
    return true;
  } catch (e) {
    console.error('[Cache] Delete failed:', e.message);
    return false;
  }
}

async function regeneratePreview(paperId) {
  const cached = getCachedPaper(paperId);
  if (!cached || !cached.file_path || !fs.existsSync(cached.file_path)) {
    return { success: false, msg: 'cached file not found' };
  }

  console.log(`[Cache] Regenerating preview for #${paperId}`);

  try {
    const previewImage = await extractPreview(cached.file_path);
    let previewPath = null;
    if (previewImage) {
      const previewDir = path.join(CACHE_DIR, 'previews');
      if (!fs.existsSync(previewDir)) fs.mkdirSync(previewDir, { recursive: true });
      previewPath = path.join(previewDir, `${paperId}_preview.png`);
      fs.writeFileSync(previewPath, previewImage);
    }

    db.runQuery('UPDATE cached_papers SET preview_image = ? WHERE paper_id = ?', [previewPath, paperId]);

    return { success: true, preview: !!previewPath };
  } catch (e) {
    console.error('[Cache] Regenerate failed:', e.message);
    return { success: false, msg: e.message };
  }
}

async function regenerateAllPreviews() {
  const cached = getAllCachedPapers();
  console.log(`[Cache] Regenerating previews for ${cached.length} cached papers`);

  const results = [];
  for (const c of cached) {
    const result = await regeneratePreview(c.paper_id);
    results.push({ paper_id: c.paper_id, ...result });
  }
  return results;
}

class CacheBackgroundService extends BackgroundService {
  constructor(options = {}) {
    super('cache', {
      label: 'Cache PDF',
      enabled: options.enabled !== false,
      intervalMs: options.intervalMs || 0,
      initialDelayMs: options.initialDelayMs || config.BG_WORKER?.DELAY_MS + 5000,
    });
    this.limit = options.limit || 20;
    this.batchDelayMs = options.batchDelayMs || config.BG_WORKER?.AUTO_CACHE_DELAY_MS || 30000;
    this.maxBatches = options.maxBatches || config.BG_WORKER?.AUTO_CACHE_MAX_BATCHES || 10;
    this.processDelayMs = options.processDelayMs || 1000;
  }

  _getPapersToCache(limit) {
    return db.queryAll(`
      SELECT p.*, cp.id as cached_id, cp.file_path as cached_path
      FROM papers p
      LEFT JOIN cached_papers cp ON p.id = cp.paper_id
      WHERE p.arxiv_id IS NOT NULL AND p.arxiv_id != ''
      AND (cp.id IS NULL OR cp.status = 'failed')
      ORDER BY cp.id ASC NULLS FIRST, p.priority DESC, p.id DESC
      LIMIT ?
    `, [limit]);
  }

  async hasPending() {
    const papers = this._getPapersToCache(1);
    return papers.length > 0;
  }

  async execute() {
    if (!config.BG_WORKER?.AUTO_CACHE_FOR_ALL_PAPERS) {
      const papers = this._getPapersToCache(this.limit);
      console.log(`[${this.label}] Found ${papers.length} papers to cache`);

      for (const paper of papers) {
        try {
          const result = await downloadPaper(paper);
          if (result.success) this.status.processed++;
          else this.status.errors++;
        } catch (e) {
          this.status.errors++;
          console.error(`[${this.label}] Error #${paper.id}:`, e.message);
        }
        await this.yieldIfNeeded();
        await new Promise(r => setTimeout(r, this.processDelayMs)).catch(() => {});
      }
    } else {
      console.log(`[${this.label}] Auto-cache mode: fetching up to ${this.maxBatches} batches with ${this.batchDelayMs}ms delay`);

      for (let batch = 0; batch < this.maxBatches; batch++) {
        const papers = this._getPapersToCache(this.limit);
        if (papers.length === 0) {
          console.log(`[${this.label}] No more papers to cache`);
          break;
        }

        console.log(`[${this.label}] Batch ${batch + 1}/${this.maxBatches}: ${papers.length} papers`);

        for (const paper of papers) {
          try {
            const result = await downloadPaper(paper);
            if (result.success) this.status.processed++;
            else this.status.errors++;
          } catch (e) {
            this.status.errors++;
            console.error(`[${this.label}] Error #${paper.id}:`, e.message);
          }
          await this.yieldIfNeeded();
          await new Promise(r => setTimeout(r, this.processDelayMs)).catch(() => {});
        }

        if (batch < this.maxBatches - 1) {
          console.log(`[${this.label}] Waiting ${this.batchDelayMs}ms before next batch...`);
          await this._yield();
          await new Promise(r => setTimeout(r, this.batchDelayMs)).catch(() => {});
        }
      }
    }

    console.log(`[${this.label}] Done: ${this.status.processed} cached, ${this.status.errors} errors`);
  }
}

module.exports = {
  getCachedPaper,
  getAllCachedPapers,
  downloadPaper,
  deleteCachedPaper,
  regeneratePreview,
  regenerateAllPreviews,
  CACHE_DIR,
  CacheBackgroundService,
};