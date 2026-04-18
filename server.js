/**
 * Paper Reading List - Node.js + Express + SQLite (sql.js)
 * Modular Architecture
 * Start: node server.js
 * Access: http://localhost:3333
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const { execSync } = require('child_process');
const config = require('./config');
const db = require('./src/db/database');

process.on('unhandledRejection', (err) => {
  console.error('[Unhandled Rejection]:', err.message);
});

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]:', err.message);
});

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Routes
const setupPaperRoutes = require('./src/routes/papers');
const setupSummaryRoutes = require('./src/routes/summary');
const { setupBgWorkerRoutes, startBgSummary, startBgFetch, startBgMarkdown, startBgCache, startBgLayout } = require('./src/routes/worker');
const { setupTechTermsRoutes } = require('./src/routes/techterms');
const { startEmailSync } = require('./src/services/email');

setupPaperRoutes(app);
setupSummaryRoutes(app);
setupBgWorkerRoutes(app);
setupTechTermsRoutes(app);

// Static files
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Start server
const PORT = config.PORT;

(async () => {
  try {
    await db.initTables();
    db.migrate();
    console.log('[OK] Paper reading list server started');
    console.log(`   Local:  http://localhost:${PORT}`);

    let lanIp = 'unknown';
    try {
      lanIp = execSync('hostname -I | awk \'{print $1}\'', { timeout: 5000, encoding: 'utf8' }).trim();
    } catch (e) {}
    if (lanIp && lanIp !== 'unknown') console.log(`   LAN:    http://${lanIp}:${PORT}`);

    setTimeout(() => {
      startBgFetch();
      console.log('[BG-Fetch] Auto-fetch metadata will start in 5 seconds...');
    }, config.BG_WORKER.DELAY_MS);

    setTimeout(() => {
      startBgMarkdown();
      console.log('[BG-MD] Auto-markdown conversion will start in 7 seconds...');
    }, config.BG_WORKER.DELAY_MS + 2000);

    setTimeout(() => {
      startBgCache();
      console.log('[BG-Cache] Auto-PDF cache will start in 9 seconds...');
    }, config.BG_WORKER.DELAY_MS + 5000);

    setTimeout(() => {
      startBgLayout();
      console.log('[BG-Layout] Auto-layout analysis will start in 10 seconds...');
    }, config.BG_WORKER.DELAY_MS + 7000);

    setTimeout(() => {
      startBgSummary();
      console.log('[BG-AI] Auto-summary will start in 12 seconds...');
    }, config.BG_WORKER.DELAY_MS + 10000);

    // Start scheduled email sync
    startEmailSync();

    app.listen(PORT, config.HOST, () => console.log(`Server running on port ${PORT}`));
  } catch (e) {
    console.error('[Server] Fatal error:', e.message);
    process.exit(1);
  }
})();