/* API layer.
 *
 * Local development (`node server.js`) keeps using the same-origin JSON API.
 * The public GitHub Pages build talks to a Google Apps Script Web App with
 * JSONP, which avoids browser CORS and preflight restrictions entirely.
 *
 * The exported api(path, options) signature is unchanged, so the rest of the
 * frontend does not need to know which backend is active.
 */

const RAW_API_URL = typeof window !== 'undefined' && typeof window.ZEST_API_URL === 'string'
  ? window.ZEST_API_URL.trim()
  : '';
const API_URL = RAW_API_URL.replace(/\/+$/, '');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const IS_FILE = typeof location !== 'undefined' && location.protocol === 'file:';
const SERVED_BY_NODE = typeof location !== 'undefined'
  && !IS_FILE
  && LOCAL_HOSTS.has(location.hostname)
  && !new URLSearchParams(location.search).has('remote');
const USE_REMOTE = Boolean(API_URL) && !SERVED_BY_NODE;

const JSONP_CALLBACK = '__zestJsonp';
const JSONP_TIMEOUT = 30_000;

let requestSeq = 0;
const pending = new Map();

if (typeof window !== 'undefined') {
  window[JSONP_CALLBACK] = (id, payload) => {
    const resolve = pending.get(id);
    if (resolve) resolve(payload);
  };
}

/** True when the page has a backend it can talk to. */
export function isConfigured() {
  return USE_REMOTE || SERVED_BY_NODE;
}

/** 'apps-script', 'local-node' or 'none'. */
export function backendMode() {
  if (USE_REMOTE) return 'apps-script';
  if (SERVED_BY_NODE) return 'local-node';
  return 'none';
}

/**
 * Turns a REST-ish path such as `/api/day?user=ada&date=2026-11-05` into the
 * action name and parameters understood by apps-script/Code.gs.
 */
function toAction(path, method) {
  const base = typeof location !== 'undefined' && location.origin !== 'null'
    ? location.origin
    : 'https://zest.local';
  const url = new URL(path, base);
  const pathname = url.pathname.replace(/\/+$/, '');
  const params = {};
  for (const [key, value] of url.searchParams) params[key] = value;
  params.method = method;

  if (pathname === '/api/health') return { action: 'health', params };
  if (pathname === '/api/users') return { action: 'users', params };
  if (pathname === '/api/profile') return { action: 'profile', params };
  if (pathname === '/api/history') return { action: 'history', params };
  if (pathname === '/api/day/topup') return { action: 'topup', params };
  if (pathname === '/api/day') return { action: 'day', params };
  if (pathname === '/api/entries') return { action: 'entries', params };

  const entryMatch = pathname.match(/^\/api\/entries\/([^/]+)$/);
  if (entryMatch) {
    params.id = decodeURIComponent(entryMatch[1]);
    return { action: 'entry', params };
  }

  throw new Error(`Unknown API route: ${pathname}`);
}

function jsonpRequest(action, params) {
  return new Promise((resolve, reject) => {
    const id = `z${Date.now().toString(36)}${(++requestSeq).toString(36)}`;
    const url = new URL(API_URL);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    }
    url.searchParams.set('action', action);
    url.searchParams.set('rid', id);
    url.searchParams.set('callback', JSONP_CALLBACK);

    const script = document.createElement('script');
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pending.delete(id);
      script.remove();
      fn(value);
    };

    const timer = setTimeout(() => {
      finish(
        reject,
        new Error(
          'The Google Sheets backend did not respond. Check that the Apps Script Web App is deployed with access set to “Anyone”.',
        ),
      );
    }, JSONP_TIMEOUT);

    pending.set(id, (payload) => finish(resolve, payload));
    script.onerror = () => finish(
      reject,
      new Error('Could not reach the Google Sheets backend. Check your connection and the Web App URL in config.js.'),
    );
    script.src = url.toString();
    document.head.appendChild(script);
  });
}

function unwrap(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('The Google Sheets backend returned an unexpected response.');
  }
  if (payload.ok === false) {
    const detail = payload.error || {};
    const error = new Error(detail.message || 'The request failed.');
    error.status = detail.status;
    error.code = detail.code;
    error.data = detail;
    throw error;
  }
  return payload.data;
}

async function remoteApi(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const { action, params } = toAction(path, method);
  if (options.body !== undefined) {
    params.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }
  const payload = await jsonpRequest(action, params);
  return unwrap(payload);
}

async function localApi(path, options = {}) {
  const init = {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  };
  if (options.body !== undefined) {
    init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }
  let response;
  try {
    response = await fetch(path, init);
  } catch {
    const error = new Error('Could not reach the local server. Is `node server.js` still running?');
    error.offline = true;
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status}).`);
    error.status = response.status;
    error.code = data.code;
    error.data = data;
    throw error;
  }
  return data;
}

export async function api(path, options = {}) {
  if (USE_REMOTE) return remoteApi(path, options);
  if (SERVED_BY_NODE) return localApi(path, options);

  const error = new Error(
    'Zest has no backend configured. Open public/config.js and set window.ZEST_API_URL to your Google Apps Script Web App URL.',
  );
  error.code = 'not-configured';
  throw error;
}
