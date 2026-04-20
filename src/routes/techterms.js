const db = require('../db/database');
const { callLlm, cleanThinkTags } = require('../services/llm');

function buildGlossary(inputText) {
  if (!inputText) return '';
  
  const rows = db.queryAll(`
    SELECT term_en, term_zh, context 
    FROM tech_terms 
    WHERE verified = 1
  `);
  
  if (rows.length === 0) return '';
  
  const parts = [];
  for (const row of rows) {
    const term = row.term_en.toLowerCase();
    const textLower = inputText.toLowerCase();
    
    if (!textLower.includes(term)) continue;
    
    if (row.context && row.context.trim()) {
      const contextKeywords = row.context.split(',').map(k => k.trim().toLowerCase()).filter(k => k);
      const hasContext = contextKeywords.some(k => textLower.includes(k));
      if (!hasContext && row.context.trim() !== '') continue;
    }
    
    parts.push(`${row.term_en}: ${row.term_zh}`);
  }
  
  return parts.length > 0 ? `\n术语参考：\n${parts.join('\n')}` : '';
}

async function extractTechTermsFromText(text, sourcePaperId) {
  if (!text || text.length < 20) return [];

  const systemPrompt = `你是术语提取专家。从以下技术文本中提取专业术语及其中文翻译。
要求：
1. 只提取真正的技术术语（如算法名、模型名、技术概念）
2. 每个术语给出准确的简体中文翻译
3. 考虑可能的上下文场景（可选，用于区分不同翻译）

请按JSON数组格式输出，每项格式：
[{"term_en":"术语英文","term_zh":"中文翻译","context":"相关上下文关键词,可选"},...]

只输出JSON，不要其他内容。`;

  try {
    const llmResult = cleanThinkTags(await callLlm(systemPrompt, text, 300));
    const jsonMatch = llmResult.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const terms = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(terms)) return [];

    const validTerms = [];
    for (const t of terms) {
      if (t.term_en && t.term_zh && t.term_en.length > 1 && t.term_zh.length > 0) {
        validTerms.push({
          term_en: String(t.term_en).trim(),
          term_zh: String(t.term_zh).trim(),
          context: t.context ? String(t.context).trim() : ''
        });
      }
    }
    return validTerms;
  } catch (e) {
    console.log('[TechTerms] Extraction error:', e.message);
    return [];
  }
}

