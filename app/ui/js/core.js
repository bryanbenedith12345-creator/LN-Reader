/* Yolala's LN Reader - shared state, helpers, API access and toasts.
   Classic script: loaded in order from index.html; shared globals. */
'use strict';

/* ------------------------------------------------------------ constants -- */
const COLORS = [
  { id: 'yellow', name: 'Yellow', hex: '#f2c94c' },
  { id: 'green', name: 'Green', hex: '#6fcf97' },
  { id: 'blue', name: 'Blue', hex: '#6aa9ff' },
  { id: 'pink', name: 'Pink', hex: '#f78fb3' },
  { id: 'purple', name: 'Purple', hex: '#b48cf2' },
  { id: 'orange', name: 'Orange', hex: '#f2994a' },
];
const DEFAULTS = { theme: 'cupertino', font: 'serif', size: 19, lh: 1.78, width: 720, justify: true };
const WPM = 230;

/* ---------------------------------------------------------------- state -- */
const S = { books: [], highlights: [], favorites: [], collections: [], collectionBooks: {}, settings: { ...DEFAULTS }, stats: {} };
const R = { id: null, meta: null, ch: 0, prog: {}, hl: [], ready: false, words: 0 };
const metaCache = new Map();
const chapterCache = new Map();
let isOpen = false;
let view = 'library';
let pendingSel = null;
let hlColorFilter = '';
let progressTimer = null;
let hlRenderToken = 0;
let toastTimer = null;

/* -------------------------------------------------------------- helpers -- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtWords(n) {
  if (!n) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
}
function fmtDur(mins) {
  mins = Math.max(0, Math.round(mins));
  if (mins < 1) return 'under a minute';
  if (mins < 60) return mins + ' min';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h + 'h' + (m ? ' ' + m + 'm' : '');
}
function fmtDate(sec) {
  if (!sec) return '';
  const d = new Date(sec * 1000);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
function bookPct(book) {
  const p = book.progress || {};
  const total = book.chapters || 1;
  return clamp((((p.ch || 0) + (p.ratio || 0)) / total) * 100, 0, 100);
}
function markQuery(text, query) {
  const safe = esc(text);
  if (!query) return safe;
  const q = esc(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safe.replace(new RegExp(q, 'gi'), (m) => `<mark>${m}</mark>`);
}
function colorHex(id) {
  return (COLORS.find((c) => c.id === id) || COLORS[0]).hex;
}

/* ------------------------------------------------------------------ api -- */
const TOKEN = (document.querySelector('meta[name="ln-token"]') || {}).content || '';

async function api(path, opts = {}, retry = true) {
  const res = await fetch(path, {
    ...opts,
    headers: { ...(opts.headers || {}), 'X-LN-Token': TOKEN },
  });
  if (res.status === 401 && retry) {
    location.reload();
    throw new Error('refreshing the session');
  }
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch (_) { /* ignore */ }
    throw new Error(msg || 'request failed');
  }
  const type = res.headers.get('content-type') || '';
  return type.includes('application/json') ? res.json() : res;
}
const getJSON = (path) => api(path);
const postJSON = (path, body) => api(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
});

/* ---------------------------------------------------------------- toast -- */
function hideToast() { hideEl($('#toast'), MOTION.fast); }
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch (_) {
    const field = document.createElement('textarea');
    field.value = text;
    field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(field);
    field.select();
    try { document.execCommand('copy'); toast('Copied'); } catch (err) { toast('Could not copy'); }
    field.remove();
  }
}
function toast(message, opts = {}) {
  const node = $('#toast');
  showEl(node);
  node.innerHTML = '';
  const text = document.createElement('span');
  text.textContent = message;
  node.appendChild(text);
  if (opts.action) {
    const btn = document.createElement('button');
    btn.className = 't-action' + (opts.action.danger ? ' danger' : '');
    btn.textContent = opts.action.label;
    btn.onclick = () => { hideToast(); opts.action.fn(); };
    node.appendChild(btn);
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, opts.timeout || 4200);
}
