const db = require('../db/database');
const { callLlm, cleanThinkTags } = require('../services/llm');
const config = require('../../config');

function setupSummaryRoutes(app) {
  // POST /api/summarize/:id - Summarize single paper
  app.post('/api/summarize/:id', async (req, res) => {
    const paper = db.queryOne('SELECT * FROM papers WHERE id = ?', [req.params.id]);
    if (!paper) return res.status(404).json({ error: 'paper not found' });
    if (paper.summary) return res.json({ summary: paper.summary, cached: true });

    const systemPrompt = '你是论文快速预览助手。用3-5句中文简洁描述论文核心内容、关键方法和贡献。语言精炼，帮助读者快速判断是否值得深入阅读。不要使用markdown。';
    let userContent = `Title: ${paper.title}\n`;
    if (paper.authors) userContent += `Authors: ${paper.authors}\n`;
    if (paper.category) userContent += `Category: ${paper.category}\n`;
    if (paper.tags) userContent += `Tags: ${paper.tags}\n`;
    userContent += paper.abstract ? `Abstract: ${paper.abstract}` : '(No abstract available)';

    try {
      const summary = await callLlm(systemPrompt, userContent);
      db.runQuery('UPDATE papers SET summary = ? WHERE id = ?', [summary, paper.id]);
      res.json({ summary, cached: false });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/summarize-batch
  app.post('/api/summarize-batch', async (req, res) => {
    const ids = (req.body.ids || []).slice(0, 20);
    if (ids.length === 0) return res.status(400).json({ error: 'no ids provided' });

    const placeholders = ids.map(() => '?').join(',');
    const rows = db.queryAll(`SELECT * FROM papers WHERE id IN (${placeholders})`, ids);
    const results = {};
    const systemPrompt = '你是论文快速预览助手。用3-5句中文简洁描述论文核心内容。语言精炼。不要使用markdown。';

    for (const p of rows) {
      if (p.summary) { results[String(p.id)] = { summary: p.summary, cached: true }; continue; }
      let userContent = `Title: ${p.title}\n` + (p.authors ? `Authors: ${p.authors}\n` : '') + (p.abstract ? `Abstract: ${p.abstract}` : '(No abstract available)');
      try {
        const summary = await callLlm(systemPrompt, userContent);
        db.runQuery('UPDATE papers SET summary = ? WHERE id = ?', [summary, p.id]);
        results[String(p.id)] = { summary, cached: false };
      } catch (e) { results[String(p.id)] = { error: e.message }; }
    }
    res.json(results);
  });

  // POST /api/papers/:id/rate
  app.post('/api/papers/:id/rate', (req, res) => {
    const { rating } = req.body || {};
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'rating must be 1-5' });
    db.runQuery('UPDATE papers SET user_rating = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [rating, req.params.id]);
    res.json({ rating });
  });

  // GET /api/preferences
  app.get('/api/preferences', (req, res) => {
    const rows = db.queryAll(`
      SELECT category, COUNT(*) as count, ROUND(AVG(user_rating), 1) as avg_rating,
             ROUND(AVG(CASE WHEN user_rating >= 4 THEN 1.0 ELSE 0.0 END), 2) as like_ratio
      FROM papers WHERE user_rating > 0 GROUP BY category ORDER BY count DESC
    `);
    res.json(rows);
  });
}

module.exports = setupSummaryRoutes;