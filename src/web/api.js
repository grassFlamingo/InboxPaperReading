const API = '';

const api = {
  async getPapers(params = {}) {
    const q = new URLSearchParams(params);
    return fetch(`${API}/api/papers?${q}`).then(r => r.json()).then(res => {
      if (res.papers) return res;
      return { papers: res, total: res.length, offset: 0, limit: res.length, hasMore: false };
    });
  },

  async getPaper(id) {
    return fetch(`${API}/api/papers/${id}`).then(r => r.json());
  },

  async addPaper(data) {
    return fetch(`${API}/api/papers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => r.json());
  },

  async updatePaper(id, data) {
    return fetch(`${API}/api/papers/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => r.json());
  },

  async deletePaper(id) {
    return fetch(`${API}/api/papers/${id}`, { method: 'DELETE' });
  },

  async getStats() {
    return fetch(`${API}/api/stats`).then(r => r.json());
  },

  async getCategories() {
    return fetch(`${API}/api/categories`).then(r => r.json());
  },

  async summarize(id) {
    return fetch(`${API}/api/summarize/${id}`, { method: 'POST' }).then(r => r.json());
  },

  async ratePaper(id, rating) {
    return fetch(`${API}/api/papers/${id}/rate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating })
    });
  },

  async importUrl(url, priority, tags, notes) {
    return fetch(`${API}/api/import-url`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, priority, tags, notes })
    }).then(r => r.json());
  },

  async syncEmails() {
    return fetch(`${API}/api/sync`, { method: 'POST' }).then(r => r.json());
  },

  async getSyncStatus() {
    return fetch(`${API}/api/sync-status`).then(r => r.json());
  },

  async getBgTasksStatus() {
    return fetch(`${API}/api/bg-tasks-status`).then(r => r.json());
  },

  async runBgTask(task) {
    return fetch(`${API}/api/bg-task-run`, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task })
    }).then(r => r.json());
  },

  async getTechTerms(params = {}) {
    const q = new URLSearchParams(params);
    return fetch(`${API}/api/tech-terms?${q}`).then(r => r.json());
  },

  async getTechTermsStats() {
    return fetch(`${API}/api/tech-terms/stats`).then(r => r.json());
  },

  async addTechTerm(data) {
    return fetch(`${API}/api/tech-terms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => r.json());
  },

  async updateTechTerm(id, data) {
    return fetch(`${API}/api/tech-terms/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => r.json());
  },

  async verifyTechTerm(id) {
    return fetch(`${API}/api/tech-terms/verify/${id}`, { method: 'POST' }).then(r => r.json());
  },

  async deleteTechTerm(id) {
    return fetch(`${API}/api/tech-terms/${id}`, { method: 'DELETE' });
  },

  async exportTechTerms() {
    return fetch(`${API}/api/tech-terms/export`).then(r => r.json());
  },

  async importTechTerms(data) {
    return fetch(`${API}/api/tech-terms/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => r.json());
  },

  async getMarkdown(id) {
    return fetch(`${API}/api/papers/${id}/markdown`).then(r => r.json());
  },

  async cachePaper(id) {
    return fetch(`${API}/api/papers/${id}/cache`, { method: 'POST' }).then(r => r.json());
  },

  async getCachedPaper(id) {
    return fetch(`${API}/api/papers/${id}/cache`).then(r => r.json());
  },

  async deleteCachedPaper(id) {
    return fetch(`${API}/api/papers/${id}/cache`, { method: 'DELETE' }).then(r => r.json());
  },

  async getCachedPapers() {
    return fetch(`${API}/api/cached-papers`).then(r => r.json());
  },

  async redetectLayout() {
    return fetch(`${API}/api/layout-redetect`, { method: 'POST' }).then(r => r.json());
  },

  async getLayoutStats() {
    return fetch(`${API}/api/layout-stats`).then(r => r.json());
  },

  async startBgWorker(task) {
    return fetch(`${API}/api/bg-start`, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task })
    }).then(r => r.json());
  }
};

window.PaperAPI = api;