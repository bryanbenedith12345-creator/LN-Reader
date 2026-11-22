/* Yolala's LN Reader - reader settings, themes and sepia.
   Classic script: loaded in order from index.html; shared globals. */
'use strict';

/* ------------------------------------------------------------- settings -- */
let titlebarKey = '';
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
  syncTitlebar();
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
