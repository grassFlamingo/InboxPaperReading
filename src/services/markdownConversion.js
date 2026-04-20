const db = require('../db/database');
const config = require('../../config');
const { BackgroundService } = require('./backgroundService');
const { processMarkdownConversion, WEB_CONTENT_TYPES } = require('./markdown');

class MarkdownConversionService extends BackgroundService {
  constructor(options = {}) {
    super('markdown', {
      label: 'Markdown',
      enabled: options.enabled !== false,
      intervalMs: 0,
      initialDelayMs: options.initialDelayMs || config.BG_WORKER?.DELAY_MS + 2000,
    });
  }

  async execute() {
    const papers = db.queryAll(`
      SELECT * FROM papers WHERE source_type IN (${WEB_CONTENT_TYPES.map(() => '?').join(',')})
      AND (markdown_content IS NULL OR markdown_content = '' OR LENGTH(markdown_content) < 100)
      ORDER BY id DESC
    `, WEB_CONTENT_TYPES);

    console.log(`[${this.label}] Found ${papers.length} papers needing markdown conversion`);

    for (const paper of papers) {
      try {
        const result = await processMarkdownConversion(paper);
        if (result.success) this.status.processed++;
        else this.status.errors++;
      } catch (e) {
        this.status.errors++;
        console.error(`[${this.label}] Error #${paper.id}:`, e.message);
      }
      await this.yieldIfNeeded();
      await this._setTimeout(500);
    }

    console.log(`[${this.label}] Done: ${this.status.processed} converted, ${this.status.errors} errors`);
  }
}

module.exports = {
  MarkdownConversionService,
  WEB_CONTENT_TYPES,
};
