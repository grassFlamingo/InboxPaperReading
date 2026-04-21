const { Worker, isMainThread, parentPort } = require('worker_threads');
const db = require('../db/database');
const config = require('../../config');

const TASK_NAMES = [
  'metadata',
  'markdown',
  'cache',
  'layout',
  'summary',
  'terminology',
];

const EMAIL_TASK_NAME = 'emailSync';

const DEFAULT_INTERVAL_MS = config.BG_WORKER?.DEFAULT_INTERVAL_MS || 600000;
const DEFAULT_TIMEOUT_MS = config.BG_WORKER?.DEFAULT_TIMEOUT_MS || 1800000;
const HEARTBEAT_INTERVAL_MS = config.BG_WORKER?.HEARTBEAT_INTERVAL_MS || 30000;
const WORKER_CHECK_INTERVAL_MS = config.BG_WORKER?.WORKER_CHECK_INTERVAL_MS || 30000;

let heartbeatInterval = null;

if (!isMainThread) {
  db.connect().then(() => {
    parentPort.postMessage({ ready: true });
  }).catch((e) => {
    console.error('[Worker] DB connect error:', e.message);
  });

  parentPort.on('message', async (msg) => {
    const { task, args = {} } = msg;

    try {
      parentPort.postMessage({ status: 'running', task });

      if (task === EMAIL_TASK_NAME) {
        heartbeatInterval = setInterval(() => {
          parentPort.postMessage({ status: 'running', task, heartbeat: true });
        }, HEARTBEAT_INTERVAL_MS);
      }

      let result;
      switch (task) {
        case 'metadata': {
          const { MetadataFetchService } = require('./metadataFetch');
          const svc = new MetadataFetchService(args);
          result = await svc.execute();
          break;
        }
        case 'markdown': {
          const { MarkdownConversionService } = require('./markdownConversion');
          const svc = new MarkdownConversionService(args);
          result = await svc.execute();
          break;
        }
        case 'cache': {
          const { CacheBackgroundService } = require('./cache');
          const svc = new CacheBackgroundService(args);
          result = await svc.execute();
          break;
        }
        case 'layout': {
          const { LayoutAnalysisBackgroundService } = require('./layoutAnalysis');
          const svc = new LayoutAnalysisBackgroundService(args);
          result = await svc.execute();
          break;
        }
        case 'summary': {
          const { AISummaryService } = require('./aiSummary');
          const svc = new AISummaryService(args);
          result = await svc.execute();
          break;
        }
        case 'terminology': {
          const { TerminologyService } = require('./terminology');
          const svc = new TerminologyService(args);
          result = await svc.execute();
          break;
        }
        case 'emailSync': {
          const { EmailSyncBackgroundService } = require('./email');
          const svc = new EmailSyncBackgroundService(args);
          result = await svc.run();
          break;
        }
        default:
          result = { error: `Unknown task: ${task}` };
      }

      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }

      parentPort.postMessage({ success: true, result });
    } catch (e) {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      parentPort.postMessage({ success: false, error: e.message });
    }
  });
}

class TaskManager {
  constructor() {
    this.maxWorkers = config.BG_WORKER?.MAX_WORKER_THREADS || 3;
    this.serviceInstances = new Map();
    this.lastActivity = new Map();

    this.schedules = new Map();
    this.timers = new Map();
    this.isRunning = new Map();

    this.workers = new Map();
    this.checkInterval = null;
  }

  async init() {
    await this._loadSchedules();
    this._startWorkerChecker();
    console.log('[TaskManager] Initialized with', this.schedules.size, 'tasks');
  }

  _startWorkerChecker() {
    this.checkInterval = setInterval(() => {
      this._checkWorkerTimeouts();
    }, WORKER_CHECK_INTERVAL_MS);
  }

