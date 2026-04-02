const PaperApp = {
  papers: [],
  categories: [],

  async init() {
    await this.loadCategories();
    await this.render();
    this.startBgPoll();
  },

  async loadCategories() {
    this.categories = await PaperAPI.getCategories();
    document.getElementById('filterCat').innerHTML = RenderUtils.renderCategorySelect(this.categories);
  },

  async loadStats() {
    const s = await PaperAPI.getStats();
    document.getElementById('stats').innerHTML = RenderUtils.renderStats(s);
    document.getElementById('subtitle').textContent = `SQLite 驱动 · 实时渲染 · ${s.total} 篇`;
  },

  async render() {
    const cat = document.getElementById('filterCat').value;
    const status = document.getElementById('filterStatus').value;
    const sort = document.getElementById('sortBy').value;
    const q = document.getElementById('searchBox').value;
    const sourceType = document.getElementById('filterSourceType').value;
    const layoutMode = document.getElementById('layoutMode').value;

    const params = {};
    if (cat) params.category = cat;
    if (status) params.status = status;
    if (sort) params.sort = sort;
    if (q) params.q = q;

    this.papers = await PaperAPI.getPapers(params);

    if (sourceType) {
      this.papers = this.papers.filter(p => (p.source_type || 'paper') === sourceType);
    }

    await this.loadStats();

    if (!this.papers.length) {
      document.getElementById('paperList').innerHTML = '<div class="empty">没有匹配的论文</div>';
      return;
    }

    this.papers.sort((a, b) => {
      const sa = RenderUtils.STATUS_ORDER[a.status] ?? 1;
      const sb = RenderUtils.STATUS_ORDER[b.status] ?? 1;
      if (sa !== sb) return sa - sb;
      return 0;
    });

    if (layoutMode === 'grid') {
      document.getElementById('appContainer').className = 'paper-container grid-mode';
      document.getElementById('paperList').innerHTML = `<div class="paper-grid">${RenderUtils.renderPaperList(this.papers, { grid: true })}</div>`;
      return;
    }

    document.getElementById('appContainer').className = 'paper-container';

    const activeGroups = {}, doneGroups = {};
    this.papers.forEach(p => {
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
  },

  async markReading(id, e) {
    e.preventDefault();
    const pUrl = e.currentTarget.href;
    await PaperAPI.updatePaper(id, { status: 'reading' });
    window.open(pUrl, '_blank');
    this.render();
    this.loadCategories();
  },

  async cycleStatus(id, current) {
    const next = RenderUtils.STATUS_NEXT[current] || 'reading';
    await PaperAPI.updatePaper(id, { status: next });
    this.render();
  },

  async deletePaper(id) {
    if (!confirm('确定删除这篇论文？')) return;
    await PaperAPI.deletePaper(id);
    this.render();
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
      source_type: document.getElementById('fSourceType').value || 'paper',
    };
    const editId = document.getElementById('editId').value;
    if (editId) {
      await PaperAPI.updatePaper(editId, data);
    } else {
      await PaperAPI.addPaper(data);
    }
    this.closeModal();
    this.render();
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
        this.render();
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
    const poll = async () => {
      try {
        const s = await PaperAPI.getSummaryStatus();
        const bar = document.getElementById('bgSummaryBar');
        if (s.running) {
          bar.style.display = 'block';
          const pct = s.total > 0 ? Math.round(s.done / s.total * 100) : 0;
          document.getElementById('bgSummaryProgress').textContent = `${s.done}/${s.total} (${pct}%)`;
          document.getElementById('bgSummaryCurrent').textContent = s.current || '';
          document.getElementById('bgSummaryFill').style.width = pct + '%';
        } else if (bar.style.display !== 'none') {
          bar.style.display = 'none';
          if (s.done > 0) this.render();
        }
      } catch(e) {}
    };
    poll();
    setInterval(poll, 5000);
  },

  stopBgSummary() {
    PaperAPI.stopBgSummary();
    document.getElementById('bgSummaryBar').style.display = 'none';
  }
};

window.PaperApp = PaperApp;