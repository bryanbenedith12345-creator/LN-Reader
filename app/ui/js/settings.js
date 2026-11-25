/* Yolala's LN Reader - reading settings, per-book overrides and the titlebar. */
'use strict';

let titlebarKey = '';
let scope = 'global';          // 'global' or 'book'

function syncTitlebar() {
  const api = window.pywebview && window.pywebview.api;
  if (!api || typeof api.set_titlebar !== 'function') return;
  const style = getComputedStyle(document.documentElement);
  const bg = style.getPropertyValue('--bg').trim();
  const fg = style.getPropertyValue('--fg').trim();
  const key = bg + '|' + fg;
  if (key === titlebarKey) return;
  const match = /^#([0-9a-f]{6})$/i.exec(bg);
  let dark = true;
  if (match) {
    const n = parseInt(match[1], 16);
    dark = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) < 140;
  }
  titlebarKey = key;
  try {
    const pending = api.set_titlebar(bg, fg, dark);
    if (pending && pending.catch) pending.catch(() => { titlebarKey = ''; });
  } catch (_) { titlebarKey = ''; /* browser fallback has no pywebview bridge */ }
}

/* ----------------------------------------------------------- book scope -- */
function bookOverrides(bookId) {
  const book = S.books.find((b) => b.id === bookId);
  return (book && book.settings) || {};
}
function effectiveSettings() {
  if (scope === 'book' && R.id) return { ...S.settings, ...bookOverrides(R.id) };
  return { ...S.settings };
}
function hasBookScope() {
  return !!(R.id && Object.keys(bookOverrides(R.id)).length);
}

/* -------------------------------------------------------------- applying -- */
function applySettings(persist = true) {
  const s = effectiveSettings();
  const root = document.documentElement;
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
  const sort = $('#libSort');
  if (sort) sort.value = localStorage.getItem('ln.sort') || 'recent';
  syncSettingsControls(s);
  updateThemeButtons();
  syncTitlebar();
  if (persist) saveScope();
}

function syncSettingsControls(s) {
  const size = $('#setSize');
  if (!size) return;                      // settings drawer not mounted
  size.value = s.size; $('#outSize').textContent = s.size;
  $('#setLh').value = s.lh; $('#outLh').textContent = Number(s.lh).toFixed(2);
  $('#setWidth').value = s.width; $('#outWidth').textContent = s.width;
  $('#setJustify').checked = !!s.justify;
  $$('#fontSeg button').forEach((b) => b.classList.toggle('on', b.dataset.font === s.font));
  $$('.theme-tile').forEach((t) => t.classList.toggle('on', t.dataset.theme === s.theme));
  const scopeBtn = $('#setScope');
  if (scopeBtn) {
    scopeBtn.disabled = !R.id;
    scopeBtn.checked = scope === 'book';
    scopeBtn.closest('.set-row').hidden = !R.id;
  }
}

/* --------------------------------------------------------------- saving -- */
function saveScope() {
  if (scope === 'book' && R.id) {
    const book = S.books.find((b) => b.id === R.id);
    const merged = { ...S.settings, ...(book ? book.settings : {}) };
    if (book) book.settings = { ...merged };
    postJSON('/api/book-settings', { book: R.id, settings: merged }).catch(() => {});
  } else {
    clearTimeout(applySettings.timer);
    applySettings.timer = setTimeout(() => postJSON('/api/settings', S.settings).catch(() => {}), 500);
  }
}

function updateSetting(key, value, keepScroll = true) {
  const ratio = isOpen && R.ready ? currentRatio() : null;
  if (scope === 'book' && R.id) {
    const book = S.books.find((b) => b.id === R.id);
    if (book) book.settings = { ...effectiveSettings(), [key]: value };
  } else {
    S.settings[key] = value;
  }
  applySettings();
  if (ratio !== null && keepScroll) requestAnimationFrame(() => restoreScroll(ratio));
}

function toggleScope(on) {
  if (!R.id) return;
  scope = on ? 'book' : 'global';
  if (scope === 'book') {
    // start the override from what the reader sees right now
    const merged = { ...S.settings, ...bookOverrides(R.id) };
    const book = S.books.find((b) => b.id === R.id);
    if (book) book.settings = { ...merged };
  }
  applySettings();
}
