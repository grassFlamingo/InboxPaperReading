const API = '';

const api = {
  async getPapers(params = {}) {
    const q = new URLSearchParams(params);
    return fetch(`${API}/api/papers?${q}`).then(r => r.json());
  },

  async getPaper(id) {
    return fetch(`${API}/api/papers`).then(r => r.json()).then(list => list.find(p => p.id === id));
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

  async getSummaryStatus() {
    return fetch(`${API}/api/summary-status`).then(r => r.json());
  },

  async stopBgSummary() {
    return fetch(`${API}/api/summary-bg-stop`, { method: 'POST' });
  }
};

window.PaperAPI = api;