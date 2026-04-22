/**
 * Configuration Template for Paper Reading WebUI
 * Copy this file to config.js and customize the values
 */

const path = require('path');

module.exports = {
  // Server
  PORT: 3000,
  HOST: '0.0.0.0',

  // Database (SQLite file path)
  DB_PATH: './data/papers.db',

  // LLM API (e.g., OpenAI, DeepSeek, Claude)
  LLM: {
    BASE_URL: 'https://api.example.com/v1',
    API_KEY: 'sk-your-api-key',
    MODEL: 'gpt-4o',
  },

  // AI Paper Categories
  AI_CATEGORIES: [
    "KV Cache / Serving", "LLM 推理优化", "模型架构", "多模态 / VLM",
    "LLM 推理与思维链", "数据与训练", "LLM + RL", "Agent", "评测 / Benchmark",
    "Diffusion / 生成", "NLP / 语言理解", "CV / 图像", "机器人 / VLA",
    "语音 / 音频", "安全 / 对齐", "高效计算 / 量化", "其他"
  ],

  // Source type labels
  SOURCE_TYPE_LABELS: {
    'paper': '📄 论文',
    'wechat_article': '💬 微信文章',
    'twitter_thread': '🐦 推文',
    'blog_post': '📝 博客',
    'video': '🎬 视频',
    'other': '🔗 链接',
  },

  BG_WORKER: {
    DELAY_MS: 5000,
    ERROR_DELAY_MS: 2000,
    AUTO_CACHE_FOR_ALL_PAPERS: true,
  },

  // Email sync settings (optional)
  EMAIL_SYNC: {
    ENABLED: false,
    CRON_HOUR: 8,
    CRON_MINUTE: 0,
    
    IMAP: {
      HOST: 'imap.example.com',
      PORT: 993,
      USER: 'your@email.com',
      PASSWORD: 'your-password',
    },
    
    FOLDER: 'INBOX',
    SENDER: 'alerts@example.com',
    CHECK_DAYS: 30,
    MAX_EMAILS: 64,
    API_DELAY_MS: 150,
  },

  LAYOUT_ANALYSIS: {
    modelPath: path.join(__dirname, 'src/services/onnx/PP-DocLayout-M_infer/inference.onnx'),
    modelSize: 640,
    scoreThreshold: 0.3,
    idleTimeoutMs: 10 * 60 * 1000,
  },

  CACHE: {
    DOWNLOAD_TIMEOUT_MS: 5 * 60 * 1000,  // 5 minutes
    PREVIEW_TIMEOUT_MS: 30000,            // 30 seconds
    TITLE_EXTRACT_TIMEOUT_MS: 30000,     // 30 seconds
    USER_AGENT: 'Mozilla/5.0 (compatible; MyBot/1.0)',
  },
};