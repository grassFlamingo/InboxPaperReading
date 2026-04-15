const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
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
    const res = await fetch(pdfUrl, { timeout: 60000 });
    if (!res.ok) {
      return { success: false, msg: `HTTP ${res.status}` };
    }

    const buffer = await res.buffer();
    fs.writeFileSync(filePath, buffer);

    const previewImage = await extractPreview(filePath);
    let previewBase64 = null;
    if (previewImage) {
      previewBase64 = `data:image/png;base64,${previewImage.toString('base64')}`;
    }

    const pageInfo = await extractTitleLocation(filePath);

    db.runQuery(`
      INSERT INTO cached_papers (paper_id, file_path, file_size, preview_image)
      VALUES (?, ?, ?, ?)
    `, [paper.id, filePath, buffer.length, previewBase64]);

    if (previewBase64 || pageInfo) {
      db.runQuery('UPDATE papers SET preview_image = ?, title_location = ? WHERE id = ?', 
        [previewBase64, pageInfo ? JSON.stringify(pageInfo) : null, paper.id]);
    }

    return { success: true, msg: 'cached', file_path: filePath, preview: !!previewBase64, title_location: pageInfo };
  } catch (e) {
    console.error('[Cache] Download failed:', e.message);
    return { success: false, msg: e.message };
  }
}

async function extractTitleLocation(pdfPath) {
  try {
    const { execSync } = require('child_process');
    const result = execSync(`python3 -c "
from pdfminer.high_level import extract_text, extract_pages
from pdfminer.layout import LTTextContainer, LTChar, LTAnno, LAParams
import json
import re

laparams = LAParams(line_margin=0.5, word_margin=0.1, char_margin=2.0)
text = extract_text('${pdfPath.replace(/'/g, "'\\''")}', laparams=laparams)

lines = [l.strip() for l in text.split('\\n') if l.strip()]

result = {'first_lines': lines[:10], 'title_location': None}

# Find title: first line that's not email/doi/arXiv related, has reasonable length
for i, line in enumerate(lines[:8]):
    if len(line) > 15 and len(line) < 300:
        # Skip lines with common non-title patterns
        lower = line.lower()
        if any(x in lower for x in ['@', 'http', 'doi', 'arxiv:', 'email', 'university', 'department']):
            continue
        # Title often has mixed case or specific patterns
        if not line.isupper() and not line.islower():
            result['title_location'] = {'line': i, 'text': line[:150], 'y_ratio': i * 0.12}
            break
        elif len(line) > 30:
            result['title_location'] = {'line': i, 'text': line[:150], 'y_ratio': i * 0.12}
            break

print(json.dumps(result))
"`, { timeout: 30000, encoding: 'utf8' });

    const info = JSON.parse(result.trim());
    console.log(`[Cache] Title: line ${info.title_location?.line}: ${info.title_location?.text?.substring(0, 50)}`);
    return info.title_location;
  } catch (e) {
    console.log('[Cache] Title extraction failed:', e.message);
    return null;
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

    execSync(`pdftoppm -png -singlefile -f 1 -l 1 "${pdfPath}" "${outputPrefix}"`, { timeout: 30000 });

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
    let previewBase64 = null;
    if (previewImage) {
      previewBase64 = `data:image/png;base64,${previewImage.toString('base64')}`;
    }

    const pageInfo = await extractTitleLocation(cached.file_path);

    db.runQuery('UPDATE cached_papers SET preview_image = ? WHERE paper_id = ?', [previewBase64, paperId]);
    db.runQuery('UPDATE papers SET preview_image = ?, title_location = ? WHERE id = ?', 
      [previewBase64, pageInfo ? JSON.stringify(pageInfo) : null, paperId]);

    return { success: true, preview: !!previewBase64, title_location: pageInfo };
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
