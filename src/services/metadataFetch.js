const db = require('../db/database');
const config = require('../../config');
const { BackgroundService } = require('./backgroundService');
const { PaperMetadataFetcher } = require('./email');

class MetadataFetchService extends BackgroundService {
  constructor(options = {}) {
    super('fetch', {
      label: 'Metadata',
      enabled: options.enabled !== false,
      intervalMs: 0,
      initialDelayMs: options.initialDelayMs || config.BG_WORKER?.DELAY_MS,
    });
  }

  async execute() {
    const papers = db.queryAll(`
      SELECT * FROM papers WHERE arxiv_id IS NOT NULL AND arxiv_id != ''
      AND (abstract IS NULL OR abstract = '' OR title LIKE 'arXiv:%' OR title LIKE 'arXiv Query:%')
      ORDER BY id DESC
    `);

    console.log(`[${this.label}] Found ${papers.length} papers needing metadata`);

    for (const paper of papers) {
      try {
        const metadata = await PaperMetadataFetcher.fetch(paper.arxiv_id);
        if (metadata) {
          db.runQuery(`
            UPDATE papers SET title = ?, authors = ?, abstract = ?, source = ?, source_url = ?
            WHERE id = ?
          `, [metadata.title, metadata.authors, metadata.abstract, metadata.source, metadata.source_url, paper.id]);
          this.status.processed++;
        }
      } catch (e) {
        this.status.errors++;
        console.error(`[${this.label}] Error #${paper.id}:`, e.message);
      }
      await this.yieldIfNeeded();
      await this._setTimeout(500);
    }

    console.log(`[${this.label}] Done: ${this.status.processed} updated, ${this.status.errors} errors`);
  }
}

module.exports = {
  MetadataFetchService,
};
