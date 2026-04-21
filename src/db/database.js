const initSqlJs = require('sql.js');
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

  async connect() {
    if (!this.db) {
      const SQL = await initSqlJs();
      const fileBuffer = fs.existsSync(this.DB_PATH) ? fs.readFileSync(this.DB_PATH) : null;
      this.db = fileBuffer ? new SQL.Database(fileBuffer) : new SQL.Database();
      this.db.run('PRAGMA journal_mode=WAL');
    }
    return this.db;
  }

  save() {
    if (this.db) {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.DB_PATH, buffer);
    }
  }

  queryAll(sql, params = []) {
    const stmt = this.db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  queryOne(sql, params = []) {
    const rows = this.queryAll(sql, params);
    return rows[0] || null;
  }

  run(sql, params = []) {
    this.db.run(sql, params);
    this.save();
    if (sql.trim().toUpperCase().startsWith('INSERT')) {
      const result = this.db.exec('SELECT MAX(rowid) as id FROM papers');
      return result[0]?.values[0][0] || 0;
    }
    return 0;
  }

  runQuery(sql, params = []) {
    this.db.run(sql, params);
    if (sql.trim().toUpperCase().startsWith('INSERT')) {
      const result = this.db.exec('SELECT MAX(rowid) as id FROM papers');
      return result[0]?.values[0][0] || 0;
    }
    return 0;
  }

  async initTables() {
    await this.connect();

    const sqlPath = path.join(__dirname, 'init.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    const statements = sqlContent.split(';').filter(s => s.trim());

    for (const stmt of statements) {
      if (stmt.trim()) this.db.run(stmt);
    }

    this.save();
  }
}

module.exports = Database.getInstance();