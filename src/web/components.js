function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function renderMarkdown(text) {
  if (!text) return '';
  if (typeof marked !== 'undefined') {
    return marked.parse(text);
  }
  return text;
}

function paperUrl(p) {
  if (p.cached_file_path && p.cached_file_path.length > 10) return `/api/papers/${p.id}/file`;
  if (p.arxiv_id) return `https://arxiv.org/pdf/${p.arxiv_id}`;
  return p.source_url || '#';
}


const SOURCE_TYPE_NAMES = {
  paper: '论文', wechat_article: '微信文章',
  blog_post: '博客', video: '视频', other: '链接'
};

const STATUS_ORDER = { reading: 0, unread: 1, done: 2 };
const STATUS_NEXT = { unread: 'reading', reading: 'done', done: 'unread' };
const STATUS_LABELS = { unread: '标记阅读中', reading: '标记已读', done: '重置未读' };
const STATUS_ICONS = { done: '✅', reading: '📖', unread: '' };

function renderStars(count, max = 5) {
  return '★'.repeat(count) + '☆'.repeat(max - count);
}

function renderTags(tags) {
  return (tags || '').split(',').filter(Boolean).map(t => `<span class="tag">${t.trim()}</span>`).join('');
}

function renderAiCatTag(aiCategory) {
  if (!aiCategory) return '';
  return `<span class="tag" style="background:rgba(52,211,153,.12);color:var(--green)">${esc(aiCategory)}</span>`;
}

function renderSourceBadge(srcType) {
  const name = SOURCE_TYPE_NAMES[srcType] || srcType;
  return `<span class="source-badge ${srcType}">${name}</span>`;
}

function renderUserRating(p) {
  const rating = p.user_rating || 0;
  let html = '<div class="user-rating"><span class="label">我的评分</span>';
  for (let i = 1; i <= 5; i++) {
    const active = i <= rating ? 'active' : 'inactive';
    const star = i <= rating ? '★' : '☆';
    html += `<button class="star-btn ${active}" onclick="PaperApp.ratePaper(${p.id},${i},this)" title="${i}星">${star}</button>`;
  }
  if (rating > 0) {
    html += `<span style="font-size:.68rem;color:var(--muted);margin-left:4px">${rating}/5</span>`;
  }
  html += '</div>';
  return html;
}

function renderAiSummary(p) {
  if (p.summary) {
    return `<div class="ai-summary visible" id="summary-${p.id}"><div class="label">AI 摘要</div>${esc(p.summary)}</div>`;
  }
  return `<div class="ai-summary" id="summary-${p.id}"><div class="label">AI 摘要</div></div>`;
}

function renderAiStars(stars) {
  if (!stars || stars <= 0) return '';
  return `<span class="ai-stars"><span class="label">AI</span>${renderStars(stars)}</span>`;
}

const WEB_CONTENT_TYPES = ['wechat_article', 'blog_post', 'twitter_thread', 'other'];

