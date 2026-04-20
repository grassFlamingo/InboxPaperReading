function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

let lastTooltipEl = null;
const TOOLTIP_W = 600, TOOLTIP_H = 850;

function showTooltip(el, x, y) {
  if (lastTooltipEl && lastTooltipEl !== el) hideTooltip(lastTooltipEl);
  let tx = x + 15, ty = y + 15;
  if (tx + TOOLTIP_W > window.innerWidth) tx = x - TOOLTIP_W - 15;
  if (ty + TOOLTIP_H > window.innerHeight) ty = y - TOOLTIP_H - 15;
  el.style.setProperty('--tx', tx + 'px');
  el.style.setProperty('--ty', ty + 'px');
  el.style.display = 'block';
  lastTooltipEl = el;
}
function hideTooltip(el) { el.style.display = 'none'; lastTooltipEl = null; }

const PaperApp = {
  papers: [],
  categories: [],
  paperBatch: { papers: [], total: 0, offset: 0, limit: 50, hasMore: true, loading: false },

  async init() {
    await this.loadCategories();
    await this.loadPapers(true);
    this.render();
    this.startBgPoll();
    this.setupInfiniteScroll();
  },

  async loadPapers(reset = false) {
    if (this.paperBatch.loading) return;
    if (reset) this.paperBatch = { papers: [], total: 0, offset: 0, limit: 50, hasMore: true, loading: false };
    if (!this.paperBatch.hasMore) return;

    this.paperBatch.loading = true;
    const cat = document.getElementById('filterCat').value;
    const status = document.getElementById('filterStatus').value;
    const cached = document.getElementById('filterCached').value;
    const sort = document.getElementById('sortBy').value;
    const q = document.getElementById('searchBox').value;

    const params = { offset: this.paperBatch.offset, limit: this.paperBatch.limit };
    if (cat) params.category = cat;
    if (status) params.status = status;
    if (cached) params.cached = cached;
    if (sort) params.sort = sort;
    if (q) params.q = q;

    const data = await PaperAPI.getPapers(params);
    this.paperBatch.papers = reset ? data.papers : [...this.paperBatch.papers, ...data.papers];
    this.paperBatch.total = data.total;
    this.paperBatch.hasMore = data.hasMore;
    this.paperBatch.offset += data.papers.length;
    this.paperBatch.loading = false;
    this.papers = this.paperBatch.papers;
  },

  setupInfiniteScroll() {
    const container = document.getElementById('paperList');
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && this.paperBatch.hasMore && !this.paperBatch.loading) {
        this.loadPapers().then(() => this.renderPartial());
      }
    }, { rootMargin: '100px' });
    if (container) observer.observe(container);
    this._scrollObserver = observer;
  },

  renderPartial() {
    this._updatePaperListDOM();
  },

  _updatePaperListDOM() {
    const sourceType = document.getElementById('filterSourceType').value;
    const layoutMode = document.getElementById('layoutMode').value;
    let displayPapers = this.papers;
    if (sourceType) {
      displayPapers = displayPapers.filter(p => (p.source_type || 'paper') === sourceType);
    }
    if (!displayPapers.length) {
      document.getElementById('paperList').innerHTML = '<div class="empty">没有匹配的论文</div>';
      return;
    }
    displayPapers.sort((a, b) => {
      const sa = RenderUtils.STATUS_ORDER[a.status] ?? 1;
      const sb = RenderUtils.STATUS_ORDER[b.status] ?? 1;
      if (sa !== sb) return sa - sb;
      return 0;
    });
    if (layoutMode === 'grid') {
      document.getElementById('appContainer').className = 'paper-container grid-mode';
      document.getElementById('paperList').innerHTML = `<div class="paper-grid">${RenderUtils.renderPaperList(displayPapers, { grid: true })}</div>`;
      this._observeLoadMore();
      return;
    }
    document.getElementById('appContainer').className = 'paper-container';
    const activeGroups = {}, doneGroups = {};
    displayPapers.forEach(p => {
      const target = p.status === 'done' ? doneGroups : activeGroups;
      if (!target[p.category]) target[p.category] = [];
      target[p.category].push(p);
    });
    let html = '';
    let idx = 0;
    for (const [cat, items] of Object.entries(activeGroups)) {
      html += RenderUtils.renderCategoryHeader(cat, items.length);
      items.forEach(p => { html += RenderUtils.renderCard(p, ++idx); });
    }
    const donePapers = Object.values(doneGroups).flat();
    if (donePapers.length > 0) {
      html += `<div class="done-section" id="doneSection">
        <div class="done-toggle" onclick="document.getElementById('doneSection').classList.toggle('open')">
          <span class="arrow">▶</span>
          <span class="done-info">已归档 · <span class="done-count">${donePapers.length}</span> 篇</span>
        </div>
        <div class="papers-wrap">`;
      for (const [cat, items] of Object.entries(doneGroups)) {
        html += RenderUtils.renderCategoryHeader(cat, items.length);
        items.forEach(p => { html += RenderUtils.renderCard(p, ++idx); });
      }
      html += `</div></div>`;
    }
    document.getElementById('paperList').innerHTML = html;
    this._observeLoadMore();
  },

  _observeLoadMore() {
    if (this._scrollObserver) {
      const sentinel = document.getElementById('loadMoreSentinel');
      if (sentinel && this.paperBatch.hasMore) {
        this._scrollObserver.observe(sentinel);
      } else if (sentinel) {
        this._scrollObserver.unobserve(sentinel);
      }
    }
  },

  _updatePaperCard(updated) {
    const idx = this.papers.findIndex(p => p.id === updated.id);
    if (idx === -1) return;
    this.papers[idx] = updated;
    const card = document.querySelector(`.paper[data-id="${updated.id}"]`);
    if (!card) return;
    const gridLayout = document.getElementById('layoutMode')?.value === 'grid';
    const renderIdx = Array.from(card.parentElement.children).indexOf(card) + 1;
    card.outerHTML = RenderUtils.renderCard(updated, renderIdx, { grid: gridLayout, showNum: true });
  },

  _removePaperCard(id) {
    this.papers = this.papers.filter(p => p.id !== id);
    const card = document.querySelector(`.paper[data-id="${id}"]`);
    if (card) card.remove();
  },

  resetAndReload() {
    this.paperBatch = { papers: [], total: 0, offset: 0, limit: 50, hasMore: true, loading: false };
    this.render();
  },

  async loadCategories() {
    this.categories = await PaperAPI.getCategories();
    document.getElementById('filterCat').innerHTML = RenderUtils.renderCategorySelect(this.categories);
  },

  async loadStats() {
    const s = await PaperAPI.getStats();
    document.getElementById('stats').innerHTML = RenderUtils.renderStats(s);
    // document.getElementById('subtitle').textContent = `SQLite 驱动 · 实时渲染 · ${s.total} 篇`;
  },

  async render() {
    await this.loadPapers(true);
    await this.loadStats();
    this._updatePaperListDOM();
  },

  async markReading(id, e) {
    e.preventDefault();
    const pUrl = e.currentTarget.href;
    const updated = await PaperAPI.updatePaper(id, { status: 'reading' });
    window.open(pUrl, '_blank');
    this._updatePaperCard(updated);
    this.loadCategories();
  },

  async cycleStatus(id, current) {
    const next = RenderUtils.STATUS_NEXT[current] || 'reading';
    const updated = await PaperAPI.updatePaper(id, { status: next });
    this._updatePaperCard(updated);
  },

  async refreshInPlace() {
    const scrollY = window.scrollY;
    const currentBatch = this.paperBatch;
    const cat = document.getElementById('filterCat').value;
    const status = document.getElementById('filterStatus').value;
    const cached = document.getElementById('filterCached').value;
    const sort = document.getElementById('sortBy').value;
    const q = document.getElementById('searchBox').value;
    const params = { offset: currentBatch.offset, limit: currentBatch.limit };
    if (cat) params.category = cat;
    if (status) params.status = status;
    if (cached) params.cached = cached;
    if (sort) params.sort = sort;
    if (q) params.q = q;
    const data = await PaperAPI.getPapers(params);
    this.paperBatch.papers = data.papers;
    this.paperBatch.total = data.total;
    this.papers = data.papers;
    await this.loadStats();
    this._updatePaperListDOM();
    window.scrollTo(0, scrollY);
  },

  async deletePaper(id) {
    if (!confirm('确定删除这篇论文？')) return;
    await PaperAPI.deletePaper(id);
    this._removePaperCard(id);
    this.loadCategories();
  },

  async ratePaper(id, rating, btn) {
    await PaperAPI.ratePaper(id, rating);
    const container = btn.closest('.user-rating');
    container.querySelectorAll('.star-btn').forEach((b, i) => {
      b.textContent = (i + 1) <= rating ? '★' : '☆';
      b.className = `star-btn ${(i + 1) <= rating ? 'active' : 'inactive'}`;
    });
  },

  async aiSummarize(id) {
    const btn = document.getElementById(`aiBtn-${id}`);
    const box = document.getElementById(`summary-${id}`);
    if (!btn || !box) return;

    if (box.classList.contains('visible') && box.textContent.trim().length > 20) {
      box.classList.remove('visible');
      return;
    }

    btn.classList.add('loading');
    btn.textContent = '⏳ 生成中...';

    try {
      const d = await PaperAPI.summarize(id);
      if (d.summary) {
        box.innerHTML = `<div class="label">AI 摘要</div>${RenderUtils.esc(d.summary)}`;
        box.classList.add('visible');
        btn.textContent = '✨ AI 摘要';
      } else {
        btn.textContent = '❌ 失败';
        setTimeout(() => { btn.textContent = '✨ AI 摘要'; btn.classList.remove('loading'); }, 2000);
        return;
      }
    } catch(e) {
      btn.textContent = '❌ 失败';
      setTimeout(() => { btn.textContent = '✨ AI 摘要'; btn.classList.remove('loading'); }, 2000);
      return;
    }
    btn.classList.remove('loading');
  },

  openAddModal() {
    document.getElementById('modalTitle').textContent = '添加论文';
    document.getElementById('editId').value = '';
    ['fTitle','fAuthors','fUrl','fArxivId','fCategory','fTags','fAbstract'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('fPriority').value = '3';
    document.getElementById('fSource').value = 'arXiv';
    document.getElementById('fSourceType').value = 'paper';
    document.getElementById('modal').classList.add('active');
  },

  async openEditModal(id) {
    const p = await PaperAPI.getPaper(id);
    if (!p) return;
    document.getElementById('modalTitle').textContent = '编辑论文';
    document.getElementById('editId').value = id;
    document.getElementById('fTitle').value = p.title || '';
    document.getElementById('fAuthors').value = p.authors || '';
    document.getElementById('fUrl').value = p.source_url || '';
    document.getElementById('fArxivId').value = p.arxiv_id || '';
    document.getElementById('fCategory').value = p.category || '';
    document.getElementById('fPriority').value = p.priority || 3;
    document.getElementById('fTags').value = p.tags || '';
    document.getElementById('fAbstract').value = p.abstract || '';
    document.getElementById('fNotes').value = p.notes || '';
    document.getElementById('fSource').value = p.source || 'arXiv';
    document.getElementById('fSourceType').value = p.source_type || 'paper';
    document.getElementById('modal').classList.add('active');
  },

  closeModal() {
    document.getElementById('modal').classList.remove('active');
  },

  async savePaper() {
    const title = document.getElementById('fTitle').value.trim();
    if (!title) { alert('请输入标题'); return; }
    const data = {
      title,
      authors: document.getElementById('fAuthors').value.trim(),
      source: document.getElementById('fSource').value,
      source_url: document.getElementById('fUrl').value.trim(),
      arxiv_id: document.getElementById('fArxivId').value.trim(),
      category: document.getElementById('fCategory').value.trim() || '其他',
      priority: parseInt(document.getElementById('fPriority').value) || 3,
      tags: document.getElementById('fTags').value.trim(),
      abstract: document.getElementById('fAbstract').value.trim(),
      notes: document.getElementById('fNotes').value.trim(),
      source_type: document.getElementById('fSourceType').value || 'paper',
    };
    const editId = document.getElementById('editId').value;
    if (editId) {
      await PaperAPI.updatePaper(editId, data);
    } else {
      await PaperAPI.addPaper(data);
    }
    this.closeModal();
    this.refreshInPlace();
    this.loadCategories();
  },

  openImportUrlModal() {
    document.getElementById('importUrl').value = '';
    document.getElementById('importPriority').value = '3';
    document.getElementById('importTags').value = '';
    document.getElementById('importNotes').value = '';
    const res = document.getElementById('importResult');
    res.style.display = 'none';
    res.innerHTML = '';
    document.getElementById('importUrlSubmit').disabled = false;
    document.getElementById('importUrlSubmit').textContent = '🤖 AI 导入';
    document.getElementById('importUrlModal').classList.add('active');
    setTimeout(() => document.getElementById('importUrl').focus(), 100);
  },

  closeImportUrlModal() {
    document.getElementById('importUrlModal').classList.remove('active');
  },

  async doImportUrl() {
    const url = document.getElementById('importUrl').value.trim();
    if (!url) { alert('请输入 URL'); return; }

    const btn = document.getElementById('importUrlSubmit');
    const res = document.getElementById('importResult');
    btn.disabled = true;
    btn.textContent = '⏳ AI 提取中...';
    res.style.display = 'none';

    try {
      const d = await PaperAPI.importUrl(
        url,
        parseInt(document.getElementById('importPriority').value) || 3,
        document.getElementById('importTags').value.trim(),
        document.getElementById('importNotes').value.trim()
      );
      if (d.id) {
        const typeNames = { paper:'📄 论文', wechat_article:'💬 微信文章', twitter_thread:'🐦 推文', blog_post:'📝 博客', video:'🎬 视频', other:'🔗 链接' };
        res.style.display = 'block';
        res.style.background = 'rgba(52,211,153,.07)';
        res.style.borderColor = 'rgba(52,211,153,.3)';
        res.innerHTML = `
          <div style="color:var(--green);font-weight:600;margin-bottom:6px">✅ 导入成功 #${d.id}</div>
          <div style="margin-bottom:3px"><b>${RenderUtils.esc(d.title)}</b></div>
          <div style="color:var(--muted);font-size:.78rem;margin-bottom:3px">${typeNames[d.source_type]||d.source_type} · ${RenderUtils.esc(d.category)} · AI ⭐${d.stars}</div>
          <div style="color:#b8b8c0;font-size:.78rem">${RenderUtils.esc(d.abstract_preview||'')}</div>
        `;
        btn.textContent = '✅ 已导入，再导入一条';
        btn.disabled = false;
        this.refreshInPlace();
        this.loadCategories();
      } else {
        res.style.display = 'block';
        res.style.background = 'rgba(248,113,113,.07)';
        res.style.borderColor = 'rgba(248,113,113,.3)';
        res.innerHTML = `<div style="color:var(--red)">❌ 导入失败: ${RenderUtils.esc(d.error || JSON.stringify(d))}</div>`;
        btn.textContent = '🤖 AI 导入';
        btn.disabled = false;
      }
    } catch(e) {
      res.style.display = 'block';
      res.style.background = 'rgba(248,113,113,.07)';
      res.style.borderColor = 'rgba(248,113,113,.3)';
      res.innerHTML = `<div style="color:var(--red)">❌ 网络错误: ${RenderUtils.esc(String(e))}</div>`;
      btn.textContent = '🤖 AI 导入';
      btn.disabled = false;
    }
  },

  async syncEmails() {
    const btn = document.getElementById('syncBtn');
    btn.textContent = '⏳ 同步中...';
    btn.disabled = true;
    try {
      const d = await PaperAPI.syncEmails();
      if (d.status === 'completed') {
        btn.textContent = `✅ 已同步 (+${d.added || 0})`;
        setTimeout(() => { this.render(); this.loadCategories(); btn.textContent = '📬 同步邮箱'; btn.disabled = false; }, 3000);
      } else if (d.status === 'already_running') {
        btn.textContent = '⏳ 同步中...';
        setTimeout(() => { btn.textContent = '📬 同步邮箱'; btn.disabled = false; }, 2000);
      } else if (d.status === 'failed') {
        btn.textContent = '❌ 失败';
        setTimeout(() => { btn.textContent = '📬 同步邮箱'; btn.disabled = false; }, 2000);
      } else {
        btn.textContent = '✅ 已触发';
        setTimeout(() => { this.render(); this.loadCategories(); btn.textContent = '📬 同步邮箱'; btn.disabled = false; }, 3000);
      }
    } catch(e) {
      btn.textContent = '❌ 失败';
      setTimeout(() => { btn.textContent = '📬 同步邮箱'; btn.disabled = false; }, 2000);
    }
  },

startBgPoll() {
    // Removed summary status polling - status bar removed
  },

  async toggleNotes(id) {
    const el = document.getElementById(`notes-${id}`);
    if (!el) return;
    if (el.style.display === 'none') {
      this.viewNotes(id);
    } else {
      el.style.display = 'none';
    }
  },

  async saveNotes(id) {
    const note = document.getElementById(`notesEdit-${id}`)?.value || '';
    await PaperAPI.updatePaper(id, { notes: note });
    this.viewNotes(id);
  },

  async viewNotes(id) {
    const el = document.getElementById(`notes-${id}`);
    if (!el) return;
    const p = await PaperAPI.getPaper(id);
    if (p?.notes) {
      el.innerHTML = RenderUtils.renderMarkdown(p.notes) + 
        `<div class="notes-btns" style="margin-top:8px">
          <button class="btn" onclick="PaperApp.editNotes(${id})">编辑</button>
          <button class="btn" onclick="this.parentElement.style.display='none'">取消</button>
        </div>`;
      el.style.display = 'block';
    } else {
      el.innerHTML = `<div class="notes-btns" style="margin-top:8px">
        <button class="btn" onclick="PaperApp.editNotes(${id})">添加笔记</button>
        <button class="btn" onclick="this.parentElement.style.display='none'">取消</button>
      </div>`;
      el.style.display = 'block';
    }
  },

  async editNotes(id) {
    const el = document.getElementById(`notes-${id}`);
    if (!el) return;
    const p = await PaperAPI.getPaper(id);
    el.innerHTML = `<textarea class="notes-edit" id="notesEdit-${id}" placeholder="笔记...支持 Markdown/LaTeX">${esc(p?.notes || '')}</textarea>
      <div class="notes-actions">
        <button class="btn btn-primary" onclick="PaperApp.saveNotes(${id})">保存</button>
        <button class="btn" onclick="PaperApp.viewNotes(${id})">取消</button>
      </div>`;
  },

  renderMarkdown(text) {
    if (!text) return '';
    let html = text;
    html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/\$\$([\s\S]*?)\$\$/g, '<div class="math-block">$1</div>');
    html = html.replace(/\$([^\$\n]+?)\$/g, '<span class="math-inline">$1</span>');
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    html = html.replace(/\n/g, '<br>');
    return html;
  },

  async openReader(id) {
    const btn = document.querySelector(`#readerBtn-${id}`);
    if (btn) {
      btn.classList.add('loading');
      btn.textContent = '⏳ 加载中...';
    }
    try {
      const d = await PaperAPI.getMarkdown(id);
      const p = this.papers.find(p => p.id === id);
      if (!p) return;
      document.getElementById('readerTitle').textContent = p.title;
      if (d.markdown && d.markdown.length > 50) {
        document.getElementById('readerContent').innerHTML = marked.parse(d.markdown);
      } else {
        document.getElementById('readerContent').innerHTML = '<div style="color:var(--muted)">暂无 Markdown 内容，正在转换...</div>';
      }
      document.getElementById('readerModal').classList.add('active');
    } catch(e) {
      alert('加载失败: ' + e.message);
    }
    if (btn) {
      btn.classList.remove('loading');
      btn.textContent = '📖 阅读';
    }
  },

  closeReader() {
    document.getElementById('readerModal').classList.remove('active');
  },

  async cachePaper(id) {
    const btn = document.getElementById(`cacheBtn-${id}`);
    if (btn) {
      btn.classList.add('loading');
      btn.textContent = '⏳ 缓存中...';
    }
    try {
      const d = await PaperAPI.cachePaper(id);
      if (d.success) {
        if (btn) {
          btn.textContent = '📄 阅读';
          btn.onclick = () => this.openPdf(id);
        }
        this.render();
      } else {
        alert('缓存失败: ' + d.msg);
        if (btn) {
          btn.classList.remove('loading');
          btn.textContent = '⬇ 缓存';
        }
      }
    } catch(e) {
      alert('缓存失败: ' + e.message);
      if (btn) {
        btn.classList.remove('loading');
        btn.textContent = '⬇ 缓存';
      }
    }
  },

  async openPdf(id, useCached = 0) {
    if (useCached) {
      window.open(`/api/papers/${id}/file`, '_blank');
    } else {
      const paper = this.papers.find(p => p.id === id);
      if (paper?.arxiv_id) {
        window.open(`https://arxiv.org/pdf/${paper.arxiv_id}.pdf`, '_blank');
      } else {
        window.open(`/api/papers/${id}/file`, '_blank');
      }
    }
  },

  async redetectLayout() {
    const btn = event.target;
    btn.disabled = true;
    btn.textContent = '⏳ 重检中...';
    try {
      const result = await PaperAPI.redetectLayout();
      alert(`已重置 ${result.updated} 篇论文的布局数据，将由后台重新检测`);
      await PaperAPI.runBgTask('layout');
      btn.textContent = '✅ 已重置';
      setTimeout(() => { btn.disabled = false; btn.textContent = '重检布局'; }, 2000);
    } catch (e) {
      alert('重置失败: ' + e.message);
      btn.disabled = false;
      btn.textContent = '重检布局';
    }
  },

  async checkLayoutStats() {
    try {
      const s = await PaperAPI.getLayoutStats();
      console.log(`Layout: ${s.analyzed}/${s.cached} analyzed, ${s.needsAnalysis} need analysis`);
      return s;
    } catch (e) {
      console.error('Layout stats error:', e);
    }
  }
};

