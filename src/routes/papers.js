const db = require('../db/database');
const path = require('path');
const fs = require('fs');
const { fetchUrlText, detectSourceType } = require('../services/web');
const { callLlm, cleanThinkTags } = require('../services/llm');
const config = require('../../config');
const emailSync = require('../services/email');
const { startEmailSync, getSyncStatus } = require('../services/email');
const { buildGlossary } = require('./techterms');
const cacheService = require('../services/cache');
const { CACHE_DIR, PDF_DIR } = require('../services/cache');

function getPreviewUrl(cachedPreviewPath, paperId) {
  if (!cachedPreviewPath || cachedPreviewPath.startsWith('data:')) return null;
  return `/api/papers/${paperId}/preview`;
}

function setupPaperRoutes(app) {
  // GET /api/papers/:id - Get single paper (must be before /api/papers to avoid "papers" being captured as :id)
  app.get('/api/papers/:id', (req, res) => {
    const { id } = req.params;
    const row = db.queryOne('SELECT p.*, cp.file_path as cached_file_path, cp.preview_image as cached_preview_path, cp.layout_data FROM papers p LEFT JOIN cached_papers cp ON p.id = cp.paper_id WHERE p.id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'not found' });
    row.cached_preview_path = getPreviewUrl(row.cached_preview_path, row.id);
    res.json(row);
  });

  // GET /api/papers - List papers with filters and pagination
  app.get('/api/papers', (req, res) => {
    const { category, status, q, sort = 'priority', offset = 0, limit = 50, cached } = req.query;
    let query = 'SELECT p.*, cp.file_path as cached_file_path, cp.preview_image as cached_preview_path, cp.layout_data FROM papers p LEFT JOIN cached_papers cp ON p.id = cp.paper_id WHERE p.status != ?';
    let countQuery = 'SELECT COUNT(*) as total FROM papers p WHERE p.status != ?';
    const params = ['done'];
    const countParams = ['done'];

    if (category) { query += ' AND p.category = ?'; countQuery += ' AND p.category = ?'; params.push(category); countParams.push(category); }
    if (status) { query += ' AND p.status = ?'; countQuery += ' AND p.status = ?'; params.push(status); countParams.push(status); }
    if (q) { query += ' AND (p.title LIKE ? OR p.authors LIKE ? OR p.abstract LIKE ? OR p.tags LIKE ?)'; countQuery += ' AND (p.title LIKE ? OR p.authors LIKE ? OR p.abstract LIKE ? OR p.tags LIKE ?)'; const qparam = `%${q}%`; params.push(qparam, qparam, qparam, qparam); countParams.push(qparam, qparam, qparam, qparam); }
    if (cached === 'cached') { query += ' AND cp.paper_id IS NOT NULL'; countQuery += ' AND p.id IN (SELECT paper_id FROM cached_papers)'; }
    else if (cached === 'uncached') { query += ' AND cp.paper_id IS NULL'; countQuery += ' AND p.id NOT IN (SELECT paper_id FROM cached_papers)'; }

    if (sort === 'date') query += ' ORDER BY p.created_at DESC';
    else if (sort === 'date_asc') query += ' ORDER BY p.created_at ASC';
    else if (sort === 'title') query += ' ORDER BY p.title ASC';
    else if (sort === 'title_asc') query += ' ORDER BY p.title DESC';
    else if (sort === 'stars') query += ' ORDER BY p.stars DESC, p.id ASC';
    else if (sort === 'stars_asc') query += ' ORDER BY p.stars ASC, p.id ASC';
    else if (sort === 'priority_asc') query += ' ORDER BY p.priority ASC, p.id ASC';
    else query += ' ORDER BY CASE p.status WHEN \'reading\' THEN 0 WHEN \'unread\' THEN 1 ELSE 2 END, p.priority DESC, p.id ASC';

    const parsedLimit = Math.min(parseInt(limit) || 50, 100);
    const parsedOffset = parseInt(offset) || 0;

    const total = db.queryOne(countQuery, countParams).total;

    query += ` LIMIT ${parsedLimit} OFFSET ${parsedOffset}`;
    const rows = db.queryAll(query, params);

    const papers = rows.map(row => ({
      ...row,
      cached_preview_path: getPreviewUrl(row.cached_preview_path, row.id)
    }));

    res.json({ papers, total, offset: parsedOffset, limit: parsedLimit, hasMore: parsedOffset + rows.length < total });
  });

  // POST /api/papers - Add paper
  app.post('/api/papers', (req, res) => {
    const d = req.body;
    const lastId = db.runQuery(`
      INSERT INTO papers (title, authors, abstract, source, source_url, arxiv_id, arxiv_version, category, priority, status, tags, notes, source_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [d.title || '', d.authors || '', d.abstract || '', d.source || '', d.source_url || '', d.arxiv_id || '', d.arxiv_version || null, d.category || '其他', d.priority ?? 3, d.status || 'unread', d.tags || '', d.notes || '', d.source_type || 'paper']);
    res.status(201).json({ id: lastId, message: 'added' });
  });

  // GET /api/papers/:id - Get single paper
  app.get('/api/papers/:id', (req, res) => {
    const { id } = req.params;
    const row = db.queryOne('SELECT p.*, cp.file_path as cached_file_path, cp.preview_image as cached_preview_path, cp.layout_data FROM papers p LEFT JOIN cached_papers cp ON p.id = cp.paper_id WHERE p.id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'not found' });
    row.cached_preview_path = getPreviewUrl(row.cached_preview_path, row.id);
    res.json(row);
  });

  // PUT /api/papers/:id - Update paper
  app.put('/api/papers/:id', (req, res) => {
    const { id } = req.params;
    const fields = ['title', 'authors', 'abstract', 'source', 'source_url', 'arxiv_id', 'arxiv_version', 'category', 'priority', 'status', 'tags', 'notes', 'ai_category', 'stars', 'user_rating', 'source_type'];
    const sets = [], vals = [];
    for (const f of fields) {
      if (f in req.body) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'nothing to update' });
    sets.push('updated_at = CURRENT_TIMESTAMP');
    vals.push(id);
    db.runQuery(`UPDATE papers SET ${sets.join(', ')} WHERE id = ?`, vals);
    const row = db.queryOne('SELECT p.*, cp.file_path as cached_file_path, cp.preview_image as cached_preview_path, cp.layout_data FROM papers p LEFT JOIN cached_papers cp ON p.id = cp.paper_id WHERE p.id = ?', [id]);
    row.cached_preview_path = getPreviewUrl(row.cached_preview_path, row.id);
    res.json(row);
  });

  // DELETE /api/papers/:id
  app.delete('/api/papers/:id', (req, res) => {
    const { id } = req.params;
    try {
      db.runQuery('DELETE FROM cached_papers WHERE paper_id = ?', [id]);
      db.runQuery('DELETE FROM tech_terms WHERE source_paper_id = ?', [id]);
      db.runQuery('DELETE FROM papers WHERE id = ?', [id]);
      res.json({ id, message: 'deleted' });
    } catch (e) {
      console.error('[Papers] Delete error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/papers/:id/markdown - Get markdown content
  app.get('/api/papers/:id/markdown', (req, res) => {
    const paper = db.queryOne('SELECT markdown_content, source_url FROM papers WHERE id = ?', [req.params.id]);
    if (!paper) return res.status(404).json({ error: 'not found' });
    res.json({ markdown: paper.markdown_content || '', source_url: paper.source_url });
  });

  // GET /api/categories
  app.get('/api/categories', (req, res) => {
    const rows = db.queryAll(`SELECT category, COUNT(*) as count FROM papers GROUP BY category ORDER BY MIN(priority) DESC`);
    res.json(rows);
  });

  // GET /api/stats
  app.get('/api/stats', (req, res) => {
    const total = db.queryOne('SELECT COUNT(*) as c FROM papers').c;
    const unread = db.queryOne("SELECT COUNT(*) as c FROM papers WHERE status='unread'").c;
    const reading = db.queryOne("SELECT COUNT(*) as c FROM papers WHERE status='reading'").c;
    const done = db.queryOne("SELECT COUNT(*) as c FROM papers WHERE status='done'").c;
    const cached = db.queryOne("SELECT COUNT(*) as c FROM cached_papers").c;
    const cachedCompleted = db.queryOne("SELECT COUNT(*) as c FROM cached_papers WHERE status='completed'").c;
    const cachedFailed = db.queryOne("SELECT COUNT(*) as c FROM cached_papers WHERE status='failed'").c;
    const cachedDownloading = db.queryOne("SELECT COUNT(*) as c FROM cached_papers WHERE status='downloading'").c;
    res.json({ total, unread, reading, done, cached, cachedCompleted, cachedFailed, cachedDownloading });
  });

  // POST /api/import-url - Import from URL with LLM extraction
  app.post('/api/import-url', async (req, res) => {
    const { url, priority, category, tags, notes } = req.body || {};
    if (!url || !url.trim()) return res.status(400).json({ error: 'url is required' });

    const sourceType = detectSourceType(url);
    let pageText;
    try { pageText = await fetchUrlText(url, 5000); } 
    catch (e) { return res.status(502).json({ error: `Failed to fetch URL: ${e.message}` }); }

    if (!pageText || pageText.length < 50) {
      return res.status(502).json({ error: 'Failed to fetch page content. Try using the abstract URL instead of PDF URL.' });
    }

    const sourceTypeNames = { 'paper': '论文', 'wechat_article': '微信文章', 'twitter_thread': '推文', 'blog_post': '博客', 'video': '视频', 'other': '文章' };
    const systemPrompt = `你是一个信息提取助手，专门从${sourceTypeNames[sourceType] || '文章'}页面文本中提取关键信息。
请从以下页面文本中提取信息，按 JSON 格式输出，字段说明：
- title: 文章/推文/论文的完整标题（必填）
- authors: 作者或发布者（多人用逗号分隔）
- abstract: 核心内容摘要，200-400 字中文（必填）
- category: 内容方向
- tags: 3-6 个关键词，逗号分隔
- stars_suggest: 推荐程度 1-5
IMPORTANT: Do NOT use <think/> tags. Reply directly with JSON only.`;

    let extracted;
    try {
      const glossary = buildGlossary(pageText);
      const llmRaw = await callLlm(systemPrompt, `URL: ${url}\n\n页面内容：\n${pageText}`, 500, glossary);
      const jsonMatch = llmRaw.match(/\{[\s\S]+?\}(?=\s*$|\s*\n)/) || llmRaw.match(/\{[\s\S]+\}/);
      if (!jsonMatch) return res.status(500).json({ error: 'LLM did not return valid JSON', raw: llmRaw.substring(0, 300) });
      extracted = JSON.parse(jsonMatch[0]);
    } catch (e) {
      return res.status(500).json({ error: `LLM extraction failed: ${e.message}` });
    }

    const finalCategory = category || extracted.category || '其他';
    const finalTags = tags || extracted.tags || '';
    const finalPriority = priority ?? 3;
    const starsAi = Math.max(1, Math.min(5, parseInt(extracted.stars_suggest || 3)));
    const source = config.SOURCE_NAME_MAP[sourceType] || 'Web';

    let arxivId = '';
    const arxivMatch = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/);
    if (arxivMatch) arxivId = arxivMatch[1];

    const lastId = db.runQuery(`
      INSERT INTO papers (title, authors, abstract, source, source_url, arxiv_id, category, priority, status, tags, notes, source_type, stars)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [extracted.title || url, extracted.authors || '', extracted.abstract || '', source, url, arxivId, finalCategory, finalPriority, 'unread', finalTags, notes || '', sourceType, starsAi]);

    const abstract = extracted.abstract || '';
    res.status(201).json({ id: lastId, title: extracted.title, authors: extracted.authors, source_type: sourceType, category: finalCategory, stars: starsAi, abstract_preview: abstract.length > 100 ? abstract.substring(0, 100) + '...' : abstract, message: 'imported' });
  });

  // GET /api/bg/sync-status - Get email sync status
  app.get('/api/bg/sync-status', (req, res) => {
    const taskManager = require('../services/taskManager');
    const status = taskManager.getStatus();
    res.json(status.emailSync || { running: false, lastRun: null, error: null });
  });

  // POST /api/bg/sync - Trigger email sync (runs in background)
  app.post('/api/bg/sync', async (req, res) => {
    const taskManager = require('../services/taskManager');
    const result = await taskManager.runTask('emailSync');
    res.json({ status: result.success ? 'started' : 'failed' });
  });

  // POST /api/papers/:id/cache - Cache paper PDF
  app.post('/api/papers/:id/cache', async (req, res) => {
    const paper = db.queryOne('SELECT * FROM papers WHERE id = ?', [req.params.id]);
    if (!paper) return res.status(404).json({ error: 'not found' });

    const result = await cacheService.downloadPaper(paper);
    res.json(result);
  });

  // GET /api/papers/:id/cache - Get cached paper info
  app.get('/api/papers/:id/cache', (req, res) => {
    const cached = cacheService.getCachedPaper(parseInt(req.params.id));
    if (!cached) return res.json({ cached: false });
    res.json({ cached: true, file_path: cached.file_path, file_size: cached.file_size, preview_image: cached.preview_image });
  });

  // DELETE /api/papers/:id/cache - Delete cached paper
  app.delete('/api/papers/:id/cache', (req, res) => {
    const result = cacheService.deleteCachedPaper(parseInt(req.params.id));
    res.json({ deleted: result });
  });

  // GET /api/cached-papers - List all cached papers
  app.get('/api/cached-papers', (req, res) => {
    const rows = cacheService.getAllCachedPapers();
    res.json(rows);
  });

  // GET /api/papers/:id/file - Serve cached PDF
  app.get('/api/papers/:id/file', (req, res) => {
    const cached = cacheService.getCachedPaper(parseInt(req.params.id));
    if (!cached || !cached.file_path) {
      return res.status(404).json({ error: 'not cached' });
    }
    const filePath = path.join(PDF_DIR, cached.file_path);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'file not found' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');
    res.sendFile(filePath);
  });

  // GET /api/papers/:id/preview - Serve preview image
  app.get('/api/papers/:id/preview', (req, res) => {
    const id = parseInt(req.params.id);
    const previewDir = path.join(CACHE_DIR, 'previews');
    
    // Try layout analysis naming: paper_{id}_page1.png
    const previewPath1 = path.join(previewDir, `paper_${id}_page1.png`);
    if (fs.existsSync(previewPath1)) {
      res.setHeader('Content-Type', 'image/png');
      return res.sendFile(previewPath1);
    }
    
    // Try cache naming: {id}_preview.png
    const previewPath2 = path.join(previewDir, `${id}_preview.png`);
    if (fs.existsSync(previewPath2)) {
      res.setHeader('Content-Type', 'image/png');
      return res.sendFile(previewPath2);
    }
    
    return res.status(404).json({ error: 'no preview' });
  });

  // POST /api/papers/:id/regenerate-preview - Regenerate preview for cached PDF
  app.post('/api/papers/:id/regenerate-preview', async (req, res) => {
    const result = await cacheService.regeneratePreview(parseInt(req.params.id));
    res.json(result);
  });

  // POST /api/papers/regenerate-all-previews - Regenerate all preview images
  app.post('/api/papers/regenerate-all-previews', async (req, res) => {
    const results = await cacheService.regenerateAllPreviews();
    res.json({ count: results.length, results });
  });

  // GET /api/papers/:id/layout - Get layout analysis data
  app.get('/api/papers/:id/layout', (req, res) => {
    const cached = db.queryOne('SELECT layout_data FROM cached_papers WHERE paper_id = ?', [req.params.id]);
    if (!cached) return res.status(404).json({ error: 'not cached' });
    if (!cached.layout_data) return res.json({ analyzed: false });
    try {
      const layout = JSON.parse(cached.layout_data);
      res.json({ analyzed: true, ...layout });
    } catch (e) {
      res.json({ analyzed: false });
    }
  });

  // POST /api/layout-redetect - Force re-detect all cached papers
  app.post('/api/layout-redetect', (req, res) => {
    db.runQuery("UPDATE cached_papers SET layout_data = NULL WHERE file_path IS NOT NULL AND file_path != ''");
    const count = db.queryOne("SELECT COUNT(*) as c FROM cached_papers WHERE layout_data IS NULL AND file_path IS NOT NULL AND file_path != ''").c;
    res.json({ updated: count });
  });

  // GET /api/layout-stats - Get layout analysis stats
  app.get('/api/layout-stats', (req, res) => {
    const cached = db.queryOne("SELECT COUNT(*) as c FROM cached_papers WHERE file_path IS NOT NULL AND file_path != ''").c;
    const needsAnalysis = db.queryOne("SELECT COUNT(*) as c FROM cached_papers WHERE file_path IS NOT NULL AND file_path != '' AND (layout_data IS NULL OR layout_data = '' OR layout_data = 'null')").c;
    const analyzed = cached - needsAnalysis;
    res.json({ cached, analyzed, needsAnalysis });
  });
}

module.exports = setupPaperRoutes;