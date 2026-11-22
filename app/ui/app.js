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

/* ------------------------------------------------------------- settings -- */
function applySettings(persist = true) {
  const s = S.settings, root = document.documentElement;
  root.dataset.theme = s.theme;
  if (s.theme !== SEPIA) {
    localStorage.setItem('ln.baseTheme', s.theme);
  } else if (!THEMES.some((t) => t.id === localStorage.getItem('ln.baseTheme') && t.id !== SEPIA)) {
    localStorage.setItem('ln.baseTheme', 'cupertino');
  }
  root.style.setProperty('--rd-size', s.size + 'px');
  root.style.setProperty('--rd-lh', String(s.lh));
  root.style.setProperty('--rd-width', s.width + 'px');
  root.style.setProperty('--rd-font', s.font === 'sans' ? 'var(--sans)' : 'var(--serif)');
  root.style.setProperty('--rd-align', s.justify ? 'justify' : 'left');
  $('#setSize').value = s.size; $('#outSize').textContent = s.size;
  $('#setLh').value = s.lh; $('#outLh').textContent = Number(s.lh).toFixed(2);
  $('#setWidth').value = s.width; $('#outWidth').textContent = s.width;
  $('#setJustify').checked = !!s.justify;
  $('#libSort').value = localStorage.getItem('ln.sort') || 'recent';
  $$('#fontSeg button').forEach((b) => b.classList.toggle('on', b.dataset.font === s.font));
  $$('.theme-tile').forEach((t) => t.classList.toggle('on', t.dataset.theme === s.theme));
  updateThemeButtons();
  if (persist) {
    clearTimeout(applySettings.timer);
    applySettings.timer = setTimeout(() => postJSON('/api/settings', s).catch(() => {}), 500);
  }
}
function updateSetting(key, value, keepScroll = true) {
  const ratio = isOpen && R.ready ? currentRatio() : null;
  S.settings[key] = value;
  applySettings();
  if (ratio !== null && keepScroll) requestAnimationFrame(() => restoreScroll(ratio));
}
function baseTheme() {
  const saved = localStorage.getItem('ln.baseTheme');
  return THEMES.some((t) => t.id === saved && t.id !== SEPIA) ? saved : 'cupertino';
}
function setTheme(id) {
  const ratio = isOpen && R.ready ? currentRatio() : null;
  S.settings.theme = id;
  applySettings();
  if (ratio !== null) requestAnimationFrame(() => restoreScroll(ratio));
}
function toggleSepia() {
  setTheme(S.settings.theme === SEPIA ? baseTheme() : SEPIA);
}
function updateThemeButtons() {
  const on = S.settings.theme === SEPIA;
  const icon = on ? '#i-moon' : '#i-sun';
  $$('#btnSepia, #rTheme').forEach((btn) => {
    btn.classList.toggle('is-on', on);
    const use = btn.querySelector('use');
    if (use) use.setAttribute('href', icon);
  });
  const side = $('#btnSepia');
  side.title = on ? 'Sepia theme is on — click to go back (S)' : 'Switch to the sepia reading theme (S)';
  side.querySelector('span').textContent = on ? 'Exit sepia' : 'Sepia theme';
  $('#rTheme').title = on ? 'Turn off sepia (S)' : 'Sepia theme (S)';
}
function renderThemes() {
  const grid = $('#themeGrid');
  grid.innerHTML = THEMES.map((t) => `
    <button class="theme-tile" data-theme="${t.id}" title="${esc(t.name)}">
      <span class="sw3"><i style="background:${t.bg}"></i><i style="background:${t.panel}"></i><i style="background:${t.accent}"></i></span>
      <span>${esc(t.name)}</span>
    </button>`).join('');
  grid.onclick = (e) => {
    const tile = e.target.closest('.theme-tile');
    if (tile) setTheme(tile.dataset.theme);
  };
}

/* -------------------------------------------------------------- library -- */
async function loadLibrary() {
  const data = await getJSON('/api/library');
  S.books = data.books || [];
  S.highlights = data.highlights || [];
  S.bookmarks = data.bookmarks || [];
  S.stats = data.stats || {};
  S.settings = { ...DEFAULTS, ...(data.settings || {}) };
  applySettings(false);
  renderLibrary();
  renderHighlightFilters();
  renderHighlights();
  updateCounts();
}
function readCount() {
  return S.books.reduce((total, book) => total + ((book.progress && book.progress.read) || []).length, 0);
}
function updateCounts() {
  $('#navCount').textContent = S.books.length || '';
  $('#hlNavCount').textContent = S.highlights.length || '';
  $('#sideFoot').innerHTML = `<b>${S.books.length}</b> books · <b>${S.highlights.length}</b> highlights<br>` +
    `<b>${readCount()}</b> chapters read · <b>${fmtWords(S.stats.words || 0)}</b> words`;
}
function hydrateCovers(root) {
  $$('.cover img', root).forEach((img) => {
    const settle = () => img.classList.add('loaded');
    img.addEventListener('load', settle);
    img.addEventListener('error', () => {
      img.remove();
      const gen = img.closest('.cover')?.querySelector('.cover-gen');
      if (gen) gen.hidden = false;
    });
    if (img.complete && img.naturalWidth) settle();
  });
}
function coverHTML(book, extra = '') {
  return `<div class="cover ${extra}">` +
    `<div class="cover-gen">${esc(book.title)}</div>` +
    (book.cover ? `<img src="/api/cover/${book.id}" alt="" loading="lazy">` : '') +
    `<div class="cover-prog"><i style="width:${bookPct(book).toFixed(1)}%"></i></div></div>`;
}
function renderLibrary() {
  const query = $('#libSearch').value.trim().toLowerCase();
  const sort = $('#libSort').value;
  const list = S.books
    .filter((b) => !query || (b.title + ' ' + b.author).toLowerCase().includes(query))
    .sort((a, b) => {
      if (sort === 'added') return (b.added || 0) - (a.added || 0);
      if (sort === 'title') return a.title.localeCompare(b.title);
      if (sort === 'author') return a.author.localeCompare(b.author) || a.title.localeCompare(b.title);
      if (sort === 'progress') return bookPct(b) - bookPct(a);
      return ((b.progress || {}).updated || b.added || 0) - ((a.progress || {}).updated || a.added || 0);
    });

  const last = S.books.filter((b) => b.progress && b.progress.updated)
    .sort((a, b) => b.progress.updated - a.progress.updated)[0];
  $('#continueWrap').innerHTML = !last ? '' : `
    <div class="continue" data-id="${last.id}">
      ${coverHTML(last, 'cc-cover')}
      <div class="cc-body">
        <span class="cc-eyebrow">Continue reading</span>
        <h2>${esc(last.title)}</h2>
        <p>Chapter ${(last.progress.ch || 0) + 1} of ${last.chapters} · ${Math.round(bookPct(last))}% · ${fmtDur((last.words || 0) * (1 - bookPct(last) / 100) / WPM)} left</p>
        <div class="cc-bar"><i style="width:${bookPct(last).toFixed(1)}%"></i></div>
      </div>
      <button class="btn primary" data-act="resume">Resume</button>
    </div>`;
  hydrateCovers($('#continueWrap'));

  const grid = $('#grid');
  grid.innerHTML = list.map((b) => `
    <div class="card" data-id="${b.id}" tabindex="0" role="button" aria-label="${esc(b.title)}">
      ${coverHTML(b)}
      <button class="card-del" data-del="${b.id}" title="Remove book" aria-label="Remove ${esc(b.title)}">
        <svg><use href="#i-trash"/></svg>
      </button>
      <div class="card-meta">
        <span class="card-title">${esc(b.title)}</span>
        <span class="card-author">${esc(b.author)}</span>
      </div>
    </div>`).join('');

  if (!list.length && S.books.length) {
    grid.innerHTML = `<div class="find-note">No books match “${esc(query)}”.</div>`;
  }
  $('#empty').hidden = S.books.length > 0;
  $('#grid').hidden = S.books.length === 0;
  $('#libSub').textContent = S.books.length
    ? `${S.books.length} book${S.books.length === 1 ? '' : 's'} on the shelf`
    : 'Your shelf';

  hydrateCovers(grid);
}
function confirmDelete(book) {
  toast(`Remove “${book.title}” from your library?`, {
    timeout: 8000,
    action: {
      label: 'Remove', danger: true, fn: async () => {
        try {
          const lib = await postJSON('/api/delete', { book: book.id });
          metaCache.delete(book.id);
          S.books = lib.books; S.highlights = lib.highlights; S.stats = lib.stats;
          renderLibrary(); renderHighlightFilters(); renderHighlights(); updateCounts();
          toast('Book removed');
        } catch (err) { toast('Could not remove: ' + err.message); }
      },
    },
  });
}

