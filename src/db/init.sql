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
  summary TEXT DEFAULT '',
  ai_category TEXT DEFAULT '',
  stars INTEGER DEFAULT 0,
  user_rating INTEGER DEFAULT 0,
  source_type TEXT DEFAULT 'paper',
  markdown_content TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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
  category TEXT DEFAULT '',
  UNIQUE(term_en, term_zh, context),
  FOREIGN KEY (source_paper_id) REFERENCES papers(id)
);

CREATE TABLE IF NOT EXISTS cached_papers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id INTEGER NOT NULL UNIQUE,
  file_path TEXT NOT NULL,
  file_size INTEGER DEFAULT 0,
  preview_image TEXT,
  title_location TEXT,
  layout_data TEXT,
  cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (paper_id) REFERENCES papers(id)
);

CREATE TABLE IF NOT EXISTS bg_task_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_name TEXT NOT NULL UNIQUE,
  enabled INTEGER DEFAULT 1,
  interval_ms INTEGER DEFAULT 600000,
  last_run TIMESTAMP,
  last_status TEXT DEFAULT 'idle',
  last_error TEXT,
  processed_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
