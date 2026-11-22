/* Yolala's LN Reader - constants, shared state, helpers, API and toasts.
   Classic script: loaded in order from index.html; shared globals. */
'use strict';

/* ------------------------------------------------------------ constants -- */
const THEMES = [
  { id: 'cupertino', name: 'Cupertino', bg: '#131315', panel: '#1b1b1f', accent: '#0a84ff' },
  { id: 'graphite', name: 'Graphite', bg: '#1a1a1c', panel: '#232326', accent: '#ff9f0a' },
  { id: 'nord', name: 'Nord', bg: '#2e3440', panel: '#3b4252', accent: '#88c0d0' },
  { id: 'dracula', name: 'Dracula', bg: '#282a36', panel: '#343746', accent: '#bd93f9' },
  { id: 'gruvbox', name: 'Gruvbox', bg: '#282828', panel: '#32302f', accent: '#fabd2f' },
  { id: 'gruvbox-light', name: 'Gruvbox Light', bg: '#fbf1c7', panel: '#f2e5bc', accent: '#b57614' },
  { id: 'solarized-dark', name: 'Solarized', bg: '#002b36', panel: '#073642', accent: '#268bd2' },
  { id: 'solarized-light', name: 'Solarized Light', bg: '#fdf6e3', panel: '#eee8d5', accent: '#268bd2' },
  { id: 'one-dark', name: 'One Dark', bg: '#282c34', panel: '#2f343d', accent: '#61afef' },
  { id: 'catppuccin-mocha', name: 'Catppuccin', bg: '#1e1e2e', panel: '#27273a', accent: '#89b4fa' },
  { id: 'catppuccin-latte', name: 'Latte', bg: '#eff1f5', panel: '#e6e9ef', accent: '#1e66f5' },
  { id: 'tokyo-night', name: 'Tokyo Night', bg: '#1a1b26', panel: '#24283b', accent: '#7aa2f7' },
  { id: 'rose-pine-moon', name: 'Rosé Pine', bg: '#232136', panel: '#2a273f', accent: '#c4a7e7' },
  { id: 'rose-pine-dawn', name: 'Rosé Dawn', bg: '#faf4ed', panel: '#fffaf3', accent: '#907aa9' },
  { id: 'everforest', name: 'Everforest', bg: '#2b3339', panel: '#333c43', accent: '#a7c080' },
  { id: 'github-dark', name: 'GitHub', bg: '#0d1117', panel: '#161b22', accent: '#58a6ff' },
  { id: 'ayu-mirage', name: 'Ayu Mirage', bg: '#1f2430', panel: '#242936', accent: '#ffcc66' },
  { id: 'paper', name: 'Paper', bg: '#f6f1e7', panel: '#fffaf0', accent: '#a5642f' },
  { id: 'sepia', name: 'Sepia', bg: '#f0e6d2', panel: '#faf4e5', accent: '#8f5730' },
];
const COLORS = [
  { id: 'yellow', name: 'Yellow', hex: '#f2c94c' },
  { id: 'green', name: 'Green', hex: '#6fcf97' },
  { id: 'blue', name: 'Blue', hex: '#6aa9ff' },
  { id: 'pink', name: 'Pink', hex: '#f78fb3' },
  { id: 'purple', name: 'Purple', hex: '#b48cf2' },
  { id: 'orange', name: 'Orange', hex: '#f2994a' },
];
const DEFAULTS = { theme: 'cupertino', font: 'serif', size: 19, lh: 1.78, width: 720, justify: true };
const SEPIA = 'sepia';
const WPM = 230;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

const S = { books: [], highlights: [], bookmarks: [], settings: { ...DEFAULTS }, stats: {} };
const metaCache = new Map();
const chapterCache = new Map();
const R = { id: null, meta: null, ch: 0, prog: {}, hl: [], bm: [], ready: false, words: 0 };
let isOpen = false;
let view = 'library';
let pendingSel = null;
let hlColorFilter = '';
let progressTimer = null;
let hlRenderToken = 0;
let toastTimer = null;

/* -------------------------------------------------------------- helpers -- */
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

/* ------------------------------------------------------------------ api -- */
async function api(path, opts = {}) {
  const res = await fetch(path, opts);
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
function hideToast() { $('#toast').hidden = true; }
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
  node.hidden = false;
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