function renderCard(p, idx, options = {}) {
  const { grid = false, showNum = true } = options;
  const srcType = p.source_type || 'paper';
  const status = p.status || 'unread';
  const cardClass = `paper ${status}${srcType !== 'paper' ? ' ' + srcType : ''}`;
  const onClick = ` onclick="PaperApp.markReading(${p.id},event)"`;
  const href = paperUrl(p);
  const numHtml = showNum ? `<div class="paper-num">${idx}</div>` : '';
  const hasMarkdown = p.markdown_content && p.markdown_content.length > 50;
  const previewSrc = p.cached_preview_path || '';
  const hasPreview = previewSrc.length > 0;
  const isArxiv = p.arxiv_id && srcType === 'paper';
  const isCached = p.cached_file_path && p.cached_file_path.length > 10;
  const useCached = isCached ? 1 : 0;
  const isWebContent = WEB_CONTENT_TYPES.includes(srcType);
  
  let readBtn = '';
  if (isWebContent) {
    readBtn = `<button class="btn" id="readerBtn-${p.id}" onclick="PaperApp.openReader(${p.id})">${hasMarkdown ? '📖 阅读' : '📄 阅读'}</button>`;
  } else if (isArxiv && (hasPreview || isCached)) {
    readBtn = `<button class="btn" onclick="PaperApp.openPdf(${p.id},${useCached})">📄 阅读</button>`;
  } else if (isArxiv) {
    readBtn = `<button class="btn" id="cacheBtn-${p.id}" onclick="PaperApp.cachePaper(${p.id})">⬇ 缓存</button>`;
  }

  let cropStyle = '';
  let titleFromPdf = '';
  let titleY = 0;
  try {
    if (p.layout_data) {
      const layout = JSON.parse(p.layout_data);
      const imgH = layout.image_height || 800;
      let bbox = null;

      if (layout.image_bbox) {
        bbox = layout.image_bbox;
        titleFromPdf = '📷 图片';
      } else if (layout.title_bbox) {
        bbox = layout.title_bbox;
        if (layout.title_bbox.text) {
          titleFromPdf = layout.title_bbox.text;
        }
      } else if (layout.abstract_bbox) {
        bbox = layout.abstract_bbox;
      }

      if (bbox) {
        const tb = bbox;
        titleY = ((tb.y1 + tb.y2) / 2) / imgH;
        const cropPos = Math.min(Math.max(titleY * 100, 10), 70);
        cropStyle = `object-position:center ${cropPos}%;`;
      }
    }
    if (!titleFromPdf && p.title_location) {
      try {
        const loc = JSON.parse(p.title_location);
        if (loc.text) titleFromPdf = loc.text;
        if (loc.y_ratio) titleY = loc.y_ratio;
      } catch (e) {}
    }
  } catch (e) {}
const previewImg = hasPreview ? `<img src="${previewSrc}" alt="preview"${cropStyle ? ` style="${cropStyle}"` : ''}>` : '';
  const paperLink = paperUrl(p);
  const tooltipId = hasPreview ? `tooltip-${p.id}` : '';
  const previewOnClick = hasPreview ? ` onclick="PaperApp.markReading(${p.id},event)"` : '';
  const previewHtml = hasPreview ? `<a href="${paperLink}" target="_blank" rel="noopener" class="paper-preview" data-tooltip="${tooltipId}"${previewOnClick}>${previewImg}</a>` : '';
  const bgPos = titleY > 0 ? titleY * 100 : 0;
  const tooltipImg = hasPreview ? `<img src="${previewSrc}" alt="preview">` : '';

  return `
    <div class="${cardClass}" data-id="${p.id}">
      ${previewHtml}
      ${hasPreview ? `<div id="${tooltipId}" class="paper-tooltip">${tooltipImg}</div>` : ''}
      <div class="paper-header">
        ${numHtml}
        <div class="paper-title">${STATUS_ICONS[status]} <a href="${esc(href)}" target="_blank" rel="noopener"${onClick}>${esc(p.title)}</a></div>
        ${renderAiStars(p.stars)}
      </div>
      <div class="paper-meta">
        ${renderSourceBadge(srcType)}
        ${p.arxiv_id ? `<span class="id">${esc(p.arxiv_id)}${p.arxiv_version ? `<span class="arxiv-version">${esc(p.arxiv_version)}</span>` : ''}</span>` : ''}
        ${p.source ? `<span>${esc(p.source)}</span>` : ''}
        ${p.authors ? `<span>${esc(p.authors)}</span>` : ''}
      </div>
      ${p.abstract ? `<div class="paper-abstract">${esc(p.abstract)}</div>` : ''}
      ${renderAiSummary(p)}
      ${p.notes ? `<div class="paper-notes" id="notes-${p.id}">${renderMarkdown(p.notes)}</div>` : ''}
      ${(p.tags || p.ai_category) ? `<div class="paper-tags">${renderAiCatTag(p.ai_category)}${renderTags(p.tags)}</div>` : ''}
      <div class="paper-notes" id="notes-${p.id}" style="display:none"></div>
      ${renderUserRating(p)}
      <div class="paper-actions">
        ${readBtn}
        <button class="btn" onclick="PaperApp.viewNotes(${p.id})">📝 笔记</button>
        <button class="btn btn-ai" id="aiBtn-${p.id}" onclick="PaperApp.aiSummarize(${p.id})">✨ AI 摘要</button>
        <button class="btn" onclick="PaperApp.cycleStatus(${p.id},'${status}')">${STATUS_LABELS[status]}</button>
        <button class="btn" onclick="PaperApp.openEditModal(${p.id})">编辑</button>
        <button class="btn" onclick="PaperApp.deletePaper(${p.id})" style="color:var(--red)">删除</button>
      </div>
    </div>`;
}