  _checkWorkerTimeouts() {
    const now = Date.now();
    for (const [task, w] of this.workers.entries()) {
      const elapsed = now - w.startedAt;

      if (w.status === 'pending' && elapsed > w.timeoutMs) {
        console.log(`[TaskManager] ${task}: pending timeout (${elapsed}ms), terminating`);
        w.worker.terminate();
        this.workers.delete(task);
        continue;
      }

      if (w.status === 'running') {
        const heartbeatElapsed = now - w.lastHeartbeat;
        if (heartbeatElapsed > w.timeoutMs) {
          console.log(`[TaskManager] ${task}: heartbeat timeout (no activity for ${heartbeatElapsed}ms), terminating`);
          w.worker.terminate();
          this.workers.delete(task);
        }
      }
    }
  }

  async _loadSchedules() {
    for (const taskName of TASK_NAMES) {
      const existing = db.queryOne('SELECT * FROM bg_task_status WHERE task_name = ?', [taskName]);
      if (!existing) {
        db.run(
          'INSERT INTO bg_task_status (task_name, enabled, interval_ms, last_status) VALUES (?, 1, ?, ?)',
          [taskName, DEFAULT_INTERVAL_MS, 'idle']
        );
      }
    }

    const emailExisting = db.queryOne('SELECT * FROM bg_task_status WHERE task_name = ?', [EMAIL_TASK_NAME]);
    if (!emailExisting) {
      db.run(
        'INSERT INTO bg_task_status (task_name, enabled, interval_ms, last_status) VALUES (?, 1, ?, ?)',
        [EMAIL_TASK_NAME, DEFAULT_INTERVAL_MS, 'idle']
      );
    }

    const rows = db.queryAll('SELECT * FROM bg_task_status');
    for (const row of rows) {
      this.schedules.set(row.task_name, row);
    }
  }

  start() {
    console.log('[TaskManager] Starting all task schedules...');

    for (const [taskName, schedule] of this.schedules.entries()) {
      if (taskName === EMAIL_TASK_NAME) {
        console.log(`[TaskManager] ${taskName}: uses CRON scheduling, skipping interval`);
        continue;
      }

      if (!schedule.enabled) {
        console.log(`[TaskManager] ${taskName}: disabled, skipping`);
        continue;
      }

      const intervalMs = schedule.interval_ms || DEFAULT_INTERVAL_MS;
      console.log(`[TaskManager] ${taskName}: scheduling every ${intervalMs}ms`);

      const timer = setInterval(() => {
        this._checkAndRun(taskName);
      }, intervalMs);

      this.timers.set(taskName, timer);

      setTimeout(() => {
        this._checkAndRun(taskName);
      }, config.BG_WORKER?.DELAY_MS || 5000);
    }
  }

  stop() {
    for (const [taskName, timer] of this.timers.entries()) {
      clearInterval(timer);
    }
    this.timers.clear();
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    console.log('[TaskManager] Stopped all schedules');
  }

  _cleanupIdleServices() {
    const now = Date.now();
    const idleThresholdMs = config.BG_WORKER?.IDLE_THRESHOLD_MS || 1800000;
    for (const [task, lastActive] of this.lastActivity.entries()) {
      if (now - lastActive > idleThresholdMs) {
        this.serviceInstances.delete(task);
        this.lastActivity.delete(task);
        console.log(`[TaskManager] Cleaned up idle service: ${task}`);
      }
    }
  }

  _getService(task, args = {}) {
    if (this.serviceInstances.has(task)) {
      this.lastActivity.set(task, Date.now());
      return this.serviceInstances.get(task);
    }

    const instance = this._createServiceInstance(task, args);
    this.serviceInstances.set(task, instance);
    this.lastActivity.set(task, Date.now());
    return instance;
  }

  _createServiceInstance(task, args = {}) {
    switch (task) {
      case 'metadata':
        const { MetadataFetchService } = require('./metadataFetch');
        return new MetadataFetchService(args);
      case 'markdown':
        const { MarkdownConversionService } = require('./markdownConversion');
        return new MarkdownConversionService(args);
      case 'cache':
        const { CacheBackgroundService } = require('./cache');
        return new CacheBackgroundService(args);
      case 'layout':
        const { LayoutAnalysisBackgroundService } = require('./layoutAnalysis');
        return new LayoutAnalysisBackgroundService(args);
      case 'summary':
        const { AISummaryService } = require('./aiSummary');
        return new AISummaryService(args);
      case 'terminology':
        const { TerminologyService } = require('./terminology');
        return new TerminologyService(args);
      case 'emailSync':
        const { EmailSyncBackgroundService } = require('./email');
        return new EmailSyncBackgroundService(args);
      default:
        throw new Error(`Unknown task: ${task}`);
    }
  }

