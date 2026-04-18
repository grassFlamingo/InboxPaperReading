const ort = require('onnxruntime-node');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const db = require('../db/database');
const config = require('../../config');
const { CACHE_DIR } = require('./cache');

const LAYER_CLASSES = [
  'paragraph_title', 'image', 'text', 'number', 'abstract', 'content',
  'figure_title', 'formula', 'table', 'table_title', 'reference', 'doc_title',
  'footnote', 'header', 'algorithm', 'footer', 'seal', 'chart_title', 'chart',
  'formula_number', 'header_image', 'footer_image', 'aside_text'
];

const COLORS = [
  [255, 107, 107], [78, 205, 196], [69, 183, 209], [150, 206, 180], [255, 234, 167],
  [221, 160, 221], [152, 216, 200], [247, 220, 111], [187, 143, 206], [133, 193, 233],
  [248, 181, 0], [88, 214, 141], [93, 109, 126], [236, 112, 99], [175, 122, 165],
  [72, 201, 176], [243, 156, 18], [231, 76, 60], [155, 89, 182], [26, 188, 156],
  [52, 152, 219], [230, 126, 34]
];

const MEAN_IMAGE = [0.485, 0.456, 0.406];
const STD_IMAGE = [0.229, 0.224, 0.225];

const DEFAULT_OPTIONS = {
  modelPath: process.env.LAYOUT_MODEL_PATH || path.join(__dirname, '../../onnx/PP-DocLayout-M_infer/inference.onnx'),
  modelSize: 640,
  scoreThreshold: 0.3,
  idleTimeoutMs: 10 * 60 * 1000,
};

function normFunc(x, c) {
  return (x / 255.0 - MEAN_IMAGE[c]) / STD_IMAGE[c];
}

async function imageToTensor(image) {
  const { data, info } = await image
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  if (channels !== 3) {
    throw new Error('Only RGB images are supported');
  }

  const tensorData = new Float32Array(channels * height * width);

  let idx = 0;
  for (let c = 0; c < channels; c++) {
    for (let h = 0; h < height; h++) {
      for (let w = 0; w < width; w++) {
        const srcIdx = (h * width + w) * channels + c;
        tensorData[idx++] = normFunc(data[srcIdx], c);
      }
    }
  }

  return { tensorData, width, height };
}

