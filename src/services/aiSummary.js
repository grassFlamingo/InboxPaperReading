const db = require('../db/database');
const config = require('../../config');
const { BackgroundService } = require('./backgroundService');
const { callLlm, cleanThinkTags } = require('./llm');
const { extractTechTermsFromText, upsertTechTerm } = require('../routes/techterms');

class AISummaryService extends BackgroundService {
  constructor(options = {}) {
    super('summarize', {
      label: 'AI Summary',
      enabled: options.enabled !== false,
      intervalMs: 0,
      initialDelayMs: options.initialDelayMs || config.BG_WORKER?.DELAY_MS + 10000,
    });
  }

  _prepareContext() {
    const prefRows = db.queryAll("SELECT category, ROUND(AVG(user_rating),1) as avg_r FROM papers WHERE user_rating > 0 GROUP BY category");
    const liked = prefRows.filter(r => r.avg_r >= 4).map(r => r.category);
    return {
      systemPrompt: '你是论文快速预览助手。用3-5句中文简洁描述论文核心内容、关键方法和贡献。语言精炼。',
      prefText: liked.length > 0 ? `\n用户偏好高评分分类：${liked.join(', ')}。` : ''
    };
  }

  async execute() {
    const ctx = this._prepareContext();
    const papers = db.queryAll(`
      SELECT * FROM papers WHERE abstract IS NOT NULL AND abstract != ''
      AND ((summary IS NULL OR summary = '') OR (ai_category IS NULL OR ai_category = '') OR stars = 0)
      ORDER BY priority DESC, id DESC
    `);

    console.log(`[${this.label}] Found ${papers.length} papers needing summary`);

    for (const paper of papers) {
      try {
        await this._processPaper(paper, ctx);
        this.status.processed++;
      } catch (e) {
        this.status.errors++;
        console.error(`[${this.label}] Error #${paper.id}:`, e.message);
        await this._setTimeout(2000);
      }
      await this.yieldIfNeeded();
      await this._setTimeout(500);
    }

    console.log(`[${this.label}] Done: ${this.status.processed} summarized, ${this.status.errors} errors`);
  }

  async _processPaper(paper, ctx) {
    let summary = paper.summary || '', aiCategory = paper.ai_category || '', stars = paper.stars || 0;

    if (!summary) {
      const userContent = `Title: ${paper.title}\n` +
        (paper.authors ? `Authors: ${paper.authors}\n` : '') +
        (paper.category ? `Category: ${paper.category}\n` : '') +
        (paper.tags ? `Tags: ${paper.tags}\n` : '') +
        `Abstract: ${paper.abstract}`;
      summary = cleanThinkTags(await callLlm(ctx.systemPrompt, userContent));
    }

    if (!aiCategory || !stars) {
      const catList = config.AI_CATEGORIES.join('、');
      const classifyPrompt = `从以下分类选择最合适的：[${catList}]。评估1-5星：5星=里程碑，4星=方法新颖，3星=常规价值，2星=参考有限，1星=低相关${ctx.prefText}
严格按JSON输出：{"category":"分类名","stars":数字,"reason":"一句话理由"}`;
      const classifyContent = `Title: ${paper.title}\n` + (paper.authors ? `Authors: ${paper.authors}\n` : '') + `Abstract: ${paper.abstract.substring(0, 800)}`;
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

    db.runQuery('UPDATE papers SET summary = ?, ai_category = ?, stars = ? WHERE id = ?', [summary, aiCategory, stars, paper.id]);

    const terms = await extractTechTermsFromText(paper.abstract, paper.id);
    for (const t of terms) {
      upsertTechTerm(t.term_en, t.term_zh, t.context || '', paper.id);
    }
  }
}

module.exports = {
  AISummaryService,
};