/* ---------------------------------------------------------------- views -- */
function setView(name) {
  view = name;
  $$('.nav-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === 'view-' + name));
  if (name === 'highlights') renderHighlights();
}

/* --------------------------------------------------------- highlight list -- */
function renderHighlightFilters() {
  const bookId = $('#hlBook').value;
  const pool = S.highlights.filter((h) => !bookId || h.book === bookId);
  if (hlColorFilter && !pool.some((h) => h.color === hlColorFilter)) hlColorFilter = '';
  const chips = COLORS.map((c) => {
    const n = pool.filter((h) => h.color === c.id).length;
    if (!n) return '';
    return `<button class="chip${hlColorFilter === c.id ? ' on' : ''}" data-color="${c.id}">
      <i style="background:${c.hex}"></i>${c.name}<span class="n">${n}</span></button>`;
  }).join('');
  $('#hlColors').innerHTML = `<button class="chip${hlColorFilter ? '' : ' on'}" data-color="">All<span class="n">${pool.length}</span></button>${chips}`;

  const select = $('#hlBook');
  const current = select.value;
  select.innerHTML = `<option value="">All books</option>` + S.books
    .map((b) => `<option value="${b.id}">${esc(b.title)}</option>`).join('');
  select.value = S.books.some((b) => b.id === current) ? current : '';
}

async function renderHighlights() {
  const token = ++hlRenderToken;
  const query = $('#hlSearch').value.trim();
  const needle = query.toLowerCase();
  const bookId = $('#hlBook').value;
  const list = S.highlights.filter((h) =>
    (!hlColorFilter || h.color === hlColorFilter) &&
    (!bookId || h.book === bookId) &&
    (!needle || (h.quote + ' ' + (h.note || '')).toLowerCase().includes(needle)));

  const grouped = new Map();
  for (const h of list) {
    if (!grouped.has(h.book)) grouped.set(h.book, []);
    grouped.get(h.book).push(h);
  }
  const ids = Array.from(grouped.keys());
  const metas = await Promise.all(ids.map((id) => getMeta(id).catch(() => null)));
  if (token !== hlRenderToken) return;
  const groups = ids.map((id, index) => {
    const book = S.books.find((b) => b.id === id);
    const meta = metas[index];
    return { id, meta, items: grouped.get(id), title: (book && book.title) || (meta && meta.title) || 'Unknown book' };
  });
  groups.sort((a, b) => Math.max(...b.items.map((h) => h.created)) - Math.max(...a.items.map((h) => h.created)));

  const html = groups.map((g) => {
    const rows = g.items.slice().sort((a, b) => b.created - a.created).map((h) => {
      const chapter = g.meta && g.meta.chapters[h.ch] ? g.meta.chapters[h.ch].title : `Chapter ${h.ch + 1}`;
      const color = (COLORS.find((c) => c.id === h.color) || COLORS[0]).hex;
      const quote = h.quote.length > 420 ? h.quote.slice(0, 420) + '…' : h.quote;
      return `<div class="hl-row" data-hid="${esc(h.id)}" style="--hl:${color}">
        <i class="hl-bar"></i>
        <div class="hl-main" data-open="${esc(h.id)}">
          <div class="hl-quote">${markQuery(quote, query)}</div>
          ${h.note ? `<div class="hl-note">${markQuery(h.note, query)}</div>` : ''}
          <div class="hl-meta"><span>${esc(chapter)}</span><span class="sep">·</span><span>${fmtDate(h.created)}</span></div>
        </div>
        <div class="hl-acts">
          <button data-act="copy" title="Copy quote"><svg><use href="#i-mark"/></svg></button>
          <button data-act="delete" class="danger" title="Delete highlight"><svg><use href="#i-trash"/></svg></button>
        </div>
      </div>`;
    }).join('');
    return `<div class="hl-book"><span>${esc(g.title)}</span></div>${rows}`;
  }).join('');

  $('#hlList').innerHTML = html;
  $('#hlEmpty').hidden = list.length > 0;
  const noneAtAll = S.highlights.length === 0;
  $('#hlEmpty h2').textContent = noneAtAll ? 'No highlights yet' : 'No matches';
  $('#hlEmpty p').textContent = noneAtAll
    ? 'Select text while reading, then pick a colour. Highlights are searchable here.'
    : 'Try a different search, colour or book.';
  $('#hlSub').textContent = `${S.highlights.length} highlights · ${readCount()} chapters read · ${fmtWords(S.stats.words || 0)} words`;
}

function highlightById(id) { return S.highlights.find((h) => h.id === id); }

async function deleteHighlight(h) {
  S.highlights = S.highlights.filter((x) => x.id !== h.id);
  if (R.id === h.book) { R.hl = R.hl.filter((x) => x.id !== h.id); paintHighlights(); }
  try { await postJSON('/api/highlights', { book: h.book, list: S.highlights.filter((x) => x.book === h.book) }); } catch (_) { /* ignore */ }
  S.stats.highlights = S.highlights.length;
  renderHighlightFilters();
  updateCounts();
  renderHighlights();
  toast('Highlight deleted');
}

/* ------------------------------------------------------------------ meta -- */
async function getMeta(id) {
  if (metaCache.has(id)) return metaCache.get(id);
  const detail = await getJSON('/api/book/' + id);
  metaCache.set(id, detail.meta);
  return detail.meta;
}
async function getChapter(bookId, index) {
  const key = bookId + ':' + index;
  if (chapterCache.has(key)) return chapterCache.get(key);
  const data = await getJSON(`/api/book/${bookId}/chapter/${index}`);
  chapterCache.set(key, data);
  while (chapterCache.size > 8) chapterCache.delete(chapterCache.keys().next().value);
  return data;
}

/* ---------------------------------------------------------------- reader -- */
async function openBook(id, chapter, opts = {}) {
  let detail;
  try {
    detail = await getJSON('/api/book/' + id);
  } catch (err) {
    toast('Could not open this book: ' + err.message);
    return;
  }
  metaCache.set(id, detail.meta);
  R.id = id;
  R.meta = detail.meta;
  R.prog = detail.progress || {};
  R.hl = detail.highlights || [];
  R.bm = detail.bookmarks || [];
  R.ready = false;
  findColor = '';
  R.prog.scroll = R.prog.scroll || {};
  R.ch = clamp(chapter ?? R.prog.ch ?? 0, 0, R.meta.chapters.length - 1);
  $('#rTitle').textContent = R.meta.title;
  $('#reader').hidden = false;
  isOpen = true;
  document.title = R.meta.title + " — Yolala's LN Reader";
  buildToc();
  updateBookmarkBtn();
  await loadChapter(R.ch, opts);
}

function currentRatio() {
  const sc = $('#rScroll');
  const max = sc.scrollHeight - sc.clientHeight;
  if (max <= 4) return 1;
  return clamp(sc.scrollTop / max, 0, 1);
}
let scrollLocked = true;
function restoreScroll(ratio) {
  const sc = $('#rScroll');
  scrollLocked = false;
  const apply = () => {
    if (scrollLocked || !isOpen) return;
    const max = sc.scrollHeight - sc.clientHeight;
    if (max > 0) sc.scrollTop = clamp(ratio, 0, 1) * max;
  };
  apply();
  requestAnimationFrame(apply);
  $$('#rBody img').forEach((img) => {
    if (!img.complete) img.addEventListener('load', apply, { once: true });
  });
  [60, 220, 500].forEach((ms) => setTimeout(apply, ms));
  setTimeout(() => { scrollLocked = true; }, 1200);
}

let chapterToken = 0;
async function loadChapter(index, opts = {}) {
  if (!R.meta) return;
  const total = R.meta.chapters.length;
  const next = clamp(index, 0, total - 1);
  const token = ++chapterToken;
  if (R.ready) {
    const ratio = currentRatio();
    R.prog.scroll[String(R.ch)] = ratio;
    queueProgress(R.ch, ratio);
  }
  R.ready = false;
  hideSelBar();
  hideHighlightPop();
  let data;
  try {
    data = await getChapter(R.id, next);
  } catch (err) {
    if (token === chapterToken) R.ready = true;
    toast('Could not load this chapter: ' + err.message);
    return;
  }
  if (token !== chapterToken || !isOpen || !R.meta) return;
  R.ch = next;
  const body = $('#rBody');
  body.innerHTML = data.html;
  R.words = (body.textContent || '').trim().split(/\s+/).filter(Boolean).length;
  body.classList.remove('enter');
  void body.offsetWidth;
  body.classList.add('enter');
  $$('#rBody img').forEach((img) => img.addEventListener('error', () => img.remove(), { once: true }));
  paintHighlights();
  R.ready = true;
  const stored = R.prog.scroll[String(next)];
  const ratio = opts.ratio != null ? opts.ratio : (typeof stored === 'number' ? stored : 0);
  updateChapterChrome();
  updateProgressBar();
  restoreScroll(ratio);
  if (opts.flash) requestAnimationFrame(() => flashHighlight(opts.flash));
  if (opts.text) requestAnimationFrame(() => scrollToText(opts.text));
  queueProgress(next, ratio);
  if (next + 1 < total) getChapter(R.id, next + 1).catch(() => {});
  if (next > 0) getChapter(R.id, next - 1).catch(() => {});
}

function chapterTitle(index) {
  return R.meta && R.meta.chapters[index] ? R.meta.chapters[index].title : '';
}

function updateChapterChrome() {
  const total = R.meta.chapters.length;
  $('#rChapter').textContent = `${chapterTitle(R.ch)} · ${R.ch + 1} of ${total}`;
  $('#rPrev').disabled = R.ch <= 0;
  $('#rNext').disabled = R.ch >= total - 1;
  $('#rFoot').innerHTML = `
    <button class="prev" data-go="-1" ${R.ch <= 0 ? 'disabled' : ''}><svg><use href="#i-back"/></svg>Previous</button>
    <span>~${Math.max(1, Math.ceil(R.words / WPM))} min in this chapter</span>
    <button class="next" data-go="1" ${R.ch >= total - 1 ? 'disabled' : ''}>Next<svg><use href="#i-back"/></svg></button>`;
  $$('#tocList .toc-item').forEach((btn, i) => btn.classList.toggle('on', i === R.ch));
  updateBookmarkBtn();
}
function updateProgressBar() {
  if (!R.meta) return;
  const total = R.meta.chapters.length;
  const ratio = currentRatio();
  const overall = clamp((R.ch + ratio) / total, 0, 1);
  $('#rProgFill').style.width = (overall * 100).toFixed(2) + '%';
  $('#rPos').textContent = Math.round(overall * 100) + '% · chapter ' + (R.ch + 1) + ' of ' + total;
  $('#rTime').textContent = fmtDur((R.meta.words || 0) * (1 - overall) / WPM) + ' left in book';
}
function goChapter(delta) {
  const target = R.ch + delta;
  if (target < 0 || target >= R.meta.chapters.length) return;
  loadChapter(target);
}

function queueProgress(chapter, ratio) {
  if (!R.id) return;
  R.prog.ch = chapter;
  R.prog.ratio = ratio;
  R.prog.scroll = R.prog.scroll || {};
  R.prog.scroll[String(chapter)] = ratio;
  R.prog.updated = Date.now() / 1000;
  if (ratio >= 0.97) {
    R.prog.read = R.prog.read || [];
    if (!R.prog.read.includes(chapter)) R.prog.read.push(chapter);
  }
  const book = S.books.find((b) => b.id === R.id);
  if (book) book.progress = { ...R.prog, scroll: { ...R.prog.scroll } };
  clearTimeout(progressTimer);
  progressTimer = setTimeout(flushProgress, 600);
}
function flushProgress() {
  clearTimeout(progressTimer);
  progressTimer = null;
  if (!R.id) return;
  const payload = { book: R.id, ch: R.prog.ch, ratio: R.prog.ratio, scroll: R.prog.scroll || {} };
  postJSON('/api/progress', payload).catch(() => {});
}

function closeReader() {
  if (!isOpen) return;
  chapterToken++;
  if (R.ready) queueProgress(R.ch, currentRatio());
  flushProgress();
  isOpen = false;
  R.ready = false;
  $('#reader').hidden = true;
  closePanels();
  closeLightbox();
  hideSelBar();
  hideHighlightPop();
  document.title = "Yolala's LN Reader";
  updateCounts();
  renderLibrary();
  renderHighlights();
  R.id = null; R.meta = null;
}

/* ------------------------------------------------------------------- toc -- */
function buildToc() {
  const list = $('#tocList');
  const read = new Set(R.prog.read || []);
  const marks = R.bm.slice().sort((a, b) => a.ch - b.ch);
  let html = '';
  if (marks.length) {
    html += '<div class="toc-sub">Bookmarks</div>' + marks.map((b) => `
      <button class="toc-bm" data-ch="${b.ch}" title="${esc(b.name)}">
        <svg><use href="#i-bookmark"/></svg><span>${esc(b.name)}</span>
      </button>`).join('');
  }
  html += '<div class="toc-sub">Chapters</div>';
  html += R.meta.chapters.map((c, i) => `
    <button class="toc-item${i === R.ch ? ' on' : ''}" data-ch="${i}">
      <span class="num">${i + 1}</span>
      <span class="t">${esc(c.title)}</span>
      ${read.has(i) ? '<svg class="tick"><use href="#i-check"/></svg>' : ''}
    </button>`).join('');
  list.innerHTML = html;
  filterToc($('#tocFilter').value);
}
function filterToc(query) {
  const needle = query.trim().toLowerCase();
  $$('#tocList .toc-item').forEach((btn) => {
    btn.hidden = !!needle && !btn.textContent.toLowerCase().includes(needle);
  });
}

/* --------------------------------------------------------- bookmark state -- */
function updateBookmarkBtn() {
  const on = !!R.bm.find((b) => b.ch === R.ch);
  $('#rBookmark').classList.toggle('on', on);
  $('#rBookmark').title = on ? 'Remove bookmark (B)' : 'Bookmark this chapter (B)';
}
function toggleBookmark() {
  if (!R.meta) return;
  const existing = R.bm.find((b) => b.ch === R.ch);
  if (existing) {
    R.bm = R.bm.filter((b) => b !== existing);
    toast('Bookmark removed');
  } else {
    R.bm.push({
      id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      book: R.id, ch: R.ch, name: chapterTitle(R.ch), created: Math.floor(Date.now() / 1000),
    });
    toast('Chapter bookmarked');
  }
  postJSON('/api/bookmarks', { book: R.id, list: R.bm }).catch(() => {});
  S.bookmarks = S.bookmarks.filter((b) => b.book !== R.id).concat(R.bm);
  updateBookmarkBtn();
  buildToc();
}

/* ------------------------------------------------------------ highlighting -- */
function clearMarks(root) {
  $$('mark.hl, mark.hit', root).forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
  });
  root.normalize();
}
function paintHighlights() {
  const body = $('#rBody');
  if (!body) return;
  clearMarks(body);
  const list = R.hl.filter((h) => h.ch === R.ch);
  if (!list.length) return;
  const text = body.textContent;
  const anchored = [];
  for (const h of list) {
    let start = h.start, end = h.end;
    if (text.slice(start, end) !== h.quote) {
      let best = -1, bestDist = Infinity, from = 0, guard = 0;
      while (guard++ < 300) {
        const at = text.indexOf(h.quote, from);
        if (at < 0) break;
        const dist = Math.abs(at - start);
        if (dist < bestDist) { bestDist = dist; best = at; }
        from = at + 1;
      }
      if (best < 0) continue;
      start = best; end = best + h.quote.length;
    }
    if (end > start) anchored.push({ ...h, start, end });
  }
  if (!anchored.length) return;
  // Merge overlapping ranges so marks never nest; the first highlight keeps its colour.
  anchored.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const h of anchored) {
    const last = merged[merged.length - 1];
    if (last && h.start <= last.end) last.end = Math.max(last.end, h.end);
    else merged.push({ ...h });
  }
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let pos = 0, node;
  while ((node = walker.nextNode())) {
    const len = node.data.length;
    nodes.push([node, pos, pos + len]);
    pos += len;
  }
  for (const [textNode, start0, end0] of nodes) {
    const segs = merged
      .filter((h) => h.start < end0 && h.end > start0)
      .map((h) => [Math.max(h.start, start0) - start0, Math.min(h.end, end0) - start0, h])
      .sort((a, b) => b[0] - a[0]);
    for (const [a, b, h] of segs) {
      const limit = textNode.data.length;
      const from = clamp(a, 0, limit), to = clamp(b, 0, limit);
      if (from >= to || !textNode.parentNode) continue;
      const range = document.createRange();
      range.setStart(textNode, from);
      range.setEnd(textNode, to);
      const mark = document.createElement('mark');
      mark.className = 'hl';
      mark.dataset.color = h.color;
      mark.dataset.hid = h.id;
      if (h.note) mark.title = h.note;
      try { range.surroundContents(mark); } catch (_) { /* node boundary */ }
    }
  }
}
function rangeOffsets(range) {
  const body = $('#rBody');
  const pre = range.cloneRange();
  pre.selectNodeContents(body);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  pre.setEnd(range.endContainer, range.endOffset);
  const end = pre.toString().length;
  return { start, end, quote: body.textContent.slice(start, end) };
}
function captureSelection() {
  if (!isOpen) return;
  const sel = window.getSelection();
  const body = $('#rBody');
  if (!sel || sel.isCollapsed || !sel.rangeCount) return hideSelBar();
  const range = sel.getRangeAt(0);
  if (!body.contains(range.commonAncestorContainer)) return hideSelBar();
  if (range.collapsed) return hideSelBar();
  let info;
  try { info = rangeOffsets(range); } catch (_) { return hideSelBar(); }
  if (!info.quote.trim()) return hideSelBar();
  pendingSel = { ...info, ch: R.ch };
  showSelBar(range);
}
function showSelBar(range) {
  const bar = $('#selBar');
  bar.hidden = false;
  const rect = range.getBoundingClientRect();
  const w = bar.offsetWidth || 250;
  const left = clamp(rect.left + rect.width / 2 - w / 2, 12, innerWidth - w - 12);
  let top = rect.top - bar.offsetHeight - 10;
  if (top < 64) top = Math.min(innerHeight - 60, rect.bottom + 10);
  bar.style.left = left + 'px';
  bar.style.top = top + 'px';
}
function hideSelBar() { pendingSel = null; $('#selBar').hidden = true; }

