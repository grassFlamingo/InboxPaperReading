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
  if (sql.trim().toUpperCase().startsWith('INSERT')) {
    const result = db.exec('SELECT MAX(rowid) as id FROM papers');
    return result[0]?.values[0][0] || 0;
  }
  return 0;
}

function lastInsertRowid() {
  return 0;
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
    { col: 'notes', def: "TEXT DEFAULT ''" },
    { col: 'markdown_content', def: "TEXT DEFAULT ''" },
  ];
  for (const { col, def } of migrations) {
    if (!cols.includes(col)) {
      db.run(`ALTER TABLE papers ADD COLUMN ${col} ${def}`);
    }
  }

  const tableExists = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='tech_terms'");
  if (tableExists.length === 0 || tableExists[0].values.length === 0) {
    db.run(`
      CREATE TABLE IF NOT EXISTS tech_terms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        term_en TEXT NOT NULL,
        term_zh TEXT NOT NULL,
        context TEXT DEFAULT '',
        verified INTEGER DEFAULT 0,
        use_count INTEGER DEFAULT 1,
        source_paper_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (source_paper_id) REFERENCES papers(id)
      )
    `);
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tech_terms_unique ON tech_terms(term_en, term_zh, context)`);
  }

  const cacheTableExists = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='cached_papers'");
  if (cacheTableExists.length === 0 || cacheTableExists[0].values.length === 0) {
    db.run(`
      CREATE TABLE IF NOT EXISTS cached_papers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        paper_id INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER DEFAULT 0,
        preview_image TEXT,
        cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (paper_id) REFERENCES papers(id)
      )
    `);
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cached_papers_paper_id ON cached_papers(paper_id)`);
  }

  const paperCols = db.exec('PRAGMA table_info(papers)')[0].values.map(c => c[1]);
  if (!paperCols.includes('preview_image')) {
    db.run(`ALTER TABLE papers ADD COLUMN preview_image TEXT`);
  }
  if (!paperCols.includes('title_location')) {
    db.run(`ALTER TABLE papers ADD COLUMN title_location TEXT`);
  }
  if (!paperCols.includes('layout_data')) {
    db.run(`ALTER TABLE papers ADD COLUMN layout_data TEXT`);
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