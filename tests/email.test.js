/**
 * Tests for Email Service
 * Run with: npm test
 */

const { PassThrough } = require('stream');

// Mock mailparser before loading email service
jest.mock('mailparser', () => {
  const actual = jest.requireActual('mailparser');
  return {
    ...actual,
    simpleParser: jest.fn(),
  };
});

const {
  EmailParser,
  PaperMetadataFetcher,
  EmailSyncService,
  EmailSyncScheduler,
} = require('../src/services/email');

describe('EmailParser', () => {
  describe('extractArxivIds', () => {
    it('should extract arxiv IDs from HTML body', () => {
      const html = '<p>Check out <a href="https://arxiv.org/abs/2301.12345">this paper</a></p>';
      const ids = EmailParser.extractArxivIds(html, '');
      expect(ids).toEqual(['2301.12345']);
    });

    it('should extract arxiv IDs from text body', () => {
      const text = 'See arxiv:2301.12345 for more details';
      const ids = EmailParser.extractArxivIds('', text);
      expect(ids).toEqual(['2301.12345']);
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
      expect(ids).toEqual(['2301.12345']);
    });
  });

  describe('parse', () => {
    const simpleParser = require('mailparser').simpleParser;

    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should parse email stream and extract arxiv IDs', async () => {
      const mockStream = new PassThrough();
      const mockHtml = '<p>Check out arxiv.org/abs/2301.12345</p>';

      simpleParser.mockImplementation((stream, callback) => {
        setImmediate(() => callback(null, { html: mockHtml, text: '' }));
      });

      const result = await EmailParser.parse(mockStream);
      expect(result.arxivIds).toContain('2301.12345');
      expect(result.htmlBody).toBe(mockHtml);
    });

    it('should return null on parse error', async () => {
      const mockStream = new PassThrough();

      simpleParser.mockImplementation((stream, callback) => {
        setImmediate(() => callback(new Error('Parse error'), null));
      });

      const result = await EmailParser.parse(mockStream);
      expect(result).toBeNull();
    });

    it('should return null when parsed is empty', async () => {
      const mockStream = new PassThrough();

      simpleParser.mockImplementation((stream, callback) => {
        setImmediate(() => callback(null, null));
      });

      const result = await EmailParser.parse(mockStream);
      expect(result).toBeNull();
    });
  });
});

describe('PaperMetadataFetcher', () => {
  describe('reconstructAbstract', () => {
    it('should reconstruct abstract from inverted index', () => {
      const invertedIndex = {
        'machine': [0],
        'learning': [1],
        'is': [2],
        'great': [3]
      };
      const abstract = PaperMetadataFetcher.reconstructAbstract(invertedIndex);
      expect(abstract).toBe('machine learning is great');
    });

    it('should handle empty inverted index', () => {
      const abstract = PaperMetadataFetcher.reconstructAbstract({});
      expect(abstract).toBe('');
    });

    it('should handle null inverted index', () => {
      const abstract = PaperMetadataFetcher.reconstructAbstract(null);
      expect(abstract).toBe('');
    });

    it('should handle undefined inverted index', () => {
      const abstract = PaperMetadataFetcher.reconstructAbstract(undefined);
      expect(abstract).toBe('');
    });

    it('should handle words at non-sequential positions', () => {
      const invertedIndex = {
        'deep': [0],
        'neural': [2],
        'networks': [5]
      };
      const abstract = PaperMetadataFetcher.reconstructAbstract(invertedIndex);
      expect(abstract).toBe('deep neural networks');
    });

    it('should handle multiple positions per word', () => {
      const invertedIndex = {
        'learning': [0, 2],
        'machine': [1]
      };
      const abstract = PaperMetadataFetcher.reconstructAbstract(invertedIndex);
      expect(abstract).toBe('learning machine learning');
    });
  });

  describe('fetch', () => {
    it('should return null for empty arxivId', async () => {
      const result = await PaperMetadataFetcher.fetch('');
      expect(result).toBeNull();
    });

    it('should return null for null arxivId', async () => {
      const result = await PaperMetadataFetcher.fetch(null);
      expect(result).toBeNull();
    });
  });
});

describe('EmailSyncService', () => {
  describe('Instance Methods', () => {
    it('should have sync method', () => {
      expect(typeof EmailSyncService.sync).toBe('function');
    });

    it('should have processEmails method', () => {
      expect(typeof EmailSyncService.processEmails).toBe('function');
    });

    it('should have processPapers method', () => {
      expect(typeof EmailSyncService.processPapers).toBe('function');
    });
  });

  describe('Constructor', () => {
    it('should be creatable', () => {
      const service = new EmailSyncService();
      expect(service).toBeDefined();
      expect(typeof service.start).toBe('function');
      expect(typeof service.stop).toBe('function');
      expect(typeof service.trigger).toBe('function');
      expect(typeof service.getStatus).toBe('function');
    });
  });
});