function addHighlight(color) {
  if (!pendingSel) return;
  const pick = pendingSel;
  const text = $('#rBody').textContent;
  const overlap = R.hl.find((h) => h.ch === pick.ch && h.start < pick.end && h.end > pick.start);
  if (overlap) {
    overlap.start = Math.min(overlap.start, pick.start);
    overlap.end = Math.max(overlap.end, pick.end);
    overlap.quote = text.slice(overlap.start, overlap.end);
    overlap.color = color;
    R.hl = R.hl.map((h) => (h.id === overlap.id ? overlap : h));
    hideSelBar();
    paintHighlights();
    saveHighlights();
    toast('Highlight updated');
    return;
  }
  const h = {
    id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    book: R.id, ch: pick.ch, start: pick.start, end: pick.end,
    quote: pick.quote, color, note: '', created: Math.floor(Date.now() / 1000),
  };
  R.hl.push(h);
  if (h.ch === R.ch) paintHighlights();
  hideSelBar();
  const sel = window.getSelection();
  if (sel) sel.removeAllRanges();
  saveHighlights();
  toast('Highlight saved', { action: { label: 'Add note', fn: () => setTimeout(() => openHighlightPop(h.id), 40) } });
}
function saveHighlights() {
  if (!R.id) return;
  S.highlights = S.highlights.filter((x) => x.book !== R.id).concat(R.hl);
  S.stats.highlights = S.highlights.length;
  updateCounts();
  renderHighlightFilters();
  postJSON('/api/highlights', { book: R.id, list: R.hl }).catch(() => toast('Could not save highlight'));
}
function openHighlightPop(id) {
  const h = highlightById(id) || R.hl.find((x) => x.id === id);
  if (!h) return;
  const mark = $(`#rBody mark.hl[data-hid="${id}"]`);
  const pop = $('#hlPop');
  pop.dataset.hid = id;
  $('#popNote').value = h.note || '';
  $('#popColors').innerHTML = COLORS.map((c) =>
    `<button class="sw${c.id === h.color ? ' on' : ''}" data-c="${c.id}" title="${c.name}"></button>`).join('');
  pop.hidden = false;
  const rect = mark ? mark.getBoundingClientRect() : { left: innerWidth / 2 - 125, top: innerHeight / 2, width: 0, bottom: innerHeight / 2 };
  const w = 250;
  pop.style.left = clamp(rect.left + rect.width / 2 - w / 2, 12, innerWidth - w - 12) + 'px';
  let top = rect.top - pop.offsetHeight - 10;
  if (top < 60) top = Math.min(innerHeight - pop.offsetHeight - 12, rect.bottom + 10);
  pop.style.top = Math.max(56, top) + 'px';
  $('#popNote').focus({ preventScroll: true });
}
function hideHighlightPop() { $('#hlPop').hidden = true; $('#hlPop').dataset.hid = ''; }
function updateHighlight(id, patch) {
  const h = R.hl.find((x) => x.id === id) || S.highlights.find((x) => x.id === id);
  if (!h) return;
  Object.assign(h, patch);
  saveHighlights();
}
function flashHighlight(id) {
  const mark = $(`#rBody mark.hl[data-hid="${id}"]`);
  if (!mark) return;
  mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
  mark.classList.add('flash');
  setTimeout(() => mark.classList.remove('flash'), 1700);
}
function scrollToText(query) {
  const body = $('#rBody');
  const text = body.textContent;
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return;
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let pos = 0, node, startNode = null, startOff = 0, endNode = null, endOff = 0;
  while ((node = walker.nextNode())) {
    const len = node.data.length;
    if (!startNode && at < pos + len) { startNode = node; startOff = at - pos; }
    if (startNode && at + query.length <= pos + len) { endNode = node; endOff = at + query.length - pos; break; }
    pos += len;
  }
  if (!startNode) return;
  const range = document.createRange();
  range.setStart(startNode, startOff);
  range.setEnd(endNode || startNode, endNode ? endOff : startOff + query.length);
  const mark = document.createElement('mark');
  mark.className = 'hit';
  try {
    range.surroundContents(mark);
    mark.scrollIntoView({ block: 'center' });
    setTimeout(() => {
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      body.normalize();
    }, 2600);
  } catch (_) { /* ignore */ }
}

