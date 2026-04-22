const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const fetch = require('node-fetch');
const db = require('../db/database');
const config = require('../../config');
const { BackgroundService } = require('./backgroundService');

const CACHE_DIR = config.CACHE?.DIR || undefined;
if (!CACHE_DIR) {
  throw new Error('CACHE_DIR is not configured');
}
const PDF_DIR = path.join(CACHE_DIR, config.CACHE?.PDF_SUBDIR || 'papers');
const PREVIEW_DIR = path.join(CACHE_DIR, config.CACHE?.PREVIEW_SUBDIR || 'papers/previews');

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });
  if (!fs.existsSync(PREVIEW_DIR)) fs.mkdirSync(PREVIEW_DIR, { recursive: true });
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').substring(0, 80);
}

function findCachedFile(arxivId) {
  if (!fs.existsSync(PDF_DIR)) return null;
  const files = fs.readdirSync(PDF_DIR);
  for (const file of files) {
    if (file.startsWith(arxivId + '_') && file.endsWith('.pdf')) {
      return path.join(PDF_DIR, file);
    }
  }
  return null;
}

function backfillExistingCachedPapers() {
  if (!config.BG_WORKER?.REUSE_CACHED_PAPERS) {
    console.debug('[Cache] REUSE_CACHED_PAPERS disabled, skipping backfill');
    return;
  }

  if (!fs.existsSync(PDF_DIR)) {
    console.debug('[Cache] PDF_DIR does not exist, skipping backfill');
    return;
  }

  const files = fs.readdirSync(PDF_DIR).filter(f => f.endsWith('.pdf'));
  console.log(`[Cache] Backfilling ${files.length} cached files...`);

  let count = 0;
  for (const file of files) {
    const arxivId = file.split('_')[0];
    if (!arxivId) continue;

    const paper = db.queryOne('SELECT id FROM papers WHERE arxiv_id = ?', [arxivId]);
    if (!paper) {
      console.debug(`[Cache] Backfill: no paper found for arxiv ${arxivId}`);
      continue;
    }

    const existing = getCachedPaper(paper.id);
    if (existing) {
      console.debug(`[Cache] Backfill: paper #${paper.id} already in cached_papers`);
      continue;
    }

    const filePath = path.join(PDF_DIR, file);
    const fileSize = fs.statSync(filePath).size;

    console.debug(`[Cache] Backfill INSERT: paper_id=${paper.id}, file=${filePath}, size=${fileSize}`);
    db.runQuery(
      `INSERT OR IGNORE INTO cached_papers (paper_id, file_path, file_size, status) VALUES (?, ?, ?, 'completed')`,
      [paper.id, filePath, fileSize]
    );
    count++;
  }

  console.log(`[Cache] Backfilled ${count} cached papers`);
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
  console.debug(`[Cache] getCachedPaper(#${paper.id}):`, existing);

  if (existing && existing.status === 'completed') {
    return { success: true, msg: 'already cached', file_path: existing.file_path };
  }

  const reuseExisting = config.BG_WORKER?.REUSE_CACHED_PAPERS !== false;
  const existingFile = reuseExisting ? findCachedFile(paper.arxiv_id) : null;
  // console.debug(`[Cache] reuseExisting=${reuseExisting}, existingFile=${existingFile}`);

  if (existingFile && fs.existsSync(existingFile)) {
    console.log(`[Cache] Reusing existing file for #${paper.id}: ${paper.arxiv_id}`);
    const fileSize = fs.statSync(existingFile).size;
    const existingFileName = path.basename(existingFile);
    const previewFileName = `${paper.id}_preview.png`;
    const previewFullPath = path.join(PREVIEW_DIR, previewFileName);
    const hasPreview = fs.existsSync(previewFullPath);

    // console.debug(`[Cache] existing=${!!existing}, fileSize=${fileSize}, hasPreview=${hasPreview}`);

    if (existing) {
      // console.debug(`[Cache] UPDATE cached_papers for #${paper.id}`);
      db.runQuery(`UPDATE cached_papers SET file_path = ?, file_size = ?, preview_image = ?, status = 'completed' WHERE paper_id = ?`, [existingFileName, fileSize, hasPreview ? previewFileName : null, paper.id]);
    } else {
      // console.debug(`[Cache] INSERT into cached_papers: paper_id=${paper.id}, file=${existingFileName}, size=${fileSize}`);
      db.runQuery(`INSERT INTO cached_papers (paper_id, file_path, file_size, preview_image, status) VALUES (?, ?, ?, ?, 'completed')`, [paper.id, existingFileName, fileSize, hasPreview ? previewFileName : null]);
    }
    return { success: true, msg: 'reuse cached', file_path: existingFile, preview: hasPreview };
  }

  const pdfUrl = `https://arxiv.org/pdf/${paper.arxiv_id}.pdf`;
  const safeTitle = sanitizeFilename(paper.title);
  const fileName = `${paper.arxiv_id}_${safeTitle}.pdf`;
  const filePath = path.join(PDF_DIR, fileName);

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

    db.runQuery(`
      UPDATE cached_papers SET file_path = ?, file_size = ?, status = 'completed' WHERE paper_id = ?
    `, [fileName, buffer.length, paper.id]);

    return { success: true, msg: 'cached', file_path: filePath, preview: null };
  } catch (e) {
    console.error('[Cache] Download failed:', e.message);
    db.runQuery(`UPDATE cached_papers SET status = 'failed', error_message = ? WHERE paper_id = ?`, [e.message, paper.id]);
    return { success: false, msg: e.message };
  }
}

