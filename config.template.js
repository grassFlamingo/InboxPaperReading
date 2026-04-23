/**
 * Configuration Template for Paper Reading WebUI
 * ================================================
 * This file contains all configurable settings for the application.
 *
 * SETUP INSTRUCTIONS:
 * 1. Copy this file to config.js:
 *      cp config.template.js config.js
 *
 * 2. Edit config.js with your own settings. The following sections require
 *    configuration before running:
 *
 *    - LLM:         Required. API key and model for AI summaries
 *    - EMAIL_SYNC: Optional. Only needed if you want email sync
 *
 * 3. Start the server:
 *      npm start
 *
 * 4. Open http://localhost:3000 in your browser
 */

const path = require('path');

module.exports = {
  // =======================================================================
  // SERVER
  // =======================================================================
  // PORT: Server port (default: 3000)
  PORT: 3000,
  // HOST: Server bind address (default: 0.0.0.0 for all interfaces)
  HOST: '0.0.0.0',

  // =======================================================================
  // DATABASE
  // =======================================================================
  // DB_PATH: SQLite database file path (relative to project root)
  DB_PATH: './data/papers.db',

  // =======================================================================
  // LLM API (Required)
  // =======================================================================
  // LLM: Large Language Model API for AI-powered paper summaries
  //   - BASE_URL: API endpoint (OpenAI-compatible, e.g., OpenAI, DeepSeek, Claude)
  //   - API_KEY: Your API key
  //   - MODEL: Model name (e.g., gpt-4o, claude-3-opus)
  //   - DEFAULT_MAX_TOKENS: Max tokens per response
  LLM: {
    BASE_URL: 'https://api.example.com/v1',
    API_KEY: 'sk-your-api-key',
    MODEL: 'gpt-4o',
    DEFAULT_MAX_TOKENS: 1024,
  },

  // =======================================================================
  // AI CATEGORIES
  // =======================================================================
  // AI_CATEGORIES: Standard paper categories used for classification
  // Papers are automatically categorized by AI based on these labels
  AI_CATEGORIES: [
    "KV Cache / Serving", "LLM 推理优化", "模型架构", "多模态 / VLM",
    "LLM 推理与思维链", "数据与训练", "LLM + RL", "Agent", "评测 / Benchmark",
    "Diffusion / 生成", "NLP / 语言理解", "CV / 图像", "机器人 / VLA",
    "语音 / 音频", "安全 / 对齐", "高效计算 / 量化", "其他"
  ],

  // =======================================================================
  // SOURCE TYPE LABELS
  // =======================================================================
  // SOURCE_TYPE_LABELS: Display labels for paper sources in the UI
  SOURCE_TYPE_LABELS: {
    'paper': '论文',
    'wechat_article': '微信文章',
    'blog_post': '博客',
    'video': '视频',
    'other': '链接',
  },

  // SOURCE_NAME_MAP: Short names for different sources
  SOURCE_NAME_MAP: {
    'paper': 'arXiv',
    'wechat_article': '微信公众号',
    'blog_post': 'Blog',
    'video': 'Video',
    'other': 'Web',
  },

  // =======================================================================
  // BACKGROUND WORKER
  // =======================================================================
  // BG_WORKER: Automatic processing of papers in the background
  //   - DELAY_MS: Initial delay before starting
  //   - ERROR_DELAY_MS: Delay after errors
  //   - DEFAULT_INTERVAL_MS: Default scheduling interval
  //   - AUTO_CACHE_FOR_ALL_PAPERS: Auto-download PDFs for all papers
  BG_WORKER: {
    DELAY_MS: 1000,
    ERROR_DELAY_MS: 2000,
    DEFAULT_INTERVAL_MS: 5 * 60 * 1000,
    DEFAULT_TIMEOUT_MS: 1800000,
    TASK_TIMEOUT_MS: {
      metadata: 10 * 60 * 1000,
      markdown: 10 * 60 * 1000,
      cache: 10 * 60 * 1000,
      layout: 10 * 60 * 1000,
      summary: 10 * 60 * 1000,
      terminology: 10 * 60 * 1000,
      emailSync: 60 * 60 * 1000,
    },
    HEARTBEAT_INTERVAL_MS: 10 * 60 * 1000,
    WORKER_CHECK_INTERVAL_MS: 10 * 60 * 1000,
    EMAIL_SYNC_TRIGGERED_TASKS: ['metadata', 'cache', 'layout', 'summary'],
    REUSE_CACHED_PAPERS: true,
    RUN_AS_SEPARATE_PROCESS: false,
    AUTO_CACHE_FOR_ALL_PAPERS: true,
  },

  // =======================================================================
  // EMAIL SYNC (Optional)
  // =======================================================================
  // EMAIL_SYNC: Automatically fetch papers from Google Scholar alerts via email
  //   - ENABLED: Set to true to enable email sync
  //   - CRON_HOUR/MINUTE: Daily sync time (UTC)
  //   - IMAP: Email provider settings
  //   - FOLDER: Email folder containing Google Scholar alerts
  //   - SENDER: Filter by sender address
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
    SENDER: 'scholaralerts-noreply@google.com',
    CHECK_DAYS: 30,
    MAX_EMAILS: 64,
    API_DELAY_MS: 150,
  },

  // =======================================================================
  // OPENALEX (Optional)
  // =======================================================================
  // OPENALEX: Academic paper metadata API
  //   - API: API key for OpenAlex
  OPENALEX_ORG: {
    API: '',
  },

  // =======================================================================
  // LAYOUT ANALYSIS
  // =======================================================================
  // LAYOUT_ANALYSIS: PDF layout detection using ONNX model
  //   - modelPath: Path to ONNX model file
  //   - modelSize: Input image size
  //   - scoreThreshold: Detection confidence threshold
  LAYOUT_ANALYSIS: {
    modelPath: path.join(__dirname, 'onnx/PP-DocLayout-M_infer/inference.onnx'),
    modelSize: 640,
    scoreThreshold: 0.3,
    idleTimeoutMs: 10 * 60 * 1000,
  },

  // =======================================================================
  // CACHE
  // =======================================================================
  // CACHE: Local storage for downloaded content
  //   - DIR: Cache directory
  //   - SUBDIRS: Subdirectories for different content types
  CACHE: {
    DIR: path.join(__dirname, 'cache'),
    PREVIEW_SUBDIR: 'previews',
    PDF_SUBDIR: 'papers',
    HTML_SUBDIR: 'html',
    IMAGES_SUBDIR: 'images',
    VIDEOS_SUBDIR: 'videos',
    AUDIOS_SUBDIR: 'audios',
    DOWNLOAD_TIMEOUT_MS: 5 * 60 * 1000,
    PREVIEW_TIMEOUT_MS: 30000,
    TITLE_EXTRACT_TIMEOUT_MS: 30000,
    USER_AGENT: 'Mozilla/5.0 (compatible; MyBot/1.0)',
  },

  // =======================================================================
  // PARSER
  // =======================================================================
  // PARSER: Media extraction settings from PDFs
  //   - MAX_*: Maximum file sizes for different media types
  PARSER: {
    DEV_MODE: false,
    MAX_IMAGE_SIZE_MB: 5,
    MAX_VIDEO_SIZE_MB: 10,
    MAX_AUDIO_SIZE_MB: 10,
  },

  // =======================================================================
  // DATABASE SETTINGS
  // =======================================================================
  // DB: Database auto-save settings
  DB: {
    AUTO_SAVE: true,
    AUTO_SAVE_INTERVAL_MS: 30000,
  },
};