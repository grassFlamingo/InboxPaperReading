const Imap = require('imap');
const { simpleParser } = require('mailparser');
const fetch = require('node-fetch');
const config = require('../../config');
const db = require('../db/database');

const EMAIL_CONFIG = config.EMAIL_SYNC;
const ARXIV_API = 'https://export.arxiv.org/api/query';
const SEMANTIC_API = 'https://api.semanticscholar.org/graph/v1/paper/arxiv:';
const OPENALEX_API = 'https://api.openalex.org/works/doi:10.48550/arXiv.';
const OPENALEX_KEY = config.OPENALEX_ORG?.API || '';

let syncStatus = {
  running: false,
  lastRun: null,
  emailsProcessed: 0,
  papersImported: 0,
  errors: [],
};

class PaperMetadataFetcher {
  static async fetch(arxivId, retries = 3) {
    if (!arxivId) return null;

    // Try arXiv API last (often rate limited)
    const arxivResult = await this.fetchFromArxivApi(arxivId, retries);
    if (arxivResult) return arxivResult;
    
    // Try Semantic Scholar first (more reliable)
    const ssResult = await this.fetchFromSemanticScholar(arxivId, retries);
    if (ssResult) return ssResult;

    // Try OpenAlex
    const openalexResult = await this.fetchFromOpenAlex(arxivId, retries);
    if (openalexResult) return openalexResult;

    
    return null;
  }