async function extractPreview(pdfPath, paperId) {
  try {
    const { ensurePreviewImage } = require('./layoutAnalysis');
    return await ensurePreviewImage(paperId);
  } catch (e) {
    console.log('[Cache] Preview extraction failed:', e.message);
  }
  return null;
}

function deleteCachedPaper(paperId) {
  const cached = getCachedPaper(paperId);
  if (!cached) return false;

  try {
    const fullPath = path.join(PDF_DIR, cached.file_path);
    if (cached.file_path && fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
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
  if (!cached || !cached.file_path) {
    return { success: false, msg: 'cached file not found' };
  }
  
  const fullPath = path.join(PDF_DIR, cached.file_path);
  if (!fs.existsSync(fullPath)) {
    return { success: false, msg: 'cached file not found' };
  }

  console.log(`[Cache] Regenerating preview for #${paperId}`);

  try {
    const { ensurePreviewImage } = require('./layoutAnalysis');
    const result = await ensurePreviewImage(paperId);
    return result;
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
  }

  _getPapersToCache() {
    return db.queryAll(`
      SELECT p.*, cp.id as cached_id, cp.file_path as cached_path
      FROM papers p
      LEFT JOIN cached_papers cp ON p.id = cp.paper_id
      WHERE p.arxiv_id IS NOT NULL AND p.arxiv_id != ''
      AND (cp.id IS NULL OR cp.status = 'failed')
      ORDER BY cp.id ASC NULLS FIRST, p.priority DESC, p.id DESC
    `);
  }

  async hasPending() {
    const papers = this._getPapersToCache();
    return papers.length > 0;
  }

  async execute() {
    const papers = this._getPapersToCache();
    console.debug(`[${this.label}] Found ${papers.length} papers to cache`);

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
    }

    console.debug(`[${this.label}] Done: ${this.status.processed} cached, ${this.status.errors} errors`);
  }
}

module.exports = {
  getCachedPaper,
  getAllCachedPapers,
  downloadPaper,
  deleteCachedPaper,
  regeneratePreview,
  regenerateAllPreviews,
  backfillExistingCachedPapers,
  CACHE_DIR,
  PDF_DIR,
  PREVIEW_DIR,
  CacheBackgroundService,
};