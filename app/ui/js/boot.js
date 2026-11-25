/* Yolala's LN Reader - startup. */
'use strict';

const PARTIALS = ['partials/reader.html', 'partials/overlays.html'];

window.addEventListener('pywebviewready', syncTitlebar);
window.addEventListener('focus', () => { titlebarKey = ''; syncTitlebar(); });

function heartbeat() {
  fetch('/api/ping').catch(() => {});
  setInterval(() => fetch('/api/ping').catch(() => {}), 30000);
}

async function loadPartials() {
  const chunks = await Promise.all(PARTIALS.map(async (path) => {
    try {
      const res = await fetch(path);
      return res.ok ? await res.text() : '';
    } catch (_) { return ''; }
  }));
  for (const html of chunks) {
    if (html) document.body.insertAdjacentHTML('beforeend', html);
  }
}

async function init() {
  await loadPartials();
  try {
    renderThemes();
    bindUI();
    bindReaderUI();
    bindFileDrop();
  } catch (err) {
    console.error('interface setup failed', err);
    toast('Part of the interface could not load. Restart the app if things look wrong.', { timeout: 12000 });
  }
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
