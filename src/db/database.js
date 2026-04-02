const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const config = require('../../config');

let db = null;
const DB_PATH = path.join(__dirname, '../../', config.DB_PATH);

async function getDb() {
  if (!db) {
    const SQL = await initSqlJs();
    const fileBuffer = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null;
    db = fileBuffer ? new SQL.Database(fileBuffer) : new SQL.Database();
    db.run('PRAGMA journal_mode=WAL');
  }
  return db;
}

function saveDb() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows[0] || null;
}

function runQuery(sql, params = []) {
  db.run(sql, params);
  saveDb();
  return db;
}

function lastInsertRowid() {
  return db.exec('SELECT last_insert_rowid()')[0].values[0][0];
}

async function initTables() {
  const conn = await getDb();
  
  conn.run(`
    CREATE TABLE IF NOT EXISTS papers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      authors TEXT DEFAULT '',
      abstract TEXT DEFAULT '',
      source TEXT DEFAULT '',
      source_url TEXT DEFAULT '',
      arxiv_id TEXT DEFAULT '',
      category TEXT DEFAULT '其他',
      priority INTEGER DEFAULT 3,
      status TEXT DEFAULT 'unread',
      tags TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const count = conn.exec('SELECT COUNT(*) FROM papers')[0].values[0][0];
  if (count === 0) seedData(conn);
  saveDb();
}

function migrate() {
  const cols = db.exec('PRAGMA table_info(papers)')[0].values.map(c => c[1]);
  const migrations = [
    { col: 'summary', def: "TEXT DEFAULT ''" },
    { col: 'ai_category', def: "TEXT DEFAULT ''" },
    { col: 'stars', def: 'INTEGER DEFAULT 0' },
    { col: 'user_rating', def: 'INTEGER DEFAULT 0' },
    { col: 'source_type', def: "TEXT DEFAULT 'paper'" },
  ];
  for (const { col, def } of migrations) {
    if (!cols.includes(col)) {
      db.run(`ALTER TABLE papers ADD COLUMN ${col} ${def}`);
    }
  }
  saveDb();
}

function seedData(conn) {
  const papers = [
    ["KV Admission: Learning What to Write for Efficient Long-Context Inference",
     "Yen-Chieh Huang, Pi-Cheng Hsiu, Rui Fang",
     '将 KV Cache 管理形式化为"准入控制"问题，从源头解决无差别写入低效问题。',
     "arXiv", "https://arxiv.org/abs/2512.17452", "2512.17452", "KV Cache 优化", 5, "unread", "KV Cache Admission,Long-context,Memory Efficiency", ""],
    ["KVRevoker: Reversible KV Cache Compression with Sketch-Based Token Reconstruction",
     "Aomufei Yuan, Zhiming Wang, Ruijie Miao",
     "传统 KV Cache 压缩是不可逆的，本文提出可逆压缩方案，利用 sketch-based 方法重建被压缩的 token。",
     "arXiv", "https://arxiv.org/abs/2512.17917", "2512.17917", "KV Cache 优化", 5, "unread", "Reversible Compression,Sketch-based", ""],
    ["PackKV: Reducing KV Cache Memory Footprint through LLM-Aware Lossy Compression",
     "Bo Jiang, Taolue Yang, Youyuan Liu",
     "面向长上下文推理中 KV Cache 的巨大内存需求，提出 LLM-aware 的有损压缩方案。",
     "arXiv", "https://arxiv.org/abs/2512.24449", "2512.24449", "KV Cache 优化", 4, "unread", "Lossy Compression,Memory Footprint", ""],
  ];
  
  const stmt = conn.prepare(`
    INSERT INTO papers (title, authors, abstract, source, source_url, arxiv_id, category, priority, status, tags, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const p of papers) stmt.run(p);
  stmt.free();
}

module.exports = { getDb, saveDb, queryAll, queryOne, runQuery, lastInsertRowid, initTables, migrate };