/* Yolala's LN Reader - startup.
   Classic script: loaded in order from index.html; shared globals. */
'use strict';

/* -------------------------------------------------------------------- boot -- */
window.addEventListener('pywebviewready', syncTitlebar);
window.addEventListener('focus', () => { titlebarKey = ''; syncTitlebar(); });

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
  syncTitlebar();
  setTimeout(syncTitlebar, 400);
}

init();