window.PaperApp = PaperApp;
window.esc = esc;

const TechTermsApp = {
  terms: [],
  stats: {},

  async show() {
    document.getElementById('techTermsPanel').style.display = 'block';
    document.getElementById('paperList').style.display = 'none';
    document.getElementById('appContainer').querySelector('.header').style.display = 'none';
    await this.loadStats();
    await this.render();
  },

  async hide() {
    document.getElementById('techTermsPanel').style.display = 'none';
    document.getElementById('paperList').style.display = 'block';
    document.getElementById('appContainer').querySelector('.header').style.display = 'flex';
  },

  async loadStats() {
    this.stats = await PaperAPI.getTechTermsStats();
    document.getElementById('techTermsStats').innerHTML = `
      <div class="stat-item"><div class="stat-num">${this.stats.total}</div><div class="stat-label">总计</div></div>
      <div class="stat-item" style="border-color:var(--green)"><div class="stat-num" style="color:var(--green)">${this.stats.verified}</div><div class="stat-label">已审核</div></div>
      <div class="stat-item" style="border-color:var(--yellow)"><div class="stat-num" style="color:var(--yellow)">${this.stats.unverified}</div><div class="stat-label">待审核</div></div>
      <div class="stat-item" style="border-color:var(--accent)"><div class="stat-num" style="color:var(--accent)">${this.stats.candidates}</div><div class="stat-label">候选</div></div>
      <div class="stat-item" style="border-color:var(--red)"><div class="stat-num" style="color:var(--red)">${this.stats.inconsistencies}</div><div class="stat-label">冲突</div></div>
    `;
    document.getElementById('techTermsSubtitle').textContent = `共 ${this.stats.total} 条术语`;
  },

  async render() {
    const verified = document.getElementById('techTermsFilter').value;
    const q = document.getElementById('techTermsSearch').value;
    const sort = document.getElementById('techTermsSort').value;
    this.terms = await PaperAPI.getTechTerms({ verified, q, sort });
    if (!this.terms.length) {
      document.getElementById('techTermsList').innerHTML = '<div class="empty">没有匹配的术语</div>';
      return;
    }
    let html = '<table style="width:100%;border-collapse:collapse;font-size:.85rem"><thead style="background:var(--card)"><tr style="border-bottom:1px solid var(--border)">'
      + '<th style="text-align:left;padding:8px;color:var(--muted)">英文</th><th style="text-align:left;padding:8px;color:var(--muted)">中文</th><th style="text-align:left;padding:8px;color:var(--muted)">上下文</th><th style="text-align:center;padding:8px;color:var(--muted)">使用</th><th style="text-align:center;padding:8px;color:var(--muted)">审核</th><th style="text-align:left;padding:8px;color:var(--muted)">操作</th></tr></thead><tbody>';
    for (const t of this.terms) {
      const verifiedBadge = t.verified ? '<span style="color:var(--green)">✓</span>' : '<span style="color:var(--muted)">○</span>';
      html += `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:8px;font-weight:600">${esc(t.term_en)}</td>
        <td style="padding:8px">${esc(t.term_zh)}</td>
        <td style="padding:8px;color:var(--muted);font-size:.78rem">${esc(t.context || '-')}</td>
        <td style="padding:8px;text-align:center">${t.use_count}</td>
        <td style="padding:8px;text-align:center">${verifiedBadge}</td>
        <td style="padding:8px">
          ${!t.verified ? `<button class="btn" style="padding:2px 8px;font-size:.72rem" onclick="TechTermsApp.verify(${t.id})">审核</button>` : ''}
          <button class="btn" style="padding:2px 8px;font-size:.72rem" onclick="TechTermsApp.edit(${t.id})">编辑</button>
          <button class="btn" style="padding:2px 8px;font-size:.72rem;border-color:var(--red);color:var(--red)" onclick="TechTermsApp.delete(${t.id})">删除</button>
        </td>
      </tr>`;
    }
    html += '</tbody></table>';
    document.getElementById('techTermsList').innerHTML = html;
  },

  openAddModal() {
    document.getElementById('techTermsEditId').value = '';
    document.getElementById('techTermsEn').value = '';
    document.getElementById('techTermsZh').value = '';
    document.getElementById('techTermsContext').value = '';
    document.getElementById('techTermsModalTitle').textContent = '添加术语';
    document.getElementById('techTermsModal').classList.add('active');
  },

  async edit(id) {
    const term = this.terms.find(t => t.id === id);
    if (!term) return;
    document.getElementById('techTermsEditId').value = id;
    document.getElementById('techTermsEn').value = term.term_en;
    document.getElementById('techTermsZh').value = term.term_zh;
    document.getElementById('techTermsContext').value = term.context || '';
    document.getElementById('techTermsModalTitle').textContent = '编辑术语';
    document.getElementById('techTermsModal').classList.add('active');
  },

  closeModal() {
    document.getElementById('techTermsModal').classList.remove('active');
  },

  async save() {
    const id = document.getElementById('techTermsEditId').value;
    const term_en = document.getElementById('techTermsEn').value.trim();
    const term_zh = document.getElementById('techTermsZh').value.trim();
    const context = document.getElementById('techTermsContext').value.trim();
    if (!term_en || !term_zh) return alert('请填写英文和中文术语');
    if (id) {
      await PaperAPI.updateTechTerm(id, { term_en, term_zh, context });
    } else {
      await PaperAPI.addTechTerm({ term_en, term_zh, context });
    }
    this.closeModal();
    await this.render();
    await this.loadStats();
  },

  async verify(id) {
    await PaperAPI.verifyTechTerm(id);
    await this.render();
    await this.loadStats();
  },

  async delete(id) {
    if (!confirm('确定删除此术语？')) return;
    await PaperAPI.deleteTechTerm(id);
    await this.render();
    await this.loadStats();
  },

  async exportJson() {
    const data = await PaperAPI.exportTechTerms();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tech_terms.json';
    a.click();
    URL.revokeObjectURL(url);
  },

  async importJson(input) {
    const file = input.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      const result = await PaperAPI.importTechTerms(data);
      alert(`导入完成：新增 ${result.inserted} 条，更新 ${result.updated} 条`);
      await this.render();
      await this.loadStats();
    } catch (e) {
      alert('导入失败：' + e.message);
    }
    input.value = '';
  }
};

window.TechTermsApp = TechTermsApp;

document.addEventListener('mouseover', e => {
  const triggers = e.target.closest('[data-tooltip]') || e.target.closest('.paper-title[data-preview]') || e.target.closest('.paper-preview');
  if (!triggers) return;
  const tooltipId = triggers.dataset?.tooltip;
  if (!tooltipId) return;
  const tooltipEl = document.getElementById(tooltipId);
  if (tooltipEl) showTooltip(tooltipEl, e.clientX, e.clientY);
});
document.addEventListener('mousemove', e => {
  if (lastTooltipEl) {
    lastTooltipEl.style.setProperty('--tx', (e.clientX + 15) + 'px');
    lastTooltipEl.style.setProperty('--ty', (e.clientY + 15) + 'px');
  }
});
document.addEventListener('mouseout', e => {
  if (lastTooltipEl) hideTooltip(lastTooltipEl);
});