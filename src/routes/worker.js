const db = require('../db/database');
const { callLlm, cleanThinkTags } = require('../services/llm');
const config = require('../../config');

const bgState = { running: false, total: 0, done: 0, errors: 0, current_title: '', stop_flag: false };

async function bgSummarizeWorker() {
  const state = bgState;
  state.running = true; state.done = 0; state.errors = 0;

  const systemPrompt = '你是论文快速预览助手。用3-5句中文简洁描述论文核心内容、关键方法和贡献。语言精炼。';
  const prefRows = db.queryAll("SELECT category, ROUND(AVG(user_rating),1) as avg_r FROM papers WHERE user_rating > 0 GROUP BY category");
  const liked = prefRows.filter(r => r.avg_r >= 4).map(r => r.category);
  const prefText = liked.length > 0 ? `\n用户偏好高评分分类：${liked.join(', ')}。` : '';

  const rows = db.queryAll(`
    SELECT * FROM papers WHERE abstract IS NOT NULL AND abstract != '' 
    AND ((summary IS NULL OR summary = '') OR (ai_category IS NULL OR ai_category = '') OR stars = 0) 
    ORDER BY priority DESC, id DESC
  `);

  state.total = rows.length;
  console.log(`[BG-AI] Start: ${rows.length} papers to process`);

  for (const p of rows) {
    if (state.stop_flag) { console.log(`[BG-AI] Stopped (${state.done}/${state.total})`); break; }
    state.current_title = p.title.substring(0, 60);

    let summary = p.summary || '', aiCategory = p.ai_category || '', stars = p.stars || 0;
    try {
      if (!summary) {
        let userContent = `Title: ${p.title}\n`;
        if (p.authors) userContent += `Authors: ${p.authors}\n`;
        if (p.category) userContent += `Category: ${p.category}\n`;
        if (p.tags) userContent += `Tags: ${p.tags}\n`;
        userContent += `Abstract: ${p.abstract}`;
        summary = cleanThinkTags(await callLlm(systemPrompt, userContent));
      }

      if (!aiCategory || !stars) {
        const catList = config.AI_CATEGORIES.join('、');
        const classifyPrompt = `从以下分类选择最合适的：[${catList}]。评估1-5星：5星=里程碑，4星=方法新颖，3星=常规价值，2星=参考有限，1星=低相关${prefText}
严格按JSON输出：{"category":"分类名","stars":数字,"reason":"一句话理由"}`;

        const classifyContent = `Title: ${p.title}\n` + (p.authors ? `Authors: ${p.authors}\n` : '') + `Abstract: ${p.abstract.substring(0, 800)}`;
        const classResult = cleanThinkTags(await callLlm(classifyPrompt, classifyContent));
        const jsonMatch = classResult.match(/\{[^}]+\}/);
        
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[0]);
          let cat = data.category || '其他';
          for (const c of config.AI_CATEGORIES) {
            if (cat.toLowerCase().replace(' ', '').includes(c.toLowerCase().replace(' ', ''))) { cat = c; break; }
          }
          if (!aiCategory) aiCategory = cat;
          if (!stars) stars = Math.max(1, Math.min(5, parseInt(data.stars || 3)));
        }
      }

      db.runQuery('UPDATE papers SET summary = ?, ai_category = ?, stars = ? WHERE id = ?', [summary, aiCategory, stars, p.id]);
      state.done++;
      if (state.done % 10 === 0) console.log(`[BG-AI] Progress: ${state.done}/${state.total}`);
    } catch (e) {
      state.errors++;
      console.log(`[BG-AI] Error #${p.id}:`, e);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  state.current_title = '';
  state.running = false;
  console.log(`[BG-AI] Done: ${state.done} ok, ${state.errors} errors`);
}

function setupBgWorkerRoutes(app) {
  app.get('/api/summary-status', (req, res) => res.json({
    running: bgState.running, total: bgState.total, done: bgState.done, errors: bgState.errors, current: bgState.current_title
  }));

  app.post('/api/summary-bg-start', (req, res) => {
    if (bgState.running) return res.json({ status: 'already_running' });
    bgSummarizeWorker();
    res.json({ status: 'started' });
  });

  app.post('/api/summary-bg-stop', (req, res) => {
    bgState.stop_flag = true;
    res.json({ status: 'stopping' });
  });
}

module.exports = { setupBgWorkerRoutes, startBgSummary: () => !bgState.running && bgSummarizeWorker() };