  async _runWorker(task, args = {}) {
    const timeoutMs = config.BG_WORKER?.TASK_TIMEOUT_MS?.[task]
      || config.BG_WORKER?.DEFAULT_TIMEOUT_MS
      || DEFAULT_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const worker = new Worker(__filename);

      this.workers.set(task, {
        status: 'pending',
        worker,
        startedAt: Date.now(),
        timeoutMs,
        lastHeartbeat: Date.now()
      });

      worker.on('message', (msg) => {
        if (msg.ready) {
          worker.postMessage({ task, args });
        } else if (msg.status === 'running') {
          const w = this.workers.get(task);
          if (w) {
            w.status = 'running';
            w.lastHeartbeat = Date.now();
          }
        } else if (msg.success) {
          this._updateStatus(task, 'success', null, msg.result?.processed || 0);
          resolve(msg.result);
          this.workers.delete(task);
          worker.terminate();
        } else {
          this._updateStatus(task, 'error', msg.error, 0);
          reject(new Error(msg.error));
          this.workers.delete(task);
          worker.terminate();
        }
      });

      worker.once('error', (e) => {
        reject(e);
        this.workers.delete(task);
        worker.terminate();
      });

      worker.once('exit', () => {
        this.workers.delete(task);
      });
    });
  }

  async runTask(task, args = {}) {
    try {
      if (task === EMAIL_TASK_NAME) {
        const { EmailSyncBackgroundService, EmailSyncService } = require('./email');
        const svc = new EmailSyncBackgroundService(args);
        if (!svc.emailService) {
          svc.emailService = new EmailSyncService();
        }
        const result = await svc.run();
        db.run(
          'UPDATE bg_task_status SET last_status = ?, last_error = ?, last_run = CURRENT_TIMESTAMP, processed_count = ? WHERE task_name = ?',
          ['success', null, result?.papersImported || 0, task]
        );
        db.save();
        
        if (result?.papersImported > 0) {
          console.log(`[TaskManager] Email sync added ${result.papersImported} papers, triggering related tasks...`);
          setTimeout(() => this._triggerRelatedTasks(), 1000);
        }
        
        return { success: true, task, result };
      }
      const result = await this._runWorker(task, args);
      return { success: true, task, result };
    } catch (e) {
      await this._updateStatus(task, 'error', e.message, 0);
      return { success: false, task, error: e.message };
    }
  }

  _triggerRelatedTasks() {
    const relatedTasks = config.BG_WORKER?.EMAIL_SYNC_TRIGGERED_TASKS || [];
    for (const taskName of relatedTasks) {
      if (this.isRunning.get(taskName)) {
        console.log(`[TaskManager] ${taskName}: already running, skipping trigger`);
        continue;
      }
      const schedule = this.schedules.get(taskName);
      if (!schedule || !schedule.enabled) {
        console.log(`[TaskManager] ${taskName}: disabled, skipping trigger`);
        continue;
      }
      console.log(`[TaskManager] Triggering ${taskName}...`);
      this._checkAndRun(taskName);
    }
  }

  async hasPending(task) {
    const service = this._getService(task);
    if (service && typeof service.hasPending === 'function') {
      return await service.hasPending();
    }
    return true;
  }

  getStatus() {
    const status = {};
    for (const [taskName, schedule] of this.schedules.entries()) {
      status[taskName] = {
        enabled: schedule.enabled,
        interval_ms: schedule.interval_ms,
        last_run: schedule.last_run,
        last_status: schedule.last_status,
        last_error: schedule.last_error,
        processed_count: schedule.processed_count,
      };
    }
    return status;
  }

  getWorkersStatus() {
    const status = {};
    for (const [task, w] of this.workers.entries()) {
      status[task] = {
        status: w.status,
        startedAt: new Date(w.startedAt).toISOString(),
        lastHeartbeat: new Date(w.lastHeartbeat).toISOString(),
        timeoutMs: w.timeoutMs,
        elapsedMs: Date.now() - w.startedAt
      };
    }
    return status;
  }

  async killWorker(task) {
    const w = this.workers.get(task);
    if (w) {
      w.worker.terminate();
      this.workers.delete(task);
      return { success: true, message: `Worker ${task} terminated` };
    }
    return { success: false, error: 'Worker not found or not running' };
  }

  async setEnabled(taskName, enabled) {
    db.run('UPDATE bg_task_status SET enabled = ? WHERE task_name = ?', [enabled ? 1 : 0, taskName]);
    const schedule = this.schedules.get(taskName);
    if (schedule) {
      schedule.enabled = enabled ? 1 : 0;
    }
  }

  async setInterval(taskName, intervalMs) {
    db.run('UPDATE bg_task_status SET interval_ms = ? WHERE task_name = ?', [intervalMs, taskName]);
    const schedule = this.schedules.get(taskName);
    if (schedule) {
      schedule.interval_ms = intervalMs;
    }

    const oldTimer = this.timers.get(taskName);
    if (oldTimer) {
      clearInterval(oldTimer);
    }

    if (schedule?.enabled) {
      const timer = setInterval(() => {
        this._checkAndRun(taskName);
      }, intervalMs);
      this.timers.set(taskName, timer);
    }
  }

  async _checkAndRun(taskName) {
    if (this.isRunning.get(taskName)) {
      console.log(`[TaskManager] ${taskName}: already running, skipping`);
      return;
    }

    const schedule = this.schedules.get(taskName);
    if (!schedule || !schedule.enabled) {
      return;
    }

    try {
      const pending = await this.hasPending(taskName);
      if (!pending) {
        await this._updateStatus(taskName, 'idle', null, 0);
        console.log(`[TaskManager] ${taskName}: no pending work, skipping`);
        return;
      }

      console.log(`[TaskManager] ${taskName}: running...`);
      this.isRunning.set(taskName, true);
      await this._updateStatus(taskName, 'running', null, 0);

      const result = await this.runTask(taskName);
      await this._updateStatus(
        taskName,
        result.success ? 'success' : 'error',
        result.error || null,
        result.result?.processed || 0
      );

      console.log(`[TaskManager] ${taskName}: ${result.success ? 'done' : 'failed: ' + result.error}`);
    } catch (e) {
      await this._updateStatus(taskName, 'error', e.message, 0);
      console.error(`[TaskManager] ${taskName}: error:`, e.message);
    } finally {
      this.isRunning.set(taskName, false);
    }
  }

  async _updateStatus(taskName, status, error, processedCount) {
    db.run(
      'UPDATE bg_task_status SET last_status = ?, last_error = ?, last_run = CURRENT_TIMESTAMP, processed_count = ? WHERE task_name = ?',
      [status, error || null, processedCount || 0, taskName]
    );

    const schedule = this.schedules.get(taskName);
    if (schedule) {
      schedule.last_status = status;
      schedule.last_error = error;
      schedule.last_run = new Date().toISOString();
      schedule.processed_count = processedCount || 0;
    }
  }

  startBackgroundTasks() {
    const tasks = [
      { task: 'emailSync', delay: 1000 },
    ];

    for (const { task, delay } of tasks) {
      setTimeout(async () => {
        try {
          console.log(`[BG] Running ${task}...`);
          const result = await this.runTask(task);
          console.log(`[BG] ${task}:`, result?.success ? 'done' : result?.error);
        } catch (e) {
          console.error(`[BG] ${task} error:`, e.message);
        }
      }, delay);
    }
  }
}

const taskManager = new TaskManager();

module.exports = taskManager;
module.exports.TaskManager = TaskManager;