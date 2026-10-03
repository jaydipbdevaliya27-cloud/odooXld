/**
 * @file client/js/api.js
 * @description Thin HTTP wrapper used by all pages.
 * api.get('/api/courts')  →  fetches GET /api/courts, returns parsed JSON.
 * api.post('/api/bookings', body) → POST with JSON body.
 * Automatically redirects to login on 401.
 */

const api = (() => {
  /**
   * Core fetch wrapper. Adds JSON headers, checks status, auto-redirects on 401.
   */
  async function request(method, url, body) {
    const opts = {
      method,
      credentials: 'same-origin',   // send session cookie
      headers: { 'Content-Type': 'application/json' }
    };
    if (body !== undefined) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);

    // Not authenticated → go to login
    if (res.status === 401) {
      window.location.href = '/shared/login.html';
      return;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  return {
    get:    (url)        => request('GET',    url),
    post:   (url, body)  => request('POST',   url, body),
    put:    (url, body)  => request('PUT',    url, body),
    del:    (url)        => request('DELETE', url)
  };
})();