  static async fetchFromSemanticScholar(arxivId, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const url = `${SEMANTIC_API}${arxivId}?fields=title,authors,abstract,year,venue,externalIds,url`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(url, { 
          signal: controller.signal,
          headers: { 'Accept': 'application/json' }
        });
        clearTimeout(timeout);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        return this.parseSemanticResponse(data, arxivId);
      } catch (e) {
        console.warn(`[PaperMetadataFetcher] Semantic Scholar attempt ${attempt} failed: ${e.message}`);
        if (attempt < retries) await new Promise(r => setTimeout(r, 1500));
      }
    }
    return null;
  }

  static async fetchFromOpenAlex(arxivId, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const url = `${OPENALEX_API}${arxivId}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        
        const headers = { 'Accept': 'application/json' };
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
        if (attempt < retries) await new Promise(r => setTimeout(r, 1500));
      }
    }
    return null;
  }

  static parseOpenAlexResponse(data, arxivId) {
    try {
      const title = data.title || `arXiv:${arxivId}`;
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
        const timeout = setTimeout(() => controller.abort(), 15000);
        
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        
        const text = await response.text();
        return this.parseArxivResponse(text, arxivId);
      } catch (e) {
        console.warn(`[PaperMetadataFetcher] arXiv API attempt ${attempt}/${retries} failed for ${arxivId}: ${e.message}`);
        if (attempt < retries) await new Promise(r => setTimeout(r, 2000));
      }
    }
    
    console.error(`[PaperMetadataFetcher] All APIs failed for ${arxivId}`);
    return null;
  }

  static parseSemanticResponse(data, arxivId) {
    try {
      const authors = (data.authors || []).map(a => a.name).join(', ');
      const externalIds = data.externalIds || {};
      const pdfUrl = externalIds.DOI ? `https://arxiv.org/pdf/${arxivId}` : data.url || `https://arxiv.org/abs/${arxivId}`;
      
      return {
        title: data.title || `arXiv:${arxivId}`,
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

      const published = extract('published');
      const pdfLink = `https://arxiv.org/pdf/${arxivId}`;
      const absLink = `https://arxiv.org/abs/${arxivId}`;

      return {
        title: title || `arXiv:${arxivId}`,
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

class EmailParser {
  static extractArxivIds(html = '', text = '') {
    const ids = new Set();
    const patterns = [
      /arxiv\.org\/abs\/(\d{4}\.\d{4,5})/gi,
      /arxiv\.org\/pdf\/(\d{4}\.\d{4,5})/gi,
      /arxiv:(\d{4}\.\d{4,5})/gi,
      /(\d{4}\.\d{4,5})/g,
    ];

    const content = html + ' ' + text;
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const id = match[1] || match[0];
        if (/^\d{4}\.\d{4,5}$/.test(id)) {
          ids.add(id);
        }
      }
    }
    return Array.from(ids);
  }

  static async parse(stream) {
    try {
      const parsed = await simpleParser(stream);
      if (!parsed) return null;
      return {
        arxivIds: this.extractArxivIds(parsed.html || '', parsed.text || ''),
        htmlBody: parsed.html || '',
        textBody: parsed.text || '',
        subject: parsed.subject || '',
        from: parsed.from?.text || '',
      };
    } catch (e) {
      console.error('[EmailParser] Parse error:', e.message);
      return null;
    }
  }
}

class EmailSyncService {
  constructor() {
    this.imap = null;
    this.isConnected = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (this.isConnected) return resolve();

      this.imap = new Imap({
        user: EMAIL_CONFIG.IMAP.USER,
        password: EMAIL_CONFIG.IMAP.PASSWORD,
        host: EMAIL_CONFIG.IMAP.HOST,
        port: EMAIL_CONFIG.IMAP.PORT,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
      });

      this.imap.once('ready', () => {
        this.isConnected = true;
        console.log('[Email] IMAP connected');
        resolve();
      });

      this.imap.once('error', (err) => {
        console.error('[Email] IMAP error:', err.message);
        this.isConnected = false;
        reject(err);
      });

      this.imap.connect();
    });
  }

  disconnect() {
    if (this.imap && this.isConnected) {
      this.imap.end();
      this.isConnected = false;
    }
  }

  async fetchEmails() {
    await this.connect();

    return new Promise((resolve, reject) => {
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - EMAIL_CONFIG.CHECK_DAYS);

      const searchCriteria = [
        ['SINCE', sinceDate.toISOString().split('T')[0]],
        ['FROM', EMAIL_CONFIG.SENDER],
      ];

      this.imap.openBox(EMAIL_CONFIG.FOLDER, false, (err, box) => {
        if (err) {
          console.error('[Email] Failed to open folder:', err.message);
          return reject(err);
        }

        this.imap.search(searchCriteria, (err, results) => {
          if (err || !results || results.length === 0) {
            console.log('[Email] No new emails found');
            return resolve([]);
          }

          const uids = results.slice(-EMAIL_CONFIG.MAX_EMAILS);
          console.log(`[Email] Found ${uids.length} emails to process`);

          const emailData = [];

          this.imap.fetch(uids, {
            bodies: '',
            markSeen: false,
            requestUIDs: true,
          }).on('message', (msg) => {
            const uid = msg.uid;
            const chunks = [];
            msg.on('body', (stream) => {
              stream.on('data', (chunk) => chunks.push(chunk));
              stream.on('end', async () => {
                const buffer = Buffer.concat(chunks);
                const parsed = await EmailParser.parse(buffer);
                if (parsed) {
                  parsed.uid = uid;
                  emailData.push(parsed);
                }
              });
            });
          }).on('error', (err) => {
            console.error('[Email] Fetch error:', err.message);
          }).on('end', () => {
            setTimeout(() => resolve(emailData), 500);
          });
        });
      });
    });
  }

  markEmailsAsRead(uids) {
    if (!uids || uids.length === 0) return;
    const validUids = uids.filter(uid => uid && typeof uid === 'number');
    if (validUids.length === 0) {
      console.warn('[Email] No valid UIDs to mark as read');
      return;
    }
    this.imap.setFlags(validUids, ['\\Seen'], (err) => {
      if (err) {
        console.warn('[Email] Failed to mark emails as read:', err.message);
      } else {
        console.log(`[Email] Marked ${uids.length} emails as read`);
      }
    });
  }

  async sync() {
    syncStatus.running = true;
    syncStatus.errors = [];
    syncStatus.emailsProcessed = 0;
    syncStatus.papersImported = 0;

    console.log('[EmailSync] Starting sync...');

    try {
      const emails = await this.fetchEmails();
      syncStatus.emailsProcessed = emails.length;

      const emailArxivMap = {};
      for (const email of emails) {
        if (!email.uid) continue;
        emailArxivMap[email.uid] = email.arxivIds;
      }

      const allArxivIds = new Set();
      for (const email of emails) {
        for (const id of email.arxivIds) {
          allArxivIds.add(id);
        }
      }

      console.log(`[EmailSync] Found ${allArxivIds.size} unique arXiv IDs`);

      for (const arxivId of allArxivIds) {
        const existing = db.queryOne('SELECT id FROM papers WHERE arxiv_id = ?', [arxivId]);
        if (existing) {
          continue;
        }

        db.runQuery(`
          INSERT INTO papers (arxiv_id, priority, status, source_type, title)
          VALUES (?, ?, ?, ?, ?)
        `, [arxivId, 3, 'unread', 'paper', `arXiv:${arxivId}`]);
        
        syncStatus.papersImported++;
      }

      const processedUids = [];
      for (const [uid, arxivIds] of Object.entries(emailArxivMap)) {
        const allImported = arxivIds.every(id => !db.queryOne('SELECT id FROM papers WHERE arxiv_id = ? AND title LIKE ?', [id, 'arXiv:%']));
        if (allImported) {
          processedUids.push(uid);
        }
      }

      if (processedUids.length > 0) {
        this.markEmailsAsRead(processedUids);
      }

      syncStatus.lastRun = new Date().toISOString();
      console.log(`[EmailSync] Complete. Added ${syncStatus.papersImported} papers`);
    } catch (e) {
      console.error('[EmailSync] Error:', e.message);
      syncStatus.errors.push(e.message);
    } finally {
      syncStatus.running = false;
      this.disconnect();
    }
  }

  static getStatus() {
    return { ...syncStatus };
  }
}

