CREATE TABLE papers (
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
        , summary TEXT DEFAULT '', ai_category TEXT DEFAULT '', stars INTEGER DEFAULT 0, user_rating INTEGER DEFAULT 0, source_type TEXT DEFAULT 'paper');
CREATE TABLE sqlite_sequence(name,seq);