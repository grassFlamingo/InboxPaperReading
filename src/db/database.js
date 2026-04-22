const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const config = require('../../config');

let instance = null;

class Database {
  constructor(dbPath = null) {
    this.db = null;
    this.DB_PATH = dbPath || path.join(__dirname, '../../', config.DB_PATH);
  }

  static getInstance(dbPath = null) {
    if (!instance) {
      instance = new Database(dbPath);
    }
    return instance;
  }

  connect() {
    if (this.db) return this.db;
    this.db = new DatabaseSync(this.DB_PATH);
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('PRAGMA busy_timeout=10000');
    return this.db;
  }

  save() {
  }

  queryAll(sql, params = []) {
    const stmt = this.db.prepare(sql);
    const rows = params.length > 0 ? stmt.all(...params) : stmt.all();
    return rows;
  }

  queryOne(sql, params = []) {
    const stmt = this.db.prepare(sql);
    const row = params.length > 0 ? stmt.get(...params) : stmt.get();
    return row || null;
  }

  run(sql, params = []) {
    if (params.length > 0) {
      this.db.prepare(sql).run(...params);
    } else {
      this.db.exec(sql);
    }
    this.save();
    if (sql.trim().toUpperCase().startsWith('INSERT')) {
      const stmt = this.db.prepare('SELECT last_insert_rowid() as id');
      const row = stmt.get();
      return row ? row.id : 0;
    }
    return 0;
  }

  runQuery(sql, params = []) {
    if (params.length > 0) {
      this.db.prepare(sql).run(...params);
    } else {
      this.db.exec(sql);
    }
    this.save();
    if (sql.trim().toUpperCase().startsWith('INSERT')) {
      const stmt = this.db.prepare('SELECT last_insert_rowid() as id');
      const row = stmt.get();
      return row ? row.id : 0;
    }
    return 0;
  }

  initTables() {
    this.connect();

    const sqlPath = path.join(__dirname, 'init.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    const statements = sqlContent.split(';').filter(s => s.trim());

    for (const stmt of statements) {
      if (stmt.trim()) this.db.exec(stmt);
    }
  }
}

module.exports = Database.getInstance();