/* ----------------------------------------------------------------- lightbox -- */
const LB = { items: [], index: 0 };

function assetInfo(src) {
  const prefix = '/api/asset/';
  const at = src.indexOf(prefix);
  if (at < 0) return null;
  const rest = src.slice(at + prefix.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  return { book: rest.slice(0, slash), path: decodeURIComponent(rest.slice(slash + 1)) };
}
function imageName(path) {
  const parts = String(path || '').split('/');
  return parts[parts.length - 1] || 'image';
}
function openLightbox(img) {
  const images = $$('#rBody img').filter((node) => node.getAttribute('src'));
  const at = images.indexOf(img);
  if (at < 0) return;
  LB.items = images.map((node) => {
    const src = node.getAttribute('src');
    return { src, ...(assetInfo(src) || {}) };
  });
  LB.index = at;
  $('#lightbox').hidden = false;
  showLightboxImage();
}
function showLightboxImage() {
  const item = LB.items[LB.index];
  if (!item) return;
  $('#lbImg').src = item.src;
  const many = LB.items.length > 1;
  const title = chapterTitle(R.ch);
  $('#lbName').textContent = many ? title + ' · image ' + (LB.index + 1) + ' of ' + LB.items.length : title;
  $('#lbName').title = item.path || '';
  $('#lbPrev').disabled = !many;
  $('#lbNext').disabled = !many;
}
function stepLightbox(delta) {
  if (LB.items.length < 2) return;
  LB.index = (LB.index + delta + LB.items.length) % LB.items.length;
  showLightboxImage();
}
function closeLightbox() {
  if ($('#lightbox').hidden) return;
  $('#lightbox').hidden = true;
  $('#lbImg').removeAttribute('src');
}
async function saveLightboxImage() {
  const item = LB.items[LB.index];
  if (!item) return;
  if (!item.path) { toast('This image cannot be saved'); return; }
  const dot = item.path.lastIndexOf('.');
  const ext = dot > 0 ? item.path.slice(dot) : '.jpg';
  const title = R.meta ? R.meta.title : "Yolala's LN Reader";
  const name = title + ' - ' + chapterTitle(R.ch) + ' - image ' + (LB.index + 1) + ext;
  try {
    const result = await postJSON('/api/save-image', { book: item.book, path: item.path, name });
    if (result.saved) {
      const full = String(result.path);
      const cut = Math.max(full.lastIndexOf('/'), full.lastIndexOf(String.fromCharCode(92)));
      toast('Image saved · ' + full.slice(cut + 1));
    } else {
      toast('Save cancelled');
    }
  } catch (err) {
    const link = document.createElement('a');
    link.href = item.src;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast('Saving through the browser instead');
  }
}

/* -------------------------------------------------------------- find panel -- */
let findTimer = null;
let findColor = '';
function renderFindHighlights() {
  if (!R.id) return;
  const items = S.highlights.filter((h) => h.book === R.id);
  const colors = COLORS.filter((c) => items.some((h) => h.color === c.id));
  const chips = $('#findColors');
  $('#findSub').hidden = !items.length;
  chips.hidden = !items.length;
  if (items.length) {
    chips.innerHTML = `<button class="chip${findColor ? '' : ' on'}" data-color="">All<span class="n">${items.length}</span></button>` +
      colors.map((c) => `<button class="chip${findColor === c.id ? ' on' : ''}" data-color="${c.id}">
        <i style="background:${c.hex}"></i>${c.name}<span class="n">${items.filter((h) => h.color === c.id).length}</span></button>`).join('');
  }
  const list = items.filter((h) => !findColor || h.color === findColor).sort((a, b) => a.ch - b.ch || a.start - b.start);
  $('#findList').innerHTML = list.length ? list.map((h) => {
    const color = (COLORS.find((c) => c.id === h.color) || COLORS[0]).hex;
    const quote = h.quote.length > 160 ? h.quote.slice(0, 160) + '…' : h.quote;
    return `<button class="find-hit" data-hid="${esc(h.id)}">
      <span class="fh"><i class="fdot" style="background:${color}"></i><b>${esc(chapterTitle(h.ch))}</b><span>ch. ${h.ch + 1}</span></span>
      <span class="fs">${esc(quote)}</span>
      ${h.note ? `<span class="fnote">${esc(h.note)}</span>` : ''}
    </button>`;
  }).join('') : `<div class="find-note">${items.length ? 'No highlights in this colour.' : 'No highlights in this book yet. Select text while reading to add one.'}</div>`;
}
async function findInBook() {
  const input = $('#findInput');
  const query = input.value.trim();
  const list = $('#findList');
  if (!query) { renderFindHighlights(); return; }
  if (query.length < 2) {
    $('#findSub').hidden = true;
    $('#findColors').hidden = true;
    list.innerHTML = '<div class="find-note">Type at least two characters.</div>';
    return;
  }
  $('#findSub').hidden = true;
  $('#findColors').hidden = true;
  list.innerHTML = '<div class="find-note">Searching…</div>';
  try {
    const data = await getJSON(`/api/book/${R.id}/search?q=${encodeURIComponent(query)}`);
    if (!data.hits.length) {
      list.innerHTML = `<div class="find-note">No matches for “${esc(query)}”.</div>`;
      return;
    }
    list.innerHTML = data.hits.map((hit) => `
      <button class="find-hit" data-ch="${hit.chapter}">
        <span class="fh"><b>${esc(hit.title)}</b><span>ch. ${hit.chapter + 1}</span></span>
        <span class="fs">${markQuery(hit.snippet, query)}</span>
      </button>`).join('');
  } catch (err) {
    list.innerHTML = `<div class="find-note">Search failed: ${esc(err.message)}</div>`;
  }
}
function scheduleFind() {
  clearTimeout(findTimer);
  findTimer = setTimeout(findInBook, 320);
}

/* ----------------------------------------------------------------- panels -- */
const drawerTimers = new WeakMap();
function showDrawer(panel) {
  clearTimeout(drawerTimers.get(panel));
  panel.hidden = false;
  void panel.offsetWidth;
  panel.classList.add('open');
}
function hideDrawer(panel) {
  if (panel.hidden) return;
  panel.classList.remove('open');
  clearTimeout(drawerTimers.get(panel));
  drawerTimers.set(panel, setTimeout(() => { panel.hidden = true; }, 240));
}
function closePanels() {
  $$('.drawer').forEach(hideDrawer);
  $('#help').hidden = true;
}
function togglePanel(id) {
  const panel = $('#' + id);
  const wasOpen = !panel.hidden && panel.classList.contains('open');
  closePanels();
  if (wasOpen) return;
  showDrawer(panel);
  if (id === 'dToc') { $('#tocFilter').value = ''; filterToc(''); }
  if (id === 'dFind') {
    setTimeout(() => $('#findInput').focus(), 30);
    if ($('#findInput').value.trim()) findInBook(); else renderFindHighlights();
  }
}

/* ------------------------------------------------------------------ import -- */
async function importBooks(files) {
  const books = Array.from(files).filter((f) => /\.epub$/i.test(f.name));
  if (!books.length) return toast('Choose EPUB files to add');
  toast(`Adding ${books.length} book${books.length === 1 ? '' : 's'}…`, { timeout: 60000 });
  let added = 0, failed = 0;
  for (const file of books) {
    try {
      await api('/api/import?name=' + encodeURIComponent(file.name), {
        method: 'POST', headers: { 'Content-Type': 'application/epub+zip' }, body: file,
      });
      added++;
    } catch (err) {
      failed++;
      console.error(file.name, err);
    }
  }
  await loadLibrary();
  toast(`${added} book${added === 1 ? '' : 's'} added${failed ? ` · ${failed} failed` : ''}`, { timeout: 5200 });
}
async function backupLibrary() {
  try {
    const result = await postJSON('/api/backup', {});
    toast(`Backup saved · ${result.name}`, {
      timeout: 9000,
      action: { label: 'Show file', fn: () => postJSON('/api/reveal', { path: result.path }).catch(() => {}) },
    });
  } catch (err) {
    toast('Backup failed: ' + err.message);
  }
}
async function restoreBackup(file) {
  if (!file) return;
  toast('Restoring backup…', { timeout: 60000 });
  try {
    const result = await api('/api/import-backup', {
      method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: file,
    });
    await loadLibrary();
    toast(`Restored ${result.imported} book${result.imported === 1 ? '' : 's'} and your reading history`);
  } catch (err) {
    toast('Restore failed: ' + err.message);
  }
}

/* ------------------------------------------------------------------ events -- */
function bindUI() {
  $('#nav').addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-btn');
    if (btn) setView(btn.dataset.view);
  });

  $('#btnAdd').onclick = () => $('#fileEpub').click();
  $('#btnAdd2').onclick = () => $('#fileEpub').click();
  $('#fileEpub').onchange = (e) => { importBooks(e.target.files); e.target.value = ''; };
  $('#btnBackup').onclick = backupLibrary;
  $('#btnRestore').onclick = () => $('#fileBackup').click();
  $('#fileBackup').onchange = (e) => { restoreBackup(e.target.files[0]); e.target.value = ''; };
  $('#btnShortcuts').onclick = () => { closePanels(); $('#help').hidden = false; };

  $('#libSearch').addEventListener('input', renderLibrary);
  $('#libSort').addEventListener('change', () => {
    localStorage.setItem('ln.sort', $('#libSort').value);
    renderLibrary();
  });
  $('#grid').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      const book = S.books.find((b) => b.id === del.dataset.del);
      if (book) confirmDelete(book);
      return;
    }
    const card = e.target.closest('.card');
    if (card) openBook(card.dataset.id);
  });
  $('#grid').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.card');
    if (card) { e.preventDefault(); openBook(card.dataset.id); }
  });
  $('#continueWrap').addEventListener('click', (e) => {
    const node = e.target.closest('[data-id]');
    if (node) openBook(node.dataset.id);
  });

  $('#hlSearch').addEventListener('input', renderHighlights);
  $('#hlBook').addEventListener('change', () => { renderHighlightFilters(); renderHighlights(); });
  $('#hlColors').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    hlColorFilter = chip.dataset.color;
    renderHighlightFilters();
    renderHighlights();
  });
  $('#hlList').addEventListener('click', (e) => {
    const row = e.target.closest('.hl-row');
    if (!row) return;
    const h = highlightById(row.dataset.hid);
    if (!h) return;
    if (e.target.closest('[data-act="copy"]')) { copyText(h.quote); return; }
    if (e.target.closest('[data-act="delete"]')) { deleteHighlight(h); return; }
    const selection = window.getSelection();
    if (e.target.closest('[data-open]') && (!selection || selection.isCollapsed)) openBook(h.book, h.ch, { flash: h.id });
  });

  // reader chrome
  const setSide = (hidden) => {
    $('.app').classList.toggle('side-collapsed', hidden);
    $('#sideOpen').hidden = !hidden;
    localStorage.setItem('ln.side', hidden ? '1' : '0');
  };
  $('#sideHide').onclick = () => setSide(true);
  $('#sideOpen').onclick = () => setSide(false);
  if (localStorage.getItem('ln.side') === '1') setSide(true);

  $('#rBack').onclick = closeReader;
  $('#rPrev').onclick = () => goChapter(-1);
  $('#rNext').onclick = () => goChapter(1);
  $('#rChapterBtn').onclick = () => togglePanel('dToc');
  $('#rFind').onclick = () => togglePanel('dFind');
  $('#rSettings').onclick = () => togglePanel('dSet');
  $('#rBookmark').onclick = toggleBookmark;
  $('#rTheme').onclick = toggleSepia;
  $('#btnSepia').onclick = toggleSepia;
  $('#lbClose').onclick = closeLightbox;
  $('#lbSave').onclick = saveLightboxImage;
  $('#lbPrev').onclick = () => stepLightbox(-1);
  $('#lbNext').onclick = () => stepLightbox(1);
  $('#lbStage').addEventListener('click', (e) => { if (e.target.id === 'lbStage') closeLightbox(); });
  $('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') closeLightbox(); });
  $('#rFoot').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-go]');
    if (btn) goChapter(Number(btn.dataset.go));
  });

  $('#tocList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ch]');
    if (!btn) return;
    closePanels();
    loadChapter(Number(btn.dataset.ch));
  });
  $('#tocFilter').addEventListener('input', (e) => filterToc(e.target.value));

  $('#findInput').addEventListener('input', (e) => {
    if (e.target.value.trim()) scheduleFind(); else renderFindHighlights();
  });
  $('#findColors').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    findColor = chip.dataset.color;
    renderFindHighlights();
  });
  $('#findInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); findInBook(); }
  });
  $('#findList').addEventListener('click', (e) => {
    const hit = e.target.closest('.find-hit');
    if (!hit) return;
    if (hit.dataset.hid) {
      const h = highlightById(hit.dataset.hid);
      if (!h) return;
      closePanels();
      if (h.ch === R.ch) flashHighlight(h.id);
      else loadChapter(h.ch, { flash: h.id });
      return;
    }
    closePanels();
    loadChapter(Number(hit.dataset.ch), { text: $('#findInput').value.trim() });
  });

  $$('[data-close]').forEach((btn) => btn.addEventListener('click', () => {
    const box = btn.closest('.drawer, .modal');
    if (box.classList.contains('drawer')) hideDrawer(box); else box.hidden = true;
  }));
  $('#help').addEventListener('click', (e) => { if (e.target.id === 'help') $('#help').hidden = true; });

  // reading settings
  $('#fontSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-font]');
    if (btn) updateSetting('font', btn.dataset.font);
  });
  $('#setSize').addEventListener('input', (e) => updateSetting('size', Number(e.target.value)));
  $('#setLh').addEventListener('input', (e) => updateSetting('lh', Number(e.target.value)));
  $('#setWidth').addEventListener('input', (e) => updateSetting('width', Number(e.target.value)));
  $('#setJustify').addEventListener('change', (e) => updateSetting('justify', e.target.checked, false));
  $('#setReset').onclick = () => { S.settings = { ...DEFAULTS }; applySettings(); requestAnimationFrame(() => restoreScroll(currentRatio())); };

  // selection + highlights
  $('#selColors').innerHTML = COLORS.map((c) => `<button class="sw" data-c="${c.id}" title="${c.name}"></button>`).join('');
  $('#selColors').addEventListener('mousedown', (e) => e.preventDefault());
  $('#selColors').addEventListener('click', (e) => {
    const btn = e.target.closest('.sw');
    if (!btn) return;
    addHighlight(btn.dataset.c);
    // keep the toolbar in place if the user wants another colour
    if (pendingSel) { /* nothing */ }
  });
  $('#selCopy').addEventListener('mousedown', (e) => e.preventDefault());
  $('#selCopy').onclick = () => {
    if (!pendingSel) return;
    copyText(pendingSel.quote);
    hideSelBar();
  };
  document.addEventListener('mousedown', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target || !target.closest('#selBar, #hlPop')) hideSelBar();
    if (!target || !target.closest('#hlPop')) hideHighlightPop();
    if (target && !target.closest('.drawer, .modal, #rFind, #rChapterBtn, #rSettings') && $$('.drawer').some((d) => !d.hidden)) closePanels();
  });
  document.addEventListener('mouseup', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (target && target.closest('#selBar, #hlPop, .drawer, .modal, .rbar, .rfoot, .rnav')) return;
    setTimeout(captureSelection, 0);
  });
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if ((!sel || sel.isCollapsed) && !$('#selBar').hidden) hideSelBar();
  });
  $('#rBody').addEventListener('click', (e) => {
    const link = e.target.closest('a[data-ch]');
    if (link) {
      e.preventDefault();
      const target = Number(link.dataset.ch);
      if (Number.isInteger(target)) loadChapter(target);
      return;
    }
    const mark = e.target.closest('mark.hl');
    if (mark) { e.stopPropagation(); openHighlightPop(mark.dataset.hid); return; }
    const image = e.target.closest('img');
    if (image) { e.preventDefault(); openLightbox(image); }
  });
  $('#popColors').addEventListener('mousedown', (e) => e.preventDefault());
  $('#popColors').addEventListener('click', (e) => {
    const btn = e.target.closest('.sw');
    if (!btn) return;
    const id = $('#hlPop').dataset.hid;
    updateHighlight(id, { color: btn.dataset.c });
    paintHighlights();
    $$('#popColors .sw').forEach((s) => s.classList.toggle('on', s === btn));
  });
  $('#popNote').addEventListener('input', () => {
    clearTimeout(openHighlightPop.timer);
    openHighlightPop.timer = setTimeout(() => {
      const id = $('#hlPop').dataset.hid;
      if (!id) return;
      updateHighlight(id, { note: $('#popNote').value });
      const mark = $(`#rBody mark.hl[data-hid="${id}"]`);
      if (mark) mark.title = $('#popNote').value;
    }, 350);
  });
  $('#hlPop').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const h = (R.hl.find((x) => x.id === $('#hlPop').dataset.hid)) || highlightById($('#hlPop').dataset.hid);
    if (!h) return;
    if (act === 'copy') copyText(h.quote);
    if (act === 'del') {
      hideHighlightPop();
      const bookId = h.book;
      R.hl = R.hl.filter((x) => x.id !== h.id);
      if (bookId) deleteHighlight({ ...h, book: bookId });
      paintHighlights();
    }
  });

  // scroll + navigation
  $('#rScroll').addEventListener('scroll', () => {
    if (!isOpen || !R.ready) return;
    updateProgressBar();
    if (scrollLocked) return;
    if (R.scrollFrame) return;
    R.scrollFrame = requestAnimationFrame(() => {
      R.scrollFrame = null;
      queueProgress(R.ch, currentRatio());
    });
  }, { passive: true });
  $('#rScroll').addEventListener('wheel', () => { scrollLocked = true; }, { passive: true });
  $('#rScroll').addEventListener('touchmove', () => { scrollLocked = true; }, { passive: true });

  // drag & drop
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    dragDepth++;
    $('#dropzone').hidden = false;
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $('#dropzone').hidden = true;
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('#dropzone').hidden = true;
    const files = Array.from(e.dataTransfer?.files || []);
    const zip = files.find((f) => /\.zip$/i.test(f.name));
    if (zip && files.length === 1) restoreBackup(zip);
    else importBooks(files);
  });

  document.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', () => {
    if (!isOpen || !R.id) return;
    try {
      navigator.sendBeacon('/api/progress', new Blob([JSON.stringify({ book: R.id, ch: R.ch, ratio: currentRatio() })], { type: 'application/json' }));
    } catch (_) { /* ignore */ }
  });
}

