const db = require('../db/database');
const config = require('../../config');
const fetch = require('node-fetch');
const { BackgroundService } = require('./backgroundService');

const ARXIV_API = 'https://export.arxiv.org/api/query';
const SEMANTIC_API = 'https://api.semanticscholar.org/graph/v1/paper/arxiv:';
const OPENALEX_API = 'https://api.openalex.org/works/doi:10.48550/arXiv.';
const OPENALEX_KEY = config.OPENALEX_ORG?.API || '';
const USER_AGENT = config.CACHE?.USER_AGENT || 'Mozilla/5.0 (compatible; paperReader/1.0)';

const ARXIV_ID_REGEX = /^\d{4}\.\d{4,5}(v\d+)?$/;

class PaperMetadataFetcher {
  static isValidArxivId(arxivId) {
    return ARXIV_ID_REGEX.test(arxivId);
  }

  static async fetch(arxivId, retries = 3) {
    if (!arxivId) return null;

    if (!this.isValidArxivId(arxivId)) {
      console.debug(`[PaperMetadataFetcher] #${arxivId}: invalid arxiv_id format, skipping`);
      return null;
    }

    const arxivResult = await this.fetchFromArxivApi(arxivId, retries);
    if (arxivResult) {
      console.debug(`[PaperMetadataFetcher] #${arxivId}: got from arXiv API`);
      return arxivResult;
    }

    const ssResult = await this.fetchFromSemanticScholar(arxivId, retries);
    if (ssResult) {
      console.debug(`[PaperMetadataFetcher] #${arxivId}: got from Semantic Scholar`);
      return ssResult;
    }

    const openalexResult = await this.fetchFromOpenAlex(arxivId, retries);
    if (openalexResult) {
      console.debug(`[PaperMetadataFetcher] #${arxivId}: got from OpenAlex`);
      return openalexResult;
    }

    return null;
  }

  static async fetchFromSemanticScholar(arxivId, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const url = `${SEMANTIC_API}${arxivId}?fields=title,authors,abstract,year,venue,externalIds,url`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        
        const response = await fetch(url, { 
          signal: controller.signal,
          headers: { 
            'Accept': 'application/json',
            'User-Agent': USER_AGENT
          }
        });
        clearTimeout(timeout);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        return this.parseSemanticResponse(data, arxivId);
      } catch (e) {
        console.warn(`[PaperMetadataFetcher] Semantic Scholar attempt ${attempt} failed: ${e.message}`);
        if (attempt < retries) await new Promise(r => setTimeout(r, 10000));
      }
    }
    return null;
  }

  static async fetchFromOpenAlex(arxivId, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const url = `${OPENALEX_API}${arxivId}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        
        const headers = { 
          'Accept': 'application/json',
          'User-Agent': USER_AGENT
        };
        if (OPENALEX_KEY) headers['Authorization'] = `Bearer ${OPENALEX_KEY}`;
        
        const response = await fetch(url, { signal: controller.signal, headers });
        clearTimeout(timeout);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        return this.parseOpenAlexResponse(data, arxivId);
      } catch (e) {
        console.warn(`[PaperMetadataFetcher] OpenAlex attempt ${attempt} failed: ${e.message}`);
        if (attempt < retries) await new Promise(r => setTimeout(r, 10000));
      }
    }
    return null;
  }

static parseOpenAlexResponse(data, arxivId) {
    try {
      if (!data || !data.title) {
        console.debug(`[PaperMetadataFetcher] #${arxivId}: OpenAlex returned no data`);
        return null;
      }
      const title = data.title;
      const authors = (data.authorships || []).map(a => a.author?.display_name).filter(Boolean).join(', ');
      const abstract = data.abstract_inverted_index ? this.reconstructAbstract(data.abstract_inverted_index) : (data.abstract || '');
      const published = data.publication_date || '';
      const pdfUrl = data.primary_location?.pdf_url || `https://arxiv.org/pdf/${arxivId}`;
      const sourceUrl = data.primary_location?.source?.display_name || data.doi || `https://arxiv.org/abs/${arxivId}`;

      return {
        title,
        authors,
        abstract: abstract || '',
        source: 'arXiv',
        source_url: `https://arxiv.org/abs/${arxivId}`,
        arxiv_id: arxivId,
        published: published ? `${published}-01-01` : '',
        pdfLink: pdfUrl,
      };
    } catch (e) {
      console.error('[PaperMetadataFetcher] OpenAlex parse error:', e.message);
      return null;
    }
  }

  static reconstructAbstract(invertedIndex) {
    if (!invertedIndex) return '';
    const words = [];
    const maxPos = Math.max(...Object.values(invertedIndex).flat());
    for (let i = 0; i <= maxPos; i++) {
      for (const [word, positions] of Object.entries(invertedIndex)) {
        if (positions.includes(i)) {
          words[i] = word;
          break;
        }
      }
    }
    return words.filter(Boolean).join(' ');
  }

  static async fetchFromArxivApi(arxivId, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const url = `${ARXIV_API}?id_list=${arxivId}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);

        const response = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': USER_AGENT }
        });
        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const text = await response.text();
        return this.parseArxivResponse(text, arxivId);
      } catch (e) {
        console.warn(`[PaperMetadataFetcher] arXiv attempt ${attempt}/${retries} failed for ${arxivId}: ${e.message}`);
        if (attempt < retries) await new Promise(r => setTimeout(r, 10000));
      }
    }

    return null;
  }

  static parseSemanticResponse(data, arxivId) {
    try {
      if (!data || !data.title) {
        console.debug(`[PaperMetadataFetcher] #${arxivId}: Semantic Scholar returned no data`);
        return null;
      }
      const authors = (data.authors || []).map(a => a.name).join(', ');
      const externalIds = data.externalIds || {};
      const pdfUrl = externalIds.DOI ? `https://arxiv.org/pdf/${arxivId}` : data.url || `https://arxiv.org/abs/${arxivId}`;

      return {
        title: data.title,
        authors,
        abstract: data.abstract || '',
        source: data.venue || 'arXiv',
        source_url: data.url || `https://arxiv.org/abs/${arxivId}`,
        arxiv_id: arxivId,
        published: data.year ? `${data.year}-01-01` : '',
        pdfLink: pdfUrl,
      };
    } catch (e) {
      console.error('[PaperMetadataFetcher] Parse error:', e.message);
      return null;
    }
  }

  static parseArxivResponse(xmlText, arxivId) {
    try {
      const entryMatch = xmlText.match(/<entry>([\s\S]*?)<\/entry>/i);
      const entryContent = entryMatch ? entryMatch[1] : xmlText;

      if (!entryContent || entryContent.length < 10) {
        console.debug(`[PaperMetadataFetcher] #${arxivId}: no entry in arXiv response`);
        return null;
      }

      const extract = (tag) => {
        const match = entryContent.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
        return match ? match[1].trim() : '';
      };

      const title = extract('title').replace(/\s+/g, ' ');
      const summary = extract('summary').replace(/\s+/g, ' ');
      const authors = extract('author').split('</author>').map(a => {
        const nameMatch = a.match(/<name>([^<]+)<\/name>/);
        return nameMatch ? nameMatch[1].trim() : '';
      }).filter(Boolean).join(', ');

      if (!title || title.startsWith('arXiv Query')) {
        console.debug(`[PaperMetadataFetcher] #${arxivId}: arXiv returned invalid title="${title}"`);
        return null;
      }

      const published = extract('published');
      const pdfLink = `https://arxiv.org/pdf/${arxivId}`;
      const absLink = `https://arxiv.org/abs/${arxivId}`;

      return {
        title,
        authors,
        abstract: summary,
        source: 'arXiv',
        source_url: absLink,
        arxiv_id: arxivId,
        published,
        pdfLink,
      };
    } catch (e) {
      console.error('[PaperMetadataFetcher] ArXiv parse error:', e.message);
      return null;
    }
  }
}

