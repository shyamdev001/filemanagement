async function request(method, url, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${url}`, opts);
  } catch {
    throw new Error('Cannot reach the app server. Is the black start window still open?');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/login') window.dispatchEvent(new Event('login-needed'));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong'), { data });
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  patch: (url, body) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
};

export const datasheetUrl = (file) => `/api/datasheet?file=${encodeURIComponent(file)}`;
export const fileName = (path) => path.split('/').pop();
