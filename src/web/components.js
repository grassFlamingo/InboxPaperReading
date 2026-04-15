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
  if (p.arxiv_id) return `https://arxiv.org/pdf/${p.arxiv_id}`;
  return p.source_url || '#';
}

const SOURCE_TYPE_ICONS = {
  paper: '📄', wechat_article: '💬', twitter_thread: '🐦',
  blog_post: '📝', video: '🎬', other: '🔗'
};

const SOURCE_TYPE_NAMES = {
  paper: '论文', wechat_article: '微信文章', twitter_thread: '推文',
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
  const icon = SOURCE_TYPE_ICONS[srcType] || '🔗';
  const name = SOURCE_TYPE_NAMES[srcType] || srcType;
  return `<span class="source-badge ${srcType}">${icon} ${name}</span>`;
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
  const onClick = status === 'unread' ? ` onclick="PaperApp.markReading(${p.id},event)"` : '';
  const href = paperUrl(p);
  const numHtml = showNum ? `<div class="paper-num">${idx}</div>` : '';
  const hasMarkdown = p.markdown_content && p.markdown_content.length > 50;
  const hasPreview = p.preview_image && p.preview_image.length > 50;
  const isArxiv = p.arxiv_id && srcType === 'paper';
  
  let readBtn = '';
  if (WEB_CONTENT_TYPES.includes(srcType)) {
    readBtn = `<button class="btn" id="readerBtn-${p.id}" onclick="PaperApp.openReader(${p.id})">${hasMarkdown ? '📖 阅读' : '📄 阅读'}</button>`;
  } else if (isArxiv && hasPreview) {
    readBtn = `<button class="btn" onclick="PaperApp.openPdf(${p.id})">📄 阅读</button>`;
  } else if (isArxiv) {
    readBtn = `<button class="btn" id="cacheBtn-${p.id}" onclick="PaperApp.cachePaper(${p.id})">⬇ 缓存</button>`;
  }

  const previewHtml = hasPreview ? `<div class="paper-preview"><img src="${p.preview_image}" alt="preview"></div>` : '';
  const titleWithPreview = hasPreview ? ` data-preview="true"` : '';
  let titleFromPdf = '';
  let yPos = 0;
  try {
    if (p.title_location) {
      const loc = JSON.parse(p.title_location);
      titleFromPdf = loc.text || '';
      yPos = loc.y_ratio || 0;
    }
  } catch (e) {}
  const tooltipTitle = titleFromPdf || p.title;
  const bgPos = yPos > 0 ? `background-position:center ${Math.min(yPos * 100, 80)}%` : 'background-position:center top';
  const tooltipStyle = hasPreview ? `background-image:url(${p.preview_image});${bgPos}` : '';
  const tooltipHtml = hasPreview ? `<div class="paper-tooltip" style="${tooltipStyle}" data-title="${esc(tooltipTitle)}"></div>` : '';

  return `
    <div class="${cardClass}">
      ${previewHtml}
      <div class="paper-header">
        ${numHtml}
        <div class="paper-title"${titleWithPreview}>${tooltipHtml}${STATUS_ICONS[status]} <a href="${esc(href)}" target="_blank" rel="noopener"${onClick}>${esc(p.title)}</a></div>
        ${renderAiStars(p.stars)}
      </div>
      <div class="paper-meta">
        ${renderSourceBadge(srcType)}
        ${p.arxiv_id ? `<span class="id">${esc(p.arxiv_id)}</span>` : ''}
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
  `;
}

function renderCategorySelect(cats) {
  let html = '<option value="">全部分类</option>';
  for (const c of cats) {
    html += `<option value="${c.category}">${c.category} (${c.count})</option>`;
  }
  return html;
}

window.RenderUtils = {
  esc, paperUrl, renderStars, renderTags, renderAiCatTag,
  renderSourceBadge, renderUserRating, renderAiSummary, renderAiStars,
  renderCard, renderCategoryHeader, renderStats, renderCategorySelect, renderPaperList,
  renderMarkdown,
  SOURCE_TYPE_ICONS, SOURCE_TYPE_NAMES, STATUS_ORDER, STATUS_NEXT, STATUS_LABELS,
  WEB_CONTENT_TYPES
};