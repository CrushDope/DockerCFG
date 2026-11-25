/**
 * 与后端交互的统一封装。
 *
 * 会话失效（401）时通过 setUnauthorizedHandler 通知应用层回到登录界面。
 */
let unauthorizedHandler = null;

export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

async function request(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) {
    if (res.status === 401) unauthorizedHandler?.();
    const err = new Error(data.error || `请求失败 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  authStatus: () => request('/api/auth/status'),
  login: (password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),

  overview: () => request('/api/overview'),
  project: (name) => request(`/api/project/${encodeURIComponent(name)}`),
  createProject: (payload) => request('/api/project', { method: 'POST', body: JSON.stringify(payload) }),

  saveCompose: (name, content, envUpdates = []) =>
    request(`/api/project/${encodeURIComponent(name)}/compose`, { method: 'PUT', body: JSON.stringify({ content, envUpdates }) }),

  saveEnvRaw: (name, content) =>
    request(`/api/project/${encodeURIComponent(name)}/env/raw`, { method: 'PUT', body: JSON.stringify({ content }) }),

  containerAction: (id, action) =>
    request(`/api/container/${encodeURIComponent(id)}/action`, { method: 'POST', body: JSON.stringify({ action }) }),

  projectAction: (name, action) =>
    request(`/api/project/${encodeURIComponent(name)}/action`, { method: 'POST', body: JSON.stringify({ action }) }),
};
