/* Yolala's LN Reader - colour themes, the theme grid and the sepia toggle. */
'use strict';

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
  { id: 'catppuccin-mocha', name: 'Catppuccin', bg: '#1e1e1e', panel: '#27273a', accent: '#89b4fa' },
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
const SEPIA = 'sepia';

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
  if (side) {
    side.title = on ? 'Sepia theme is on — click to go back (S)' : 'Switch to the sepia reading theme (S)';
    const label = side.querySelector('span');
    if (label) label.textContent = on ? 'Exit sepia' : 'Sepia theme';
  }
  const readerBtn = $('#rTheme');
  if (readerBtn) readerBtn.title = on ? 'Turn off sepia (S)' : 'Sepia theme (S)';
}

function renderThemes() {
  const grid = $('#themeGrid');
  if (!grid) return;
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