function upsertTechTerm(termEn, termZh, context, sourcePaperId) {
  const existing = db.queryOne(`
    SELECT id, use_count FROM tech_terms 
    WHERE term_en = ? AND term_zh = ? AND (context = ? OR (context IS NULL AND ? IS NULL))
  `, [termEn, termZh, context || '', context || '']);
  
  if (existing) {
    db.runQuery(`UPDATE tech_terms SET use_count = use_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [existing.id]);
    return { id: existing.id, action: 'incremented' };
  } else {
    const lastId = db.runQuery(`
      INSERT INTO tech_terms (term_en, term_zh, context, source_paper_id, use_count, verified)
      VALUES (?, ?, ?, ?, 1, 0)
    `, [termEn, termZh, context || '', sourcePaperId || null]);
    return { id: lastId, action: 'inserted' };
  }
}

function checkInconsistencies() {
  const rows = db.queryAll(`
    SELECT term_en, COUNT(DISTINCT term_zh) as variant_count, GROUP_CONCAT(DISTINCT term_zh) as variants
    FROM tech_terms 
    GROUP BY term_en 
    HAVING variant_count > 1
  `);
  return rows;
}

function getCandidates() {
  return db.queryAll(`
    SELECT * FROM tech_terms 
    WHERE verified = 0 AND use_count >= 3
    ORDER BY use_count DESC
  `);
}

function setupTechTermsRoutes(app) {
  app.get('/api/tech-terms', (req, res) => {
    const { verified, q, sort } = req.query;
    let query = 'SELECT t.*, p.title as source_title FROM tech_terms t LEFT JOIN papers p ON t.source_paper_id = p.id WHERE 1=1';
    const params = [];
    
    if (verified === '1') {
      query += ' AND t.verified = 1';
    } else if (verified === '0') {
      query += ' AND t.verified = 0';
    } else if (verified === 'candidate') {
      query += ' AND t.verified = 0 AND t.use_count >= 3';
    }
    
    if (q) {
      query += ' AND (t.term_en LIKE ? OR t.term_zh LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }
    
    const sortOrders = {
      'count': 't.use_count DESC, t.verified ASC, t.id DESC',
      'name': 't.term_en ASC, t.verified ASC, t.id DESC',
      'date': 't.id DESC, t.verified ASC',
      'zh': 't.term_zh ASC, t.verified ASC, t.id DESC'
    };
    const orderBy = sortOrders[sort] || 't.verified ASC, t.use_count DESC, t.id DESC';
    query += ` ORDER BY ${orderBy}`;
    
    const rows = db.queryAll(query, params);
    res.json(rows);
  });

  app.get('/api/tech-terms/stats', (req, res) => {
    const totalRow = db.queryOne('SELECT COUNT(*) as c FROM tech_terms');
    const verifiedRow = db.queryOne('SELECT COUNT(*) as c FROM tech_terms WHERE verified = 1');
    const unverifiedRow = db.queryOne('SELECT COUNT(*) as c FROM tech_terms WHERE verified = 0');
    const candidatesRow = db.queryOne('SELECT COUNT(*) as c FROM tech_terms WHERE verified = 0 AND use_count >= 3');
    const incResult = db.queryOne(`
      SELECT COUNT(DISTINCT term_en) as c FROM tech_terms 
      GROUP BY term_en HAVING COUNT(DISTINCT term_zh) > 1
    `);
    const resJson = {
      total: totalRow ? totalRow.c : 0,
      verified: verifiedRow ? verifiedRow.c : 0,
      unverified: unverifiedRow ? unverifiedRow.c : 0,
      candidates: candidatesRow ? candidatesRow.c : 0,
      inconsistencies: incResult ? incResult.c : 0
    };
    res.json(resJson);
  });

  app.post('/api/tech-terms', (req, res) => {
    const { term_en, term_zh, context, source_paper_id } = req.body;
    if (!term_en || !term_zh) {
      return res.status(400).json({ error: 'term_en and term_zh required' });
    }
    const result = upsertTechTerm(term_en, term_zh, context || '', source_paper_id);
    res.json(result);
  });

  app.put('/api/tech-terms/:id', (req, res) => {
    const { id } = req.params;
    const { term_en, term_zh, context, verified } = req.body;
    const sets = [], vals = [];
    
    if (term_en) { sets.push('term_en = ?'); vals.push(term_en); }
    if (term_zh) { sets.push('term_zh = ?'); vals.push(term_zh); }
    if (context !== undefined) { sets.push('context = ?'); vals.push(context || ''); }
    if (verified !== undefined) { sets.push('verified = ?'); vals.push(verified ? 1 : 0); }
    
    if (sets.length === 0) {
      return res.status(400).json({ error: 'nothing to update' });
    }
    
    sets.push('updated_at = CURRENT_TIMESTAMP');
    vals.push(id);
    
    db.runQuery(`UPDATE tech_terms SET ${sets.join(', ')} WHERE id = ?`, vals);
    res.json({ message: 'updated' });
  });

  app.post('/api/tech-terms/verify/:id', (req, res) => {
    const { id } = req.params;
    db.runQuery('UPDATE tech_terms SET verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
    res.json({ message: 'verified' });
  });

  app.delete('/api/tech-terms/:id', (req, res) => {
    const { id } = req.params;
    db.runQuery('DELETE FROM tech_terms WHERE id = ?', [id]);
    res.json({ message: 'deleted' });
  });

  app.get('/api/tech-terms/export', (req, res) => {
    const rows = db.queryAll(`
      SELECT term_en, term_zh, context, verified, use_count 
      FROM tech_terms 
      ORDER BY use_count DESC
    `);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=tech_terms.json');
    res.json(rows);
  });

  app.post('/api/tech-terms/import', (req, res) => {
    const terms = req.body;
    if (!Array.isArray(terms)) {
      return res.status(400).json({ error: 'JSON array expected' });
    }
    
    let inserted = 0, updated = 0;
    for (const t of terms) {
      if (!t.term_en || !t.term_zh) continue;
      const result = upsertTechTerm(t.term_en, t.term_zh, t.context || '', null);
      if (result.action === 'inserted') inserted++;
      else updated++;
      
      if (t.verified) {
        db.runQuery('UPDATE tech_terms SET verified = 1 WHERE id = ?', [result.id]);
      }
    }
    
    res.json({ message: 'imported', inserted, updated });
  });

  app.get('/api/tech-terms/inconsistencies', (req, res) => {
    res.json(checkInconsistencies());
  });
}

module.exports = { 
  setupTechTermsRoutes, 
  buildGlossary, 
  extractTechTermsFromText, 
  upsertTechTerm,
  getCandidates,
  checkInconsistencies
};