let emailService = null;
let schedulerTimer = null;
let isSchedulerRunning = false;

function startEmailSync() {
  if (!EMAIL_CONFIG.ENABLED) {
    console.log('[EmailSync] Disabled in config');
    return;
  }

  emailService = new EmailSyncService();
  console.log('[EmailSync] Service initialized');

  scheduleNextSync();

  setInterval(() => {
    if (!syncStatus.running) {
      scheduleNextSync();
    }
  }, 60000);
}

function scheduleNextSync() {
  if (isSchedulerRunning) return;

  const now = new Date();
  const targetHour = EMAIL_CONFIG.CRON_HOUR;
  const targetMinute = EMAIL_CONFIG.CRON_MINUTE;

  let nextRun = new Date(now);
  nextRun.setHours(targetHour, targetMinute, 0, 0);

  if (nextRun <= now) {
    nextRun.setDate(nextRun.getDate() + 1);
  }

  const delay = nextRun.getTime() - now.getTime();
  console.log(`[EmailSync] Next run scheduled: ${nextRun.toLocaleString()}`);

  schedulerTimer = setTimeout(async () => {
    isSchedulerRunning = false;
    if (emailService) {
      await emailService.sync();
    }
    scheduleNextSync();
  }, delay);

  isSchedulerRunning = true;
}

function triggerManualSync() {
  if (emailService && !syncStatus.running) {
    emailService.sync();
  }
}

function getSyncStatus() {
  return EmailSyncService.getStatus();
}

class EmailSyncBackgroundService {
  constructor(options = {}) {
    this.name = 'emailSync';
    this.label = 'Email Sync';
    this.enabled = options.enabled !== false;
    this.intervalMs = 0;
    this.isRunning = false;
    this.lastRun = null;
    this.lastError = null;
    this.emailService = null;
    this.timer = null;
    this.isScheduled = false;
    this.syncStatus = {
      running: false,
      lastRun: null,
      emailsProcessed: 0,
      papersImported: 0,
      errors: [],
    };
  }

  start() {
    if (!this.enabled) {
      console.log(`[${this.label}] Disabled in config`);
      return;
    }

    this.emailService = new EmailSyncService();
    console.log(`[${this.label}] Service initialized`);

    this._scheduleNextSync();
    this._startChecker();
  }

  _startChecker() {
    setInterval(() => {
      if (!this.syncStatus.running) {
        this._scheduleNextSync();
      }
    }, 60000);
  }

  _scheduleNextSync() {
    if (this.isScheduled) return;

    const now = new Date();
    const targetHour = EMAIL_CONFIG.CRON_HOUR;
    const targetMinute = EMAIL_CONFIG.CRON_MINUTE;

    let nextRun = new Date(now);
    nextRun.setHours(targetHour, targetMinute, 0, 0);

    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }

    const delay = nextRun.getTime() - now.getTime();
    console.log(`[${this.label}] Next run scheduled: ${nextRun.toLocaleString()}`);

    this.timer = setTimeout(async () => {
      this.isScheduled = false;
      if (this.emailService) {
        await this.emailService.sync();
        this.syncStatus = { ...this.emailService.syncStatus };
      }
      this._scheduleNextSync();
    }, delay);

    this.isScheduled = true;
  }

  async run() {
    if (this.isRunning) {
      console.log(`[${this.label}] Already running, skipping`);
      return;
    }

    this.isRunning = true;
    this.syncStatus.running = true;

    try {
      if (this.emailService) {
        await this.emailService.sync();
        this.syncStatus = { ...this.emailService.syncStatus };
      }
      this.lastRun = new Date().toISOString();
    } catch (e) {
      this.lastError = e.message;
      this.syncStatus.errors.push(e.message);
      console.error(`[${this.label}] Error:`, e.message);
    } finally {
      this.isRunning = false;
      this.syncStatus.running = false;
    }
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.isScheduled = false;
  }

  triggerManualSync() {
    if (this.emailService && !this.syncStatus.running) {
      this.emailService.sync();
    }
  }

  getStatus() {
    return {
      name: this.name,
      label: this.label,
      enabled: this.enabled,
      running: this.isRunning || this.syncStatus.running,
      lastRun: this.lastRun,
      lastError: this.lastError,
      processed: this.syncStatus.emailsProcessed,
      papersImported: this.syncStatus.papersImported,
      errors: this.syncStatus.errors.length,
    };
  }
}

module.exports = {
  startEmailSync,
  triggerManualSync,
  getSyncStatus,
  EmailParser,
  PaperMetadataFetcher,
  EmailSyncService,
  EmailSyncBackgroundService,
};