function onKey(e) {
  if (!$('#lightbox').hidden) {
    if (e.key === 'Escape') { closeLightbox(); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepLightbox(-1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); stepLightbox(1); return; }
    return;
  }
  const tag = e.target.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
  if (e.key === 'Escape') {
    if (!$('#help').hidden) { $('#help').hidden = true; return; }
    if (!$('#hlPop').hidden) { hideHighlightPop(); return; }
    if (!$('#selBar').hidden) { hideSelBar(); return; }
    const openDrawer = $$('.drawer').find((d) => !d.hidden);
    if (openDrawer) { hideDrawer(openDrawer); return; }
    if (typing) { e.target.blur(); return; }
    if (isOpen) closeReader();
    return;
  }
  if (typing) {
    if (isOpen && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      togglePanel('dFind');
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    backupLibrary();
    return;
  }
  if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    toggleSepia();
    return;
  }
  if (!isOpen) {
    if (e.key === '?') { closePanels(); $('#help').hidden = false; }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); togglePanel('dFind'); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); goChapter(-1); return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); goChapter(1); return; }
  if (e.key === 't' || e.key === 'T') { togglePanel('dToc'); return; }
  if ((e.key === 'b' || e.key === 'B') && !e.ctrlKey && !e.metaKey) { toggleBookmark(); return; }
  if (e.key === '?' ) { closePanels(); $('#help').hidden = false; return; }
  if (e.key === '+' || e.key === '=') { updateSetting('size', clamp(S.settings.size + 1, 15, 27)); return; }
  if (e.key === '-' || e.key === '_') { updateSetting('size', clamp(S.settings.size - 1, 15, 27)); return; }
}

/* -------------------------------------------------------------------- boot -- */
function heartbeat() {
  fetch('/api/ping').catch(() => {});
  setInterval(() => fetch('/api/ping').catch(() => {}), 30000);
}

async function init() {
  renderThemes();
  bindUI();
  const sort = localStorage.getItem('ln.sort');
  if (sort) $('#libSort').value = sort;
  try {
    await loadLibrary();
  } catch (err) {
    toast('Could not reach the library: ' + err.message, { timeout: 8000 });
  }
  heartbeat();
}

init();