class MetadataFetchService extends BackgroundService {
  constructor(options = {}) {
    super('fetch', {
      label: 'Metadata',
      enabled: options.enabled !== false,
      intervalMs: 0,
      initialDelayMs: options.initialDelayMs || config.BG_WORKER?.DELAY_MS,
    });
  }

  async hasPending() {
    const papers = db.queryAll(`
      SELECT id FROM papers WHERE arxiv_id IS NOT NULL AND arxiv_id != ''
      AND (abstract IS NULL OR abstract = '' OR title LIKE 'arXiv:%' OR title LIKE 'arXiv Query:%')
      AND arxiv_id NOT LIKE 'arXiv Query:%'
      AND arxiv_id NOT LIKE '%&%'
      LIMIT 1
    `);
    return papers.length > 0;
  }

  async execute() {
    console.debug('[MetadataFetchService] Starting metadata fetch...');
    const papers = db.queryAll(`
      SELECT * FROM papers WHERE arxiv_id IS NOT NULL AND arxiv_id != ''
      AND arxiv_id NOT LIKE 'arXiv Query:%'
      AND arxiv_id NOT LIKE '%&%'
      AND (abstract IS NULL OR abstract = '' OR title LIKE 'arXiv:%' OR title LIKE 'arXiv Query:%')
      ORDER BY id DESC
    `);

    const validPapers = papers.filter(p => PaperMetadataFetcher.isValidArxivId(p.arxiv_id));

    console.debug(`[MetadataFetchService] Found ${papers.length} papers needing metadata:`, papers.map(p => ({ id: p.id, arxiv_id: p.arxiv_id, title: p.title })));

    for (const paper of papers) {
      try {
        console.debug(`[MetadataFetchService] Fetching metadata for paper #${paper.id} (${paper.arxiv_id})...`);
        const metadata = await PaperMetadataFetcher.fetch(paper.arxiv_id);
        if (metadata) {
          console.debug(`[MetadataFetchService] Got metadata for #${paper.id}: title="${metadata.title}", authors="${metadata.authors?.substring(0, 50)}..."`);
          db.runQuery(`
            UPDATE papers SET title = ?, authors = ?, abstract = ?, source = ?, source_url = ?
            WHERE id = ?
          `, [metadata.title, metadata.authors, metadata.abstract, metadata.source, metadata.source_url, paper.id]);
          console.debug(`[MetadataFetchService] Updated paper #${paper.id} in database`);
          this.status.processed++;
        } else {
          console.debug(`[MetadataFetchService] No metadata found for #${paper.id}`);
        }
      } catch (e) {
        this.status.errors++;
        console.error(`[MetadataFetchService] Error #${paper.id}:`, e.message);
      }
      await this.yieldIfNeeded();
      await this._setTimeout(2000);
    }

    console.debug(`[MetadataFetchService] Done: ${this.status.processed} updated, ${this.status.errors} errors`);
  }
}

module.exports = {
  MetadataFetchService,
  PaperMetadataFetcher,
};