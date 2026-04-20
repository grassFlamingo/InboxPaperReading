const db = require('../db/database');
const config = require('../../config');

class BackgroundService {
  constructor(name, options = {}) {
    this.name = name;
    this.label = options.label || name;
    this.enabled = options.enabled !== false;
    this.intervalMs = options.intervalMs || 0;
    this.initialDelayMs = options.initialDelayMs || 0;
    this.isRunning = false;
    this.lastRun = null;
    this.lastError = null;
    this.timer = null;
    this.status = { processed: 0, errors: 0 };
    this.yieldInterval = 10;
  }

  _yield() {
    return new Promise(resolve => setImmediate(resolve));
  }

  _setTimeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  start() {
    if (!this.enabled) {
      console.log(`[${this.label}] Disabled in config`);
      return;
    }

    console.log(`[${this.label}] Service initializing...`);

    if (this.initialDelayMs > 0) {
      setTimeout(() => {
        this._runAsync();
        this._scheduleInterval();
      }, this.initialDelayMs);
    } else {
      this._runAsync();
      this._scheduleInterval();
    }
  }

  _runAsync() {
    setImmediate(() => this.run());
  }

  _scheduleInterval() {
    if (this.intervalMs > 0) {
      this.timer = setInterval(() => {
        this._runAsync();
      }, this.intervalMs);
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async run() {
    if (this.isRunning) {
      console.log(`[${this.label}] Already running, skipping`);
      return;
    }

    this.isRunning = true;
    this.status = { processed: 0, errors: 0 };
    this.lastError = null;
    this._processedSinceLastYield = 0;

    try {
      await this.execute();
      this.lastRun = new Date().toISOString();
    } catch (e) {
      this.lastError = e.message;
      console.error(`[${this.label}] Error:`, e.message);
    } finally {
      this.isRunning = false;
    }
  }

  async yieldIfNeeded() {
    this._processedSinceLastYield++;
    if (this._processedSinceLastYield >= this.yieldInterval) {
      this._processedSinceLastYield = 0;
      await this._yield();
    }
  }

  async execute() {
    throw new Error('execute() must be implemented by subclass');
  }

  getStatus() {
    return {
      name: this.name,
      label: this.label,
      running: this.isRunning,
      lastRun: this.lastRun,
      lastError: this.lastError,
      processed: this.status.processed,
      errors: this.status.errors,
    };
  }
}

class BackgroundServiceManager {
  constructor() {
    this.services = new Map();
  }

  register(service) {
    this.services.set(service.name, service);
    console.log(`[ServiceManager] Registered: ${service.label}`);
  }

  get(name) {
    return this.services.get(name);
  }

  getAll() {
    return Array.from(this.services.values());
  }

  startAll() {
    for (const service of this.services.values()) {
      service.start();
    }
  }

  stopAll() {
    for (const service of this.services.values()) {
      service.stop();
    }
  }

  getAllStatuses() {
    return this.getAll().map(s => s.getStatus());
  }

  getRunningServices() {
    return this.getAll().filter(s => s.isRunning);
  }
}

module.exports = {
  BackgroundService,
  BackgroundServiceManager,
};