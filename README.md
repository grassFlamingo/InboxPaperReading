# Paper Reading Web UI

A web-based tool for reading, organizing, and analyzing academic papers with automatic layout detection and email sync.

## Features

- **Paper Management**: Import, organize, and track reading progress of academic papers
- **PDF Layout Detection**: Automatic recognition of figures, tables, and paragraphs using ONNX model
- **Email Sync**: Pull papers from IMAP email folders
- **Infinite Scroll**: Batched loading for smooth performance with large collections
- **Status Tracking**: Track reading status (reading, unread, done)
- **Preview Generation**: Fast preview images for quick browsing

## Tech Stack

- **Backend**: Node.js + Express + better-sqlite3
- **Frontend**: Vanilla JS (no framework)
- **ML**: ONNX Runtime for layout detection
- **PDF Processing**: pdf.js, pdftoppm

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment file and configure
cp .env.example .env
# Edit .env with your settings (database path, email credentials, etc.)

# Start server
npm start
```

Open http://localhost:3000 in your browser.

## API

- `GET /api/papers` - List papers (supports `?status=`, `?offset=`, `?limit=`)
- `GET /api/papers/:id` - Get paper details
- `GET /api/papers/:id/preview` - Get preview image
- `POST /api/papers/:id/analyze` - Trigger layout analysis
- `POST /api/sync` - Sync emails
- `GET /api/stats` - Get statistics

## Configuration

Create a `.env` file with:

```
DB_PATH=./data/papers.db
EMAIL_HOST=imap.example.com
EMAIL_USER=your@email.com
EMAIL_PASS=yourpassword
EMAIL_FOLDER=INBOX
PORT=3000
```