const db = require('../db/database');
const { fetchUrlText, detectSourceType } = require('../services/web');
const { callLlm, cleanThinkTags } = require('../services/llm');
const config = require('../../config');
const emailSync = require('../services/email');
const { buildGlossary } = require('./techterms');
const cacheService = require('../services/cache');

function setupPaperRoutes(app) {
  // GET /api/papers - List papers with filters
  app.get('/api/papers', (req, res) => {
    const { category, status, q, sort = 'priority' } = req.query;
    let query = 'SELECT p.*, cp.file_path as cached_file_path FROM papers p LEFT JOIN cached_papers cp ON p.id = cp.paper_id WHERE 1=1';
    const params = [];

    if (category) { query += ' AND category = ?'; params.push(category); }
    if (status) { query += ' AND status = ?'; params.push(status); }
    else { query += ' AND status != ?'; params.push('done'); }
    if (q) { query += ' AND (title LIKE ? OR authors LIKE ? OR abstract LIKE ? OR tags LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }

    if (sort === 'date') query += ' ORDER BY created_at DESC';
    else if (sort === 'date_asc') query += ' ORDER BY created_at ASC';
    else if (sort === 'title') query += ' ORDER BY title ASC';
    else if (sort === 'title_asc') query += ' ORDER BY title DESC';
    else if (sort === 'stars') query += ' ORDER BY stars DESC, id ASC';
    else if (sort === 'stars_asc') query += ' ORDER BY stars ASC, id ASC';
    else if (sort === 'priority_asc') query += ' ORDER BY priority ASC, id ASC';
    else query += ' ORDER BY priority DESC, id ASC';

    const rows = db.queryAll(query, params);
    res.json(rows);
  });

  // POST /api/papers - Add paper
  app.post('/api/papers', (req, res) => {
    const d = req.body;
    const lastId = db.runQuery(`
      INSERT INTO papers (title, authors, abstract, source, source_url, arxiv_id, category, priority, status, tags, notes, source_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [d.title || '', d.authors || '', d.abstract || '', d.source || '', d.source_url || '', d.arxiv_id || '', d.category || '其他', d.priority ?? 3, d.status || 'unread', d.tags || '', d.notes || '', d.source_type || 'paper']);
    res.status(201).json({ id: lastId, message: 'added' });
  });

  // PUT /api/papers/:id - Update paper
  app.put('/api/papers/:id', (req, res) => {
    const { id } = req.params;
    const fields = ['title', 'authors', 'abstract', 'source', 'source_url', 'arxiv_id', 'category', 'priority', 'status', 'tags', 'notes', 'ai_category', 'stars', 'user_rating', 'source_type'];
    const sets = [], vals = [];
    for (const f of fields) {
      if (f in req.body) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'nothing to update' });
    sets.push('updated_at = CURRENT_TIMESTAMP');
    vals.push(id);
    db.runQuery(`UPDATE papers SET ${sets.join(', ')} WHERE id = ?`, vals);
    res.json({ message: 'updated' });
  });

  // DELETE /api/papers/:id
  app.delete('/api/papers/:id', (req, res) => {
    db.runQuery('DELETE FROM papers WHERE id = ?', [req.params.id]);
    res.json({ message: 'deleted' });
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
    res.json({ total, unread, reading, done });
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

  // POST /api/sync - Trigger email sync (runs in background)
  app.post('/api/sync', (req, res) => {
    if (emailSync.getSyncStatus().running) {
      return res.json({ status: 'already_running' });
    }
    emailSync.triggerManualSync();
    res.json({ status: 'started' });
  });

  // GET /api/sync-status
  app.get('/api/sync-status', (req, res) => {
    res.json(emailSync.getSyncStatus());
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
    if (!cached || !fs.existsSync(cached.file_path)) {
      return res.status(404).json({ error: 'not cached' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');
    res.sendFile(cached.file_path);
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
    const paper = db.queryOne('SELECT layout_data FROM papers WHERE id = ?', [req.params.id]);
    if (!paper) return res.status(404).json({ error: 'not found' });
    if (!paper.layout_data) return res.json({ analyzed: false });
    try {
      const layout = JSON.parse(paper.layout_data);
      res.json({ analyzed: true, ...layout });
    } catch (e) {
      res.json({ analyzed: false });
    }
  });
}

const fs = require('fs');
module.exports = setupPaperRoutes;