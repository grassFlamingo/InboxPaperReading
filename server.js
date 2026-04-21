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

process.on('unhandledRejection', (err) => console.error('[Unhandled Rejection]:', err.message));
process.on('uncaughtException', (err) => console.error('[Uncaught Exception]:', err.message));

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Routes setup
const setupPaperRoutes = require('./src/routes/papers');
const setupSummaryRoutes = require('./src/routes/summary');
const { setupTechTermsRoutes } = require('./src/routes/techterms');

setupPaperRoutes(app);
setupSummaryRoutes(app);
setupTechTermsRoutes(app);

// Background task manager endpoints
const taskManager = require('./src/services/taskManager');

app.get('/api/bg/status', (req, res) => res.json(taskManager.getStatus()));
app.get('/api/bg/workers', (req, res) => res.json(taskManager.getWorkersStatus()));
app.post('/api/bg/worker/:task/kill', async (req, res) => {
  const { task } = req.params;
  const result = await taskManager.killWorker(task);
  res.json(result);
});
app.post('/api/bg/task/run', async (req, res) => {
  const { task } = req.body;
  if (!task) return res.status(400).json({ error: 'task required' });
  const result = await taskManager.runTask(task);
  res.json(result);
});

// Static files
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Start server
const PORT = config.PORT;

(async () => {
  try {
    await db.initTables();

    console.log('[OK] Paper reading list server started');
    console.log(`   Local:  http://localhost:${PORT}`);

    let lanIp = 'unknown';
    try { lanIp = execSync('hostname -I | awk \'{print $1}\'', { timeout: 5000, encoding: 'utf8' }).trim(); } catch (e) {}
    if (lanIp && lanIp !== 'unknown') console.log(`   LAN:    http://${lanIp}:${PORT}`);

    await taskManager.init();
    taskManager.start();
    console.log('[BG] Background tasks scheduled');

    app.listen(PORT, config.HOST, () => console.log(`Server running on port ${PORT}`));
  } catch (e) {
    console.error('[Server] Fatal error:', e.message);
    process.exit(1);
  }
})();
