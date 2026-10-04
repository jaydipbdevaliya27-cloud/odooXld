/**
 * @file client/js/api.js
 * @description Standardized native fetch wrapper for all client API communications.
 * Supports query building, AbortController cancellation signals, and normalized error objects.
 */

const api = {
  /**
   * Builds full URL with query parameters.
   */
  buildUrl(url, params = {}) {
    const keys = Object.keys(params).filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '');
    if (!keys.length) return url;
    const qs = keys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
    return `${url}${url.includes('?') ? '&' : '?'}${qs}`;
  },

  /**
   * Internal request handler.
   */
  async request(url, options = {}) {
    const defaultHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    const config = {
      ...options,
      headers: {
        ...defaultHeaders,
        ...(options.headers || {})
      }
    };

    if (options.body && typeof options.body === 'object') {
      config.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(url, config);

      if (response.status === 401) {
        const publicPaths = ['/', '/index.html', '/shared/login.html', '/shared/contact.html'];
        if (!publicPaths.includes(window.location.pathname)) {
          window.location.href = '/shared/login.html';
        }
        const err = new Error('Authentication required.');
        err.code = 'UNAUTHORIZED';
        err.status = 401;
        throw err;
      }

      const contentType = response.headers.get('content-type');
      let data;
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      if (!response.ok) {
        const errorMsg = data && data.error ? data.error : (typeof data === 'string' && data ? data : `Request failed with status ${response.status}`);
        const err = new Error(errorMsg);
        err.status = response.status;
        err.code = data && data.code ? data.code : 'API_ERROR';
        err.fields = data && data.fields ? data.fields : undefined;
        throw err;
      }

      return data;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw err;
      }
      if (!err.status) {
        err.message = err.message || 'Unable to connect to server. Please check your network connection.';
        err.code = 'NETWORK_ERROR';
      }
      throw err;
    }
  },

  get(url, params = {}, options = {}) {
    const fullUrl = this.buildUrl(url, params);
    return this.request(fullUrl, { method: 'GET', ...options });
  },

  post(url, body = {}, options = {}) {
    return this.request(url, { method: 'POST', body, ...options });
  },

  put(url, body = {}, options = {}) {
    return this.request(url, { method: 'PUT', body, ...options });
  },

  del(url, body = {}, options = {}) {
    return this.request(url, { method: 'DELETE', body, ...options });
  },

  delete(url, body = {}, options = {}) {
    return this.request(url, { method: 'DELETE', body, ...options });
  }
};

window.api = api;
