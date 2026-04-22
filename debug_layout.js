const ort = require('onnxruntime-node');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

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

function normFunc(x, c) {
  return (x / 255.0 - MEAN_IMAGE[c]) / STD_IMAGE[c];
}

async function imageToTensor(image) {
  const { data, info } = await image.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
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

async function detect(imageBuffer) {
  const modelPath = path.join(__dirname, 'onnx/PP-DocLayout-M_infer/inference.onnx');
  const modelBuffer = fs.readFileSync(modelPath);
  
  let ep = ['cpu'];
  if (ort.getAvailableExecutionProviders) {
    const available = ort.getAvailableExecutionProviders();
    if (available.includes('CUDAExecutionProvider')) ep = ['CUDAExecutionProvider', 'CPUExecutionProvider'];
  }
  console.log('[Info] Using execution provider:', ep[0]);
  
  const session = await ort.InferenceSession.create(modelBuffer, { executionProviders: ep });
  
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const modelSize = 640;
  
  const resizeW = modelSize / metadata.width;
  const resizeH = modelSize / metadata.height;
  
  const resizedImage = await image.resize(modelSize, modelSize, { fit: 'fill', position: 'centre' });
  const tensorResult = await imageToTensor(resizedImage);
  const scaleData = new Float32Array([resizeH, resizeW]);
  
  const feeds = {
    'image': new ort.Tensor(tensorResult.tensorData, [1, 3, tensorResult.height, tensorResult.width]),
    'scale_factor': new ort.Tensor(scaleData, [1, 2])
  };
  
  const results = await session.run(feeds);
  const detections = results['fetch_name_0'];
  const count = results['fetch_name_1'].data[0];
  
  const output = [];
  for (let j = 0; j < count; j++) {
    const d = detections.data.slice(j * 6, j * 6 + 6);
    const classId = Math.floor(d[0]);
    const confidence = d[1];
    if (confidence < 0.3) continue;
    if (classId >= LAYER_CLASSES.length) continue;
    
    output.push({
      classId,
      label: LAYER_CLASSES[classId],
      confidence: confidence.toFixed(3),
      bbox: { x1: Math.round(d[2]), y1: Math.round(d[3]), x2: Math.round(d[4]), y2: Math.round(d[5]) },
      color: COLORS[classId] || [0, 0, 0],
    });
  }
  return output;
}

async function drawBoxes(imageBuffer, detections, outputPath) {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  
  let svg = '';
  for (const det of detections) {
    const { x1, y1, x2, y2 } = det.bbox;
    const color = `rgb(${det.color[0]},${det.color[1]},${det.color[2]})`;
    svg += `<rect x="${x1}" y="${y1}" width="${x2-x1}" height="${y2-y1}" fill="none" stroke="${color}" stroke-width="3"/>`;
    svg += `<text x="${x1}" y="${y1-5}" fill="${color}" font-size="16" font-weight="bold">${det.label}</text>`;
  }
  
  const combined = `
<svg width="${metadata.width}" height="${metadata.height}" xmlns="http://www.w3.org/2000/svg">
  <image href="data:image/png;base64,${imageBuffer.toString('base64')}" width="${metadata.width}" height="${metadata.height}"/>
  ${svg}
</svg>`;
  
  await sharp(Buffer.from(combined)).png().toFile(outputPath);
}

async function main() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const DB_PATH = path.join(__dirname, 'papers.db');
  const fileBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(fileBuffer);
  db.run('PRAGMA journal_mode=WAL');
  
  function queryAll(sql, params = []) {
    const stmt = db.prepare(sql);
    if (params.length) stmt.bind(params);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
  }
  
  const papers = queryAll(`
    SELECT p.id, p.title, cp.file_path
    FROM papers p
    JOIN cached_papers cp ON p.id = cp.paper_id
    WHERE cp.file_path IS NOT NULL AND cp.file_path != ''
    AND (cp.layout_data IS NULL OR cp.layout_data = '' OR cp.layout_data = 'null')
    ORDER BY p.id DESC
    LIMIT 10
  `);
  
  console.log(`[Info] Found ${papers.length} papers to test\n`);
  
  const outputDir = path.join(__dirname, 'debug_layout');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  
  for (const paper of papers) {
    console.log(`\n[${paper.id}] ${paper.file_path}`);
    
    const pdfPath = paper.file_path;
    if (!fs.existsSync(pdfPath)) {
      console.log('  PDF not found, skipping');
      continue;
    }
    
    try {
      const { execSync } = require('child_process');
const tempDir = fs.mkdtempSync(require('os').tmpdir() + '/layout_test_');
      const tempPdf = path.join(tempDir, 'paper.pdf');
      fs.copyFileSync(pdfPath, tempPdf);
      const outputPrefix = path.join(tempDir, 'page');
      
      execSync(`pdftoppm -png -singlefile -f 1 -l 1 -- "${tempPdf}" "${outputPrefix}"`, { timeout: 30000 });
      
      const detections = await detect(pageImage);
      
      console.log(`  Detections: ${detections.length}`);
      detections.forEach(d => {
        console.log(`    - ${d.label} (${d.confidence}): [${d.bbox.x1}, ${d.bbox.y1}, ${d.bbox.x2}, ${d.bbox.y2}]`);
      });
      
      const outPath = path.join(outputDir, `paper_${paper.id}_layout.png`);
      await drawBoxes(pageImage, detections, outPath);
      console.log(`  Saved: ${outPath}`);
      
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
  }
  
  console.log(`\n[Done] Check ${outputDir} for results`);
}

main().catch(e => {
  console.error('[Error]', e.message);
  process.exit(1);
});