function renderCategoryHeader(cat, count) {
  return `<div class="cat-header">${cat} <span class="badge">${count} 篇</span></div>`;
}

function renderPaperList(papers, options = {}) {
  const { grid = false } = options;
  const showNum = !grid;
  return papers.map((p, i) => renderCard(p, i + 1, { grid, showNum })).join('');
}

function renderStats(s) {
  return `
    <div class="stat-item"><div class="stat-num">${s.total}</div><div class="stat-label">总计</div></div>
    <div class="stat-item unread"><div class="stat-num">${s.unread}</div><div class="stat-label">未读</div></div>
    <div class="stat-item reading"><div class="stat-num">${s.reading}</div><div class="stat-label">阅读中</div></div>
    <div class="stat-item done"><div class="stat-num">${s.done}</div><div class="stat-label">已读</div></div>
    <div class="stat-item cached"><div class="stat-num">${s.cached||0}</div><div class="stat-label">已缓存</div></div>
  `;
}

function renderCategorySelect(cats) {
  let html = '<option value="">全部分类</option>';
  for (const c of cats) {
    html += `<option value="${c.category}">${c.category} (${c.count})</option>`;
  }
  return html;
}

function renderBgStatus(tasks) {
  if (!tasks || Object.keys(tasks).length === 0) return '';

  const TASK_LABELS = {
    emailSync: '邮箱同步',
    cache: '缓存PDF',
    layout: '布局分析',
    metadata: '元数据',
    markdown: 'Markdown',
    summary: 'AI摘要',
    terminology: '术语'
  };

  const runningTasks = [];
  const idleTasks = [];

  for (const [name, task] of Object.entries(tasks)) {
    const label = TASK_LABELS[name] || name;
    const status = task.running ? 'running' : (task.last_error ? 'error' : 'idle');
    const lastRun = task.last_run ? formatTimeAgo(task.last_run) : '从未';
    const processed = task.processed_count || 0;

    const info = `${lastRun}, ${processed} processed`;
    const taskHtml = `<span class="bg-task"><span class="bg-task-label">${label}</span>: <span class="bg-task-status ${status}">[${status}]</span> <span class="bg-task-info">(${info})</span></span>`;

    if (status === 'running') {
      runningTasks.push(taskHtml);
    } else {
      idleTasks.push(taskHtml);
    }
  }

  if (runningTasks.length === 0) return '';

  let html = `<span class="bg-status-label">[bg]</span> `;
  html += runningTasks.join(' | ');
  if (idleTasks.length > 0) {
    html += ' | ' + idleTasks.slice(0, 3).join(' | ');
  }
  return html;
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return '从未';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return '未知';
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

window.RenderUtils = {
  esc, paperUrl, renderStars, renderTags, renderAiCatTag,
  renderSourceBadge, renderUserRating, renderAiSummary, renderAiStars,
  renderCard, renderCategoryHeader, renderStats, renderCategorySelect, renderPaperList,
  renderMarkdown, renderBgStatus, formatTimeAgo,
  SOURCE_TYPE_NAMES, STATUS_ORDER, STATUS_NEXT, STATUS_LABELS,
  WEB_CONTENT_TYPES
};