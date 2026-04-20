const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const fetch = require('node-fetch');
const db = require('../db/database');
const config = require('../../config');

const CACHE_DIR = path.join(__dirname, '../../cache/papers');

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').substring(0, 80);
}

function getCachedPaper(paperId) {
  return db.queryOne('SELECT * FROM cached_papers WHERE paper_id = ?', [paperId]);
}

function getAllCachedPapers() {
  return db.queryAll('SELECT cp.*, p.title, p.arxiv_id FROM cached_papers cp JOIN papers p ON cp.paper_id = p.id');
}

async function downloadPaper(paper) {
  if (!paper.arxiv_id || !paper.title) {
    return { success: false, msg: 'missing arxiv_id or title' };
  }

  ensureCacheDir();

  const existing = getCachedPaper(paper.id);
  if (existing) {
    return { success: true, msg: 'already cached', file_path: existing.file_path };
  }

  const pdfUrl = `https://arxiv.org/pdf/${paper.arxiv_id}.pdf`;
  const safeTitle = sanitizeFilename(paper.title);
  const fileName = `${paper.arxiv_id}_${safeTitle}.pdf`;
  const filePath = path.join(CACHE_DIR, fileName);

  console.log(`[Cache] Downloading #${paper.id}: ${paper.arxiv_id}`);

  try {
    const res = await fetch(pdfUrl, {
      timeout: config.CACHE?.DOWNLOAD_TIMEOUT_MS || (5 * 60 * 1000),
      headers: {
        'user-agent': config.CACHE?.USER_AGENT || 'Mozilla/5.0'
      }
    });
    if (!res.ok) {
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
      INSERT INTO cached_papers (paper_id, file_path, file_size, preview_image)
      VALUES (?, ?, ?, ?)
    `, [paper.id, filePath, buffer.length, previewPath]);

    if (previewPath) {
      const previewUrl = `/api/papers/${paper.id}/preview`;
      db.runQuery('UPDATE cached_papers SET preview_image = ? WHERE paper_id = ?', [previewPath, paper.id]);
      db.runQuery('UPDATE papers SET preview_image = ? WHERE id = ?', [previewUrl, paper.id]);
    }

    return { success: true, msg: 'cached', file_path: filePath, preview: !!previewPath };
  } catch (e) {
    console.error('[Cache] Download failed:', e.message);
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
    if (fs.existsSync(cached.file_path)) {
      fs.unlinkSync(cached.file_path);
    }
    db.runQuery('DELETE FROM cached_papers WHERE paper_id = ?', [paperId]);
    db.runQuery('UPDATE papers SET preview_image = NULL WHERE id = ?', [paperId]);
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

    const previewUrl = previewPath ? `/api/papers/${paperId}/preview` : null;
    db.runQuery('UPDATE cached_papers SET preview_image = ? WHERE paper_id = ?', [previewPath, paperId]);
    db.runQuery('UPDATE papers SET preview_image = ? WHERE id = ?', [previewUrl, paperId]);

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

module.exports = {
  getCachedPaper,
  getAllCachedPapers,
  downloadPaper,
  deleteCachedPaper,
  regeneratePreview,
  regenerateAllPreviews,
  CACHE_DIR
};
