const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const config = require('../../config');

if (!isMainThread) {
  parentPort.on('message', async (msg) => {
    const { task } = msg;

    try {
      let result;
      switch (task) {
        case 'metadata': {
          const { MetadataFetchService } = require('./metadataFetch');
          const svc = new MetadataFetchService({});
          result = await svc.execute();
          break;
        }
        case 'markdown': {
          const { MarkdownConversionService } = require('./markdownConversion');
          const svc = new MarkdownConversionService({});
          result = await svc.execute();
          break;
        }
        case 'cache': {
          const { CacheBackgroundService } = require('./cache');
          const svc = new CacheBackgroundService({});
          result = await svc.execute();
          break;
        }
        case 'layout': {
          const { LayoutAnalysisBackgroundService } = require('./layoutAnalysis');
          const svc = new LayoutAnalysisBackgroundService({});
          result = await svc.execute();
          break;
        }
        case 'summary': {
          const { AISummaryService } = require('./aiSummary');
          const svc = new AISummaryService({});
          result = await svc.execute();
          break;
        }
        case 'terminology': {
          const { TerminologyService } = require('./terminology');
          const svc = new TerminologyService({});
          result = await svc.execute();
          break;
        }
        case 'emailSync': {
          const { EmailSyncBackgroundService } = require('./email');
          const svc = new EmailSyncBackgroundService({});
          result = await svc.execute();
          break;
        }
        default:
          result = { error: `Unknown task: ${task}` };
      }
      parentPort.postMessage({ success: true, result });
    } catch (e) {
      parentPort.postMessage({ success: false, error: e.message });
    }
  });

  parentPort.postMessage({ ready: true });
  return;
}

class BackgroundWorkerManager {
  constructor() {
    this.maxWorkers = config.BG_WORKER?.MAX_WORKER_THREADS || 3;
    this.idleThresholdMs = config.BG_WORKER?.IDLE_THRESHOLD_MS || 1800000;
    this.serviceInstances = new Map();
    this.lastActivity = new Map();
    this.bgTaskStatus = {
      metadata: { running: false, lastRun: null, error: null },
      markdown: { running: false, lastRun: null, error: null },
      cache: { running: false, lastRun: null, error: null },
      layout: { running: false, lastRun: null, error: null },
      summary: { running: false, lastRun: null, error: null },
      terminology: { running: false, lastRun: null, error: null },
      emailSync: { running: false, lastRun: null, error: null },
    };
    this.cleanupInterval = setInterval(() => this._cleanupIdleServices(), 60000);
  }

  _cleanupIdleServices() {
    const now = Date.now();
    for (const [task, lastActive] of this.lastActivity.entries()) {
      if (now - lastActive > this.idleThresholdMs) {
        this.serviceInstances.delete(task);
        this.lastActivity.delete(task);
        console.log(`[BgWorker] Cleaned up idle service: ${task}`);
      }
    }
  }

  _getService(task) {
    if (this.serviceInstances.has(task)) {
      this.lastActivity.set(task, Date.now());
      return this.serviceInstances.get(task);
    }

    const instance = this._createServiceInstance(task);
    this.serviceInstances.set(task, instance);
    this.lastActivity.set(task, Date.now());
    return instance;
  }

  _createServiceInstance(task) {
    switch (task) {
      case 'metadata':
        const { MetadataFetchService } = require('./metadataFetch');
        return new MetadataFetchService({});
      case 'markdown':
        const { MarkdownConversionService } = require('./markdownConversion');
        return new MarkdownConversionService({});
      case 'cache':
        const { CacheBackgroundService } = require('./cache');
        return new CacheBackgroundService({});
      case 'layout':
        const { LayoutAnalysisBackgroundService } = require('./layoutAnalysis');
        return new LayoutAnalysisBackgroundService({});
      case 'summary':
        const { AISummaryService } = require('./aiSummary');
        return new AISummaryService({});
      case 'terminology':
        const { TerminologyService } = require('./terminology');
        return new TerminologyService({});
      case 'emailSync':
        const { EmailSyncBackgroundService } = require('./email');
        return new EmailSyncBackgroundService({});
      default:
        throw new Error(`Unknown task: ${task}`);
    }
  }

  async _runWorker(task) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(__filename);

      worker.once('message', (msg) => {
        if (msg.ready) {
          worker.postMessage({ task });
        } else if (msg.success) {
          resolve(msg.result);
          worker.terminate();
        } else {
          reject(new Error(msg.error));
          worker.terminate();
        }
      });

      worker.once('error', (e) => {
        reject(e);
        worker.terminate();
      });

      setTimeout(() => {
        worker.terminate();
        reject(new Error('Worker timeout'));
      }, 120000);
    });
  }

  async runTask(task) {
    try {
      const result = await this._runWorker(task);
      return { success: true, task, result };
    } catch (e) {
      return { success: false, task, error: e.message };
    }
  }

  updateTaskStatus(task, success, error) {
    this.bgTaskStatus[task] = {
      running: false,
      lastRun: new Date().toISOString(),
      error: error || null,
    };
  }

  getBgTaskStatus() {
    return { ...this.bgTaskStatus };
  }

  async runBgTask(task) {
    if (this.bgTaskStatus[task]?.running) {
      return { success: false, error: 'already running' };
    }
    this.bgTaskStatus[task] = { running: true, lastRun: null, error: null };
    return await this.runTask(task);
  }

  startBackgroundTasks() {
    const tasks = [
      { task: 'emailSync', delay: 1000 },
      { task: 'metadata', delay: 2000 },
      { task: 'markdown', delay: 3000 },
      { task: 'cache', delay: 4000 },
      { task: 'layout', delay: 5000 },
      { task: 'summary', delay: 6000 },
      { task: 'terminology', delay: 7000 },
    ];

    for (const { task, delay } of tasks) {
      setTimeout(async () => {
        try {
          console.log(`[BG] Running ${task}...`);
          this.bgTaskStatus[task] = { running: true, lastRun: null, error: null };
          const result = await this.runTask(task);
          this.updateTaskStatus(task, result?.success, result?.error);
          console.log(`[BG] ${task}:`, result?.success ? 'done' : result?.error);
        } catch (e) {
          console.error(`[BG] ${task} error:`, e.message);
          this.updateTaskStatus(task, false, e.message);
        }
      }, delay);
    }
  }
}

const bgWorkerManager = new BackgroundWorkerManager();

module.exports = bgWorkerManager;
module.exports.BackgroundWorkerManager = BackgroundWorkerManager;
