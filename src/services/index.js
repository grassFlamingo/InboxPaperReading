const { BackgroundServiceManager } = require('./backgroundService');
const { CacheBackgroundService } = require('./cache');
const { MetadataFetchService } = require('./metadataFetch');
const { MarkdownConversionService } = require('./markdownConversion');
const { AISummaryService } = require('./aiSummary');
const { LayoutAnalysisBackgroundService } = require('./layoutAnalysis');
const { EmailSyncBackgroundService } = require('./email');
const {
  TerminologyService,
  TerminologyConsistencyService,
  TerminologyCleanupService,
  TerminologyMergeService,
  TerminologyOrganizeService
} = require('./terminology');
const config = require('../../config');

function createBackgroundServiceManager() {
  const manager = new BackgroundServiceManager();

  manager.register(new MetadataFetchService({
    enabled: true,
    initialDelayMs: config.BG_WORKER?.DELAY_MS,
  }));

  manager.register(new MarkdownConversionService({
    enabled: true,
    initialDelayMs: config.BG_WORKER?.DELAY_MS + 2000,
  }));

  manager.register(new CacheBackgroundService({
    enabled: true,
    initialDelayMs: config.BG_WORKER?.DELAY_MS + 5000,
  }));

  manager.register(new LayoutAnalysisBackgroundService({
    enabled: true,
    intervalMs: 60000,
    initialDelayMs: config.BG_WORKER?.DELAY_MS + 7000,
  }));

  manager.register(new AISummaryService({
    enabled: true,
    initialDelayMs: config.BG_WORKER?.DELAY_MS + 10000,
  }));

  manager.register(new TerminologyService({
    enabled: true,
    initialDelayMs: config.BG_WORKER?.DELAY_MS + 15000,
  }));

  manager.register(new TerminologyConsistencyService({
    enabled: true,
    intervalMs: 3600000,
    initialDelayMs: config.BG_WORKER?.DELAY_MS + 30000,
  }));

  manager.register(new TerminologyCleanupService({
    enabled: true,
    intervalMs: 1800000,
    initialDelayMs: config.BG_WORKER?.DELAY_MS + 25000,
  }));

  manager.register(new TerminologyMergeService({
    enabled: true,
    intervalMs: 7200000,
    initialDelayMs: config.BG_WORKER?.DELAY_MS + 35000,
  }));

  manager.register(new TerminologyOrganizeService({
    enabled: true,
    intervalMs: 14400000,
    initialDelayMs: config.BG_WORKER?.DELAY_MS + 40000,
  }));

  manager.register(new EmailSyncBackgroundService({
    enabled: config.EMAIL_SYNC?.ENABLED,
  }));

  return manager;
}

module.exports = {
  BackgroundServiceManager,
  createBackgroundServiceManager,
  CacheBackgroundService,
  MetadataFetchService,
  MarkdownConversionService,
  AISummaryService,
  LayoutAnalysisBackgroundService,
  EmailSyncBackgroundService,
};
