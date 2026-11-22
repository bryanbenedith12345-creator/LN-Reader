/* Yolala's LN Reader - find panel, drawers and import/backup actions.
   Classic script: loaded in order from index.html; shared globals. */
'use strict';

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
  if (id === 'dTts') { ttsLoadVoices(); ttsSyncUI(); }
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
