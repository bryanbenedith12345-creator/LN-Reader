/* Yolala's LN Reader - shelves: favorites, named collections, drag and drop. */
'use strict';

let shelf = 'all';
let selectMode = false;
const picked = new Set();

function shelfName(id = shelf) {
  if (id === 'favorites') return 'Favorites';
  if (id === 'all') return 'Library';
  const found = S.collections.find((c) => c.id === id);
  return found ? found.name : 'Library';
}

function shelfIds(id = shelf) {
  if (id === 'all') return null;
  if (id === 'favorites') return new Set(S.favorites);
  return new Set(S.collectionBooks[id] || []);
}

function shelfCount(id) {
  if (id === 'all') return S.books.length;
  if (id === 'favorites') return S.favorites.length;
  return (S.collectionBooks[id] || []).length;
}

function renderShelves() {
  const list = $('#shelfList');
  if (!list) return;
  const row = (id, icon, name, count, tools = '') => `
    <div class="shelf-row${shelf === id ? ' is-active' : ''}" data-shelf="${esc(id)}">
      <button class="shelf-main"><svg><use href="${icon}"/></svg><span class="shelf-name">${esc(name)}</span><em>${count}</em></button>
      ${tools}
    </div>`;
  const select = $('#libShelf');
  if (select) {
    select.innerHTML = '<option value="all">All books</option><option value="favorites">Favorites</option>' +
      S.collections.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    select.value = shelf;
  }
  list.innerHTML =
    row('all', '#i-library', 'All books', S.books.length) +
    row('favorites', '#i-heart', 'Favorites', S.favorites.length) +
    '<div class="shelves-scroll">' +
    S.collections.map((c) => row(c.id, '#i-folder', c.name, shelfCount(c.id), `
      <div class="shelf-tools">
        <button data-rename="${esc(c.id)}" title="Rename shelf" aria-label="Rename ${esc(c.name)}"><svg><use href="#i-mark"/></svg></button>
        <button class="danger" data-drop="${esc(c.id)}" title="Delete shelf" aria-label="Delete ${esc(c.name)}"><svg><use href="#i-trash"/></svg></button>
      </div>`)).join('') +
    '</div>';
}

function setShelf(id) {
  shelf = id;
  picked.clear();
  if (selectMode) setSelectMode(false);
  if (view !== 'library') setView('library');
  const search = $('#libSearch');
  if (search) search.value = '';
  renderShelves();
  renderLibrary();
}

async function createShelf(name, opts = {}) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  try {
    const res = await postJSON('/api/shelves', { action: 'create', name: clean });
    const record = res.shelf;
    S.collections.push(record);
    S.collectionBooks[record.id] = [];
    renderShelves();
    if (!opts.quiet) toast(`Shelf “${record.name}” created`);
    if (opts.open) setShelf(record.id);
    return record;
  } catch (err) {
    toast(err.message);
    return null;
  }
}

async function renameShelf(shelfId, name) {
  const clean = String(name || '').trim();
  if (!clean) return;
  try {
    const res = await postJSON('/api/shelves', { action: 'rename', id: shelfId, name: clean });
    const found = S.collections.find((c) => c.id === shelfId);
    if (found) found.name = res.shelf.name;
    renderShelves();
    if (shelf === shelfId) renderLibrary();
    toast('Shelf renamed');
  } catch (err) {
    toast(err.message);
  }
}

function confirmShelfDelete(shelfId) {
  const found = S.collections.find((c) => c.id === shelfId);
  if (!found) return;
  const count = shelfCount(shelfId);
  toast(`Delete “${found.name}”${count ? ` and its ${count} book${count === 1 ? '' : 's'}` : ''}?`, {
    timeout: 9000,
    action: {
      label: 'Delete', danger: true, fn: async () => {
        try {
          await postJSON('/api/shelves', { action: 'delete', id: shelfId });
          S.collections = S.collections.filter((c) => c.id !== shelfId);
          delete S.collectionBooks[shelfId];
          if (shelf === shelfId) shelf = 'all';
          renderShelves();
          renderLibrary();
          updateCounts();
          toast('Shelf deleted · books stay in your library');
        } catch (err) { toast('Could not delete that shelf: ' + err.message); }
      },
    },
  });
}

function askName(title, value = '', okLabel = 'Save') {
  return new Promise((resolve) => {
    const modal = $('#nameAsk');
    if (!modal) { resolve(null); return; }
    $('#nameAskTitle').textContent = title;
    $('#nameAskOk').textContent = okLabel;
    const input = $('#nameAskInput');
    input.value = value;
    showEl(modal);
    setTimeout(() => { input.focus(); input.select(); }, 30);

    const finish = (result) => {
      hideEl(modal, MOTION.fast);
      $('#nameAskOk').onclick = null;
      $('#nameAskCancel').onclick = null;
      input.onkeydown = null;
      modal.onmousedown = null;
      resolve(result);
    };
    const commit = () => finish(input.value.trim() || null);
    $('#nameAskOk').onclick = commit;
    $('#nameAskCancel').onclick = () => finish(null);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); finish(null); }
    };
    modal.onmousedown = (e) => { if (e.target === modal) finish(null); };
  });
}

async function newShelfDialog() {
  const name = await askName('New shelf', '', 'Create');
  if (name) await createShelf(name, { open: true });
}

async function renameShelfDialog(shelfId) {
  const found = S.collections.find((c) => c.id === shelfId);
  if (!found) return;
  const name = await askName('Rename shelf', found.name);
  if (name && name !== found.name) await renameShelf(shelfId, name);
}

function clearShelfDrop() {
  $$('#shelfList .shelf-row').forEach((r) => r.classList.remove('shelf-drop'));
}

function bindShelves() {
  $('#shelfList').addEventListener('click', (e) => {
    const rename = e.target.closest('[data-rename]');
    if (rename) { renameShelfDialog(rename.dataset.rename); return; }
    const kill = e.target.closest('[data-drop]');
    if (kill) { confirmShelfDelete(kill.dataset.drop); return; }
    const main = e.target.closest('.shelf-main');
    if (main) setShelf(main.closest('.shelf-row').dataset.shelf);
  });
  $('#btnNewShelf').onclick = newShelfDialog;
  $('#libShelf').onchange = (e) => setShelf(e.target.value);

  const list = $('#shelfList');
  list.addEventListener('dragover', (e) => {
    const row = e.target.closest('.shelf-row');
    if (!row || row.dataset.shelf === 'all') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    $$('.shelf-row', list).forEach((r) => r.classList.toggle('shelf-drop', r === row));
  });
  list.addEventListener('dragleave', (e) => {
    if (!list.contains(e.relatedTarget)) clearShelfDrop();
  });
  list.addEventListener('drop', (e) => {
    const row = e.target.closest('.shelf-row');
    clearShelfDrop();
    if (!row || row.dataset.shelf === 'all') return;
    e.preventDefault();
    let ids = [];
    try { ids = JSON.parse(e.dataTransfer.getData('text/plain') || '[]'); } catch (_) { ids = []; }
    if (ids.length) shelfAdd(row.dataset.shelf, ids);
  });

  const grid = $('#grid');
  grid.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const ids = picked.size && picked.has(card.dataset.id) ? [...picked] : [card.dataset.id];
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', JSON.stringify(ids));
    card.classList.add('is-dragging');
  });
  grid.addEventListener('dragend', (e) => {
    e.target.closest('.card')?.classList.remove('is-dragging');
    clearShelfDrop();
  });

  $('#infoShelves').addEventListener('click', async (e) => {
    const bookId = $('#bookInfo').dataset.book;
    if (!bookId) return;
    if (e.target.closest('[data-new-chip]')) {
      const name = await askName('New shelf', '', 'Create');
      if (!name) return;
      const record = await createShelf(name, { quiet: true });
      if (record) await shelfAdd(record.id, [bookId]);
      return;
    }
    const chip = e.target.closest('[data-shelf-chip]');
    if (!chip) return;
    if (chip.classList.contains('on')) shelfRemove(chip.dataset.shelfChip, [bookId]);
    else shelfAdd(chip.dataset.shelfChip, [bookId]);
  });
}
