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

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Routes
const setupPaperRoutes = require('./src/routes/papers');
const setupSummaryRoutes = require('./src/routes/summary');
const { setupBgWorkerRoutes, startBgSummary } = require('./src/routes/worker');
const { startEmailSync } = require('./src/services/email');

setupPaperRoutes(app);
setupSummaryRoutes(app);
setupBgWorkerRoutes(app);

// Static files
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Start server
const PORT = config.PORT;

(async () => {
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
    startBgSummary();
    console.log('[BG] Auto-summary will start in 5 seconds...');
  }, config.BG_WORKER.DELAY_MS);

  // Start scheduled email sync
  startEmailSync();

  app.listen(PORT, config.HOST, () => console.log(`Server running on port ${PORT}`));
})();