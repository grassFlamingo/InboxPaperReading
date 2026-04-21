/**
 * Tests for Email Service
 * Run with: npm test
 */

const { EmailParser, EmailSyncService } = require('../src/services/email');
const { PaperMetadataFetcher } = require('../src/services/metadataFetch');

describe('EmailParser', () => {
  describe('extractArxivIds', () => {
    it('should extract arxiv IDs from HTML body', () => {
      const html = '<p>Check out <a href="https://arxiv.org/abs/2301.12345">this paper</a></p>';
      const ids = EmailParser.extractArxivIds(html, '');
      expect(ids).toContain('2301.12345');
    });

    it('should extract arxiv IDs from text body', () => {
      const text = 'See arxiv:2301.12345 for more details';
      const ids = EmailParser.extractArxivIds('', text);
      expect(ids).toContain('2301.12345');
    });

    it('should extract multiple arxiv IDs', () => {
      const html = 'Paper 1: arxiv.org/abs/2301.12345, Paper 2: arxiv.org/pdf/2302.67890';
      const ids = EmailParser.extractArxivIds(html, '');
      expect(ids.length).toBe(2);
      expect(ids).toContain('2301.12345');
      expect(ids).toContain('2302.67890');
    });

    it('should handle empty input', () => {
      const ids = EmailParser.extractArxivIds('', '');
      expect(ids).toEqual([]);
    });

    it('should deduplicate IDs', () => {
      const html = 'See arxiv.org/abs/2301.12345 and arxiv.org/abs/2301.12345 again';
      const ids = EmailParser.extractArxivIds(html, '');
      expect(ids.length).toBe(1);
      expect(ids).toContain('2301.12345');
    });
  });

  describe('parse', () => {
    it('should extract arxiv IDs from parsed email', async () => {
      const html = '<p>Check out arxiv.org/abs/2301.12345</p>';
      const text = 'See arxiv:2302.56789';
      
      const result = EmailParser.extractArxivIds(html, text);
      expect(result).toContain('2301.12345');
      expect(result).toContain('2302.56789');
    });

    it('should return empty array for email without arxiv IDs', () => {
      const result = EmailParser.extractArxivIds('<p>No arxiv here</p>', 'Just text');
      expect(result).toEqual([]);
    });
  });
});

describe('PaperMetadataFetcher', () => {
  describe('fetch', () => {
    it('should return null for empty arxivId', async () => {
      const result = await PaperMetadataFetcher.fetch('');
      expect(result).toBeNull();
    });

    it('should return null for null arxivId', async () => {
      const result = await PaperMetadataFetcher.fetch(null);
      expect(result).toBeNull();
    });

    it('should return null for undefined arxivId', async () => {
      const result = await PaperMetadataFetcher.fetch(undefined);
      expect(result).toBeNull();
    });
  });
});

describe('EmailSyncService', () => {
  describe('Instance Methods', () => {
    it('should have sync method', () => {
      const service = new EmailSyncService();
      expect(typeof service.sync).toBe('function');
    });

    it('should have connect method', () => {
      const service = new EmailSyncService();
      expect(typeof service.connect).toBe('function');
    });

    it('should have disconnect method', () => {
      const service = new EmailSyncService();
      expect(typeof service.disconnect).toBe('function');
    });
  });

  describe('Constructor', () => {
    it('should be creatable', () => {
      const service = new EmailSyncService();
      expect(service).toBeDefined();
      expect(service.isConnected).toBe(false);
      expect(service.imap).toBeNull();
    });
  });
});