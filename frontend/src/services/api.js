/**
 * ENSEM ACCESS – Service API centralisé
 * Toutes les requêtes passent par ce module.
 */

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function getToken() {
  return localStorage.getItem('ensem_token');
}

function setToken(token) {
  localStorage.setItem('ensem_token', token);
}

function removeToken() {
  localStorage.removeItem('ensem_token');
  localStorage.removeItem('ensem_user');
}

function setUser(user) {
  localStorage.setItem('ensem_user', JSON.stringify(user));
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem('ensem_user') || 'null');
  } catch { return null; }
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = new Error(data.error || `Erreur ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export const api = {
  auth: {
    register: (body) => request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
    login: async (body) => {
      const data = await request('/auth/login', { method: 'POST', body: JSON.stringify(body) });
      if (data.token) { setToken(data.token); setUser(data.user); }
      return data;
    },
    logout: () => { removeToken(); },
    me: () => request('/auth/me'),
    verifyEmail: (token) => request(`/auth/verify-email/${token}`),
    resendVerification: (email) => request('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) }),
    checkDuplicate: (body) => request('/auth/check-duplicate', { method: 'POST', body: JSON.stringify(body) }),
  },

  admin: {
    import: (file) => {
      const form = new FormData();
      form.append('file', file);
      const token = getToken();
      return fetch(`${BASE_URL}/admin/import`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      }).then(r => r.json());
    },
    getStats: () => request('/admin/stats'),
    getLaureats: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return request(`/admin/laureats${q ? '?' + q : ''}`);
    },
    updateQuota: (id, quota) => request(`/admin/laureats/${id}/quota`, { method: 'PUT', body: JSON.stringify({ quota }) }),
    generatePass: (id) => request(`/admin/laureats/${id}/pass`, { method: 'POST' }),
    getValidationQueue: () => request('/admin/validation-queue'),
    validateUser: (userId, body) => request(`/admin/validate/${userId}`, { method: 'PUT', body: JSON.stringify(body) }),
    searchEmergency: (query) => request('/admin/emergency-pass', { method: 'POST', body: JSON.stringify({ query }) }),
    generateEmergencyPass: (id) => request(`/admin/emergency-pass/${id}/generate`, { method: 'POST' }),
    getAgents: () => request('/admin/agents'),
    inviteAgent: (email) => request('/admin/agent-invite', { method: 'POST', body: JSON.stringify({ email }) }),
    getScans: () => request('/admin/scans'),
    updateAgentStatus: (id, status) => request(`/admin/agents/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
  },

  pass: {
    getMyPass: () => request('/pass/my-pass'),
    getPublicKey: () => request('/pass/public-key'),
  },

  scan: {
    check: (token, device_id = 'web') =>
      request('/scan/check', { method: 'POST', body: JSON.stringify({ token, device_id }) }),
    validate: (token, invites_count = 0, device_id = 'web') =>
      request('/scan/validate', { method: 'POST', body: JSON.stringify({ token, invites_count, device_id }) }),
    getAudit: () => request('/scan/audit'),
  },

  getToken, setToken, removeToken, getUser, setUser,
};

export default api;