class LayoutAnalysisService {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.session = null;
    this.lastUsed = Date.now();
    this.idleTimer = null;
    this.modelLoaded = false;
  }

  async ensureModel() {
    if (this.session) {
      this.lastUsed = Date.now();
      this.resetIdleTimer();
      return;
    }

    const modelPath = this.options.modelPath;
    if (!fs.existsSync(modelPath)) {
      throw new Error(`Model not found: ${modelPath}`);
    }

    const modelBuffer = fs.readFileSync(modelPath);
    this.session = await ort.InferenceSession.create(modelBuffer);
    this.modelLoaded = true;
    this.lastUsed = Date.now();
    this.resetIdleTimer();
    console.log('[LayoutService] Model loaded');
  }

  resetIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    const timeout = this.options.idleTimeoutMs;
    if (timeout > 0) {
      this.idleTimer = setTimeout(() => {
        this.unloadModel();
      }, timeout);
    }
  }

  async unloadModel() {
    if (this.session) {
      this.session = null;
      this.modelLoaded = false;
      console.log('[LayoutService] Model unloaded (idle timeout)');
    }
  }

  async preprocess(imageBuffer) {
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();
    const maxSlideLen = this.options.modelSize;

    const resizeW = maxSlideLen / metadata.width;
    const resizeH = maxSlideLen / metadata.height;

    const resizedImage = await image.resize(maxSlideLen, maxSlideLen, {
      fit: 'fill',
      position: 'centre',
    });

    const tensorResult = await imageToTensor(resizedImage);
    const scaleData = new Float32Array([resizeH, resizeW]);

    return {
      data: tensorResult.tensorData,
      width: tensorResult.width,
      height: tensorResult.height,
      scaleData,
    };
  }

  postprocess(detections, count, input) {
    const { data } = input;
    const results = [];

    for (let j = 0; j < count; j++) {
      const d = detections.data.slice(j * 6, j * 6 + 6);
      const classId = Math.floor(d[0]);
      const confidence = d[1];

      if (confidence < this.options.scoreThreshold) continue;
      if (classId >= LAYER_CLASSES.length) continue;

      results.push({
        classId,
        label: LAYER_CLASSES[classId],
        confidence,
        bbox: {
          x1: Math.round(d[2]),
          y1: Math.round(d[3]),
          x2: Math.round(d[4]),
          y2: Math.round(d[5]),
        },
      });
    }

    return results;
  }

  async detect(imageBuffer) {
    if (!this.session) {
      await this.ensureModel();
    }

    const input = await this.preprocess(imageBuffer);

    const feeds = {
      image: new ort.Tensor(input.data, [1, 3, input.height, input.width]),
      scale_factor: new ort.Tensor(input.scaleData, [1, 2])
    };

    const results = await this.session.run(feeds);
    const detections = results['fetch_name_0'];
    const count = results['fetch_name_1'].data[0];

    return this.postprocess(detections, count, input);
  }

  async analyzeCachedPaper(paperId) {
    const cached = db.queryOne('SELECT * FROM cached_papers WHERE paper_id = ?', [paperId]);
    if (!cached || !cached.file_path || !fs.existsSync(cached.file_path)) {
      return { success: false, msg: 'cached file not found' };
    }

    const pdfPath = cached.file_path;
    const previewDir = path.join(path.dirname(pdfPath), 'previews');
    const page1Png = path.join(previewDir, `${path.basename(paperId, '.pdf')}_page1.png`);

    let pageImage;
    if (fs.existsSync(page1Png)) {
      pageImage = fs.readFileSync(page1Png);
    } else {
      pageImage = await this.convertPdfPageToImage(pdfPath, 1);
      if (pageImage) {
        fs.writeFileSync(page1Png, pageImage);
      }
    }

    if (!pageImage) {
      return { success: false, msg: 'failed to get page image' };
    }

    const detections = await this.detect(pageImage);

    const titleDet = detections.find(d => 
      d.label === 'doc_title' || d.label === 'paragraph_title'
    );

    const layoutData = JSON.stringify({
      detections,
      title_bbox: titleDet?.bbox || null,
      title_label: titleDet?.label || null,
      analyzed_at: new Date().toISOString(),
    });

    db.runQuery('UPDATE papers SET layout_data = ? WHERE id = ?', [layoutData, paperId]);

    console.log(`[LayoutService] Analyzed #${paperId}: ${detections.length} detections, title: ${titleDet?.label}`);

    return {
      success: true,
      detections: detections.length,
      title: titleDet,
    };
  }

  async convertPdfPageToImage(pdfPath, pageNum) {
    try {
      const { execSync } = require('child_process');
      const tempDir = fs.mkdtempSync(require('os').tmpdir() + '/layout_');
      const outputPrefix = path.join(tempDir, 'page');

      execSync(`pdftoppm -png -singlefile -f ${pageNum} -l ${pageNum} "${pdfPath}" "${outputPrefix}"`, { timeout: 30000 });

      const pngFile = `${outputPrefix}.png`;
      if (fs.existsSync(pngFile)) {
        const buffer = fs.readFileSync(pngFile);
        fs.unlinkSync(pngFile);
        fs.rmdirSync(tempDir, { recursive: true });
        return buffer;
      }

      fs.rmdirSync(tempDir, { recursive: true });
    } catch (e) {
      console.log('[LayoutService] PDF conversion failed:', e.message);
    }
    return null;
  }
}

const layoutService = new LayoutAnalysisService(config.LAYOUT_ANALYSIS);

async function runLayoutAnalysisForPaper(paperId) {
  try {
    return await layoutService.analyzeCachedPaper(paperId);
  } catch (e) {
    console.error('[LayoutService] Analysis failed:', e.message);
    return { success: false, msg: e.message };
  }
}

async function getPapersNeedingLayoutAnalysis() {
  return db.queryAll(`
    SELECT p.id, p.title, p.layout_data, cp.file_path
    FROM papers p
    JOIN cached_papers cp ON p.id = cp.paper_id
    WHERE cp.file_path IS NOT NULL AND cp.file_path != ''
    AND (p.layout_data IS NULL OR p.layout_data = '')
    ORDER BY p.id DESC
    LIMIT 20
  `);
}

async function analyzeAllPending() {
  const papers = getPapersNeedingLayoutAnalysis();
  console.log(`[LayoutService] Found ${papers.length} papers needing analysis`);

  const results = [];
  for (const p of papers) {
    const result = await runLayoutAnalysisForPaper(p.id);
    results.push({ paper_id: p.id, ...result });
    await new Promise(r => setTimeout(r, 500)).catch(() => {});
  }

  return results;
}

function getLayoutService() {
  return layoutService;
}

module.exports = {
  LayoutAnalysisService,
  layoutService,
  runLayoutAnalysisForPaper,
  getPapersNeedingLayoutAnalysis,
  analyzeAllPending,
  getLayoutService,
};