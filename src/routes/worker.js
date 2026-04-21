/**
 * DEPRECATED: This file is deprecated and will be removed in a future version.
 * Please use src/services/backgroundWorker.js instead.
 */
console.warn('[DEPRECATED] routes/worker.js is deprecated. Use backgroundWorker.js instead.');

const db = require('../db/database');
const { callLlm, cleanThinkTags } = require('../services/llm');
const config = require('../../config');
const { PaperMetadataFetcher } = require('../services/metadataFetch');
const { extractTechTermsFromText, upsertTechTerm } = require('./techterms');
const { processMarkdownConversion, WEB_CONTENT_TYPES } = require('../services/markdown');
const cacheService = require('../services/cache');
const layoutService = require('../services/layoutAnalysis');

const bgState = {
  running: false,
  current: null,
  queue: [],
  total: 0,
  done: 0,
  errors: 0,
  stop_flag: false
};

const WORKER_TASKS = {
  fetch: {
    name: 'fetch',
    label: 'Metadata',
    getQuery: () => db.queryAll(`
      SELECT * FROM papers WHERE arxiv_id IS NOT NULL AND arxiv_id != ''
      AND (abstract IS NULL OR abstract = '' OR title LIKE 'arXiv:%' OR title LIKE 'arXiv Query:%')
      ORDER BY id DESC
    `),
    process: async (p) => {
      const metadata = await PaperMetadataFetcher.fetch(p.arxiv_id);
      if (metadata) {
        db.runQuery(`
          UPDATE papers SET title = ?, authors = ?, abstract = ?, source = ?, source_url = ?
          WHERE id = ?
        `, [metadata.title, metadata.authors, metadata.abstract, metadata.source, metadata.source_url, p.id]);
        return { done: 1, msg: metadata.title.substring(0, 40) };
      }
      return { done: 0, msg: null };
    }
  },

  markdown: {
    name: 'markdown',
    label: 'Markdown',
    getQuery: () => db.queryAll(`
      SELECT * FROM papers WHERE source_type IN (${WEB_CONTENT_TYPES.map(() => '?').join(',')})
      AND (markdown_content IS NULL OR markdown_content = '' OR LENGTH(markdown_content) < 100)
      ORDER BY id DESC
    `, WEB_CONTENT_TYPES),
    process: async (p) => {
      return await processMarkdownConversion(p);
    }
  },

  summarize: {
    name: 'summarize',
    label: 'AI Summary',
    getQuery: () => db.queryAll(`
      SELECT * FROM papers WHERE abstract IS NOT NULL AND abstract != ''
      AND ((summary IS NULL OR summary = '') OR (ai_category IS NULL OR ai_category = '') OR stars = 0)
      ORDER BY priority DESC, id DESC
    `),
    prepare: () => {
      const prefRows = db.queryAll("SELECT category, ROUND(AVG(user_rating),1) as avg_r FROM papers WHERE user_rating > 0 GROUP BY category");
      const liked = prefRows.filter(r => r.avg_r >= 4).map(r => r.category);
      return {
        systemPrompt: '你是论文快速预览助手。用3-5句中文简洁描述论文核心内容、关键方法和贡献。语言精炼。',
        prefText: liked.length > 0 ? `\n用户偏好高评分分类：${liked.join(', ')}。` : ''
      };
    },
    process: async (p, ctx) => {
      let summary = p.summary || '', aiCategory = p.ai_category || '', stars = p.stars || 0;

      if (!summary) {
        const userContent = `Title: ${p.title}\n` +
          (p.authors ? `Authors: ${p.authors}\n` : '') +
          (p.category ? `Category: ${p.category}\n` : '') +
          (p.tags ? `Tags: ${p.tags}\n` : '') +
          `Abstract: ${p.abstract}`;
        summary = cleanThinkTags(await callLlm(ctx.systemPrompt, userContent));
      }

      if (!aiCategory || !stars) {
        const catList = config.AI_CATEGORIES.join('、');
        const classifyPrompt = `从以下分类选择最合适的：[${catList}]。评估1-5星：5星=里程碑，4星=方法新颖，3星=常规价值，2星=参考有限，1星=低相关${ctx.prefText}
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

      const terms = await extractTechTermsFromText(p.abstract, p.id);
      for (const t of terms) {
        upsertTechTerm(t.term_en, t.term_zh, t.context || '', p.id);
      }

      return { done: 1, msg: terms.length > 0 ? `${terms.length} terms` : null };
    }
  },

  cache: {
    name: 'cache',
    label: 'Cache PDF',
    getQuery: () => db.queryAll(`
      SELECT p.* FROM papers p
      LEFT JOIN cached_papers cp ON p.id = cp.paper_id
      WHERE p.arxiv_id IS NOT NULL AND p.arxiv_id != ''
      AND cp.id IS NULL
      ORDER BY p.priority DESC, p.id DESC
      LIMIT 20
    `),
    process: async (p) => {
      return await cacheService.downloadPaper(p);
    }
  },

  layout: {
    name: 'layout',
    label: 'Doc Layout',
    getQuery: () => {
      const rows = db.queryAll(`
        SELECT p.id, p.title, p.layout_data, cp.file_path
        FROM papers p
        JOIN cached_papers cp ON p.id = cp.paper_id
        WHERE cp.file_path IS NOT NULL AND cp.file_path != ''
        AND (p.layout_data IS NULL OR p.layout_data = '' OR p.layout_data = 'null')
        ORDER BY p.id DESC
        LIMIT 20
      `);
      console.log('[Layout] Query result:', rows.length, 'papers');
      return rows;
    },
    process: async (p) => {
      return await layoutService.runLayoutAnalysisForPaper(p.id);
    }
  }
};

function runBgWorker(taskKey) {
  console.warn('[DEPRECATED] runBgWorker() is deprecated.');

  const task = WORKER_TASKS[taskKey];
  if (!task) return;
  console.log(`[BG] runBgWorker called for: ${taskKey}`);

  (async () => {
    const state = bgState;
    if (state.running) {
      console.log(`[BG-${task.label}] Already running, skipping`);
      return;
    }

    state.running = true;
    state.current = taskKey;
    state.done = 0;
    state.errors = 0;
    state.stop_flag = false;

    const ctx = task.prepare ? task.prepare() : {};
    const rows = task.getQuery();
    state.total = rows.length;
    console.log(`[BG-${task.label}] Start: ${rows.length} papers, task: ${taskKey}`);

    for (const p of rows) {
      if (state.stop_flag) {
        console.log(`[BG-${task.label}] Stopped (${state.done}/${state.total})`);
        break;
      }
      state.current = `${taskKey}:${p.id}`;

      try {
        const result = await task.process(p, ctx);
        if (result.done) state.done++;
        if (result.msg) console.log(`[BG-${task.label}] #${p.id}: ${result.msg}`);
      } catch (e) {
        state.errors++;
        console.log(`[BG-${task.label}] Error #${p.id}:`, e.message);
        await new Promise(r => setTimeout(r, 2000)).catch(() => {});
      }

      await new Promise(r => setTimeout(r, 500)).catch(() => {});
    }

    state.current = null;
    state.running = false;
    console.log(`[BG-${task.label}] Done: ${state.done} ok, ${state.errors} errors`);
  })().catch(e => console.error(`[BG-${task.label}] Fatal:`, e.message));
}

function setupBgWorkerRoutes(app) {
  console.warn('[DEPRECATED] setupBgWorkerRoutes() is deprecated.');

  app.get('/api/bg-status', (req, res) => {
    const { current } = bgState;
    let label = 'idle';
    if (current === 'fetch') label = 'Metadata';
    else if (current === 'markdown') label = 'Markdown';
    else if (current === 'cache') label = 'Cache PDF';
    else if (current === 'layout') label = 'Doc Layout';
    else if (current === 'summarize') label = 'AI Summary';
    else if (current && current.includes(':')) label = current;

    res.json({
      running: bgState.running,
      task: current || 'idle',
      label,
      total: bgState.total,
      done: bgState.done,
      errors: bgState.errors
    });
  });

  app.get('/api/summary-status', (req, res) => {
    const isSummarizing = bgState.current === 'summarize' || (bgState.current && bgState.current.startsWith('summarize:'));
    res.json({
      running: isSummarizing,
      task: isSummarizing ? 'summarize' : 'idle',
      total: bgState.total,
      done: bgState.done,
      current: bgState.current || ''
    });
  });

  app.post('/api/bg-start', (req, res) => {
    const { task } = req.body || {};
    if (bgState.running) return res.json({ status: 'already_running', current: bgState.current });
    if (!WORKER_TASKS[task]) return res.json({ status: 'invalid_task' });

    runBgWorker(task);
    res.json({ status: 'started', task });
  });

  app.post('/api/bg-stop', (req, res) => {
    bgState.stop_flag = true;
    res.json({ status: 'stopping' });
  });
}

module.exports = {
  // DEPRECATED
  setupBgWorkerRoutes,
  startBgSummary: () => runBgWorker('summarize'),
  startBgFetch: () => runBgWorker('fetch'),
  startBgMarkdown: () => runBgWorker('markdown'),
  startBgCache: () => runBgWorker('cache'),
  startBgLayout: () => runBgWorker('layout')
};
