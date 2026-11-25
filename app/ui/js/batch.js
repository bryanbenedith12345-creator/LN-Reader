/* Yolala's LN Reader - picking several books and moving them together. */
'use strict';

function setSelectMode(on) {
  selectMode = !!on;
  if (!selectMode) picked.clear();
  const btn = $('#btnSelect');
  if (btn) {
    btn.classList.toggle('is-on', selectMode);
    btn.textContent = selectMode ? 'Done' : 'Select';
    btn.title = selectMode ? 'Stop picking books' : 'Pick several books at once';
  }
  const bar = $('#batchBar');
  if (bar) { if (selectMode) showEl(bar); else hideEl(bar, MOTION.fast); }
  if ($('#grid')) $('#grid').classList.toggle('is-selecting', selectMode);
  if (!selectMode) closeBatchMenu();
  renderBatch();
  renderLibrary();
}

function togglePick(bookId) {
  if (picked.has(bookId)) picked.delete(bookId);
  else picked.add(bookId);
  renderBatch();
  renderLibrary();
}

function renderBatch() {
  const bar = $('#batchBar');
  if (!bar || bar.hidden) return;
  const count = picked.size;
  $('#batchCount').textContent = count ? `${count} selected` : 'None selected';
  ['#batchFav', '#batchShelf'].forEach((sel) => {
    const btn = $(sel);
    if (btn) btn.disabled = !count;
  });
  const remove = $('#batchRemove');
  if (remove) {
    const insideShelf = shelf !== 'all' && shelf !== 'favorites';
    remove.hidden = !insideShelf;
    remove.disabled = !count;
    if (insideShelf) remove.textContent = `Remove from ${shelfName()}`;
  }
  renderBatchMenu();
}

function renderBatchMenu() {
  const menu = $('#batchMenu');
  if (!menu) return;
  const label = picked.size === 1 ? 'Add this book to' : `Add ${picked.size} books to`;
  menu.innerHTML = `<div class="menu-title">${label}</div>` +
    `<button data-add="favorites"><svg><use href="#i-heart"/></svg>Favorites</button>` +
    S.collections.map((c) => `<button data-add="${esc(c.id)}"><svg><use href="#i-folder"/></svg>${esc(c.name)}</button>`).join('') +
    `<button data-new-shelf="1"><svg><use href="#i-plus"/></svg>New shelf…</button>`;
}

function closeBatchMenu() {
  hideEl($('#batchMenu'), MOTION.fast);
}

function toggleBatchMenu() {
  const menu = $('#batchMenu');
  if (!menu) return;
  const opening = !isShown(menu);
  renderBatchMenu();
  if (opening) showEl(menu); else hideEl(menu, MOTION.fast);
}

function bindBatch() {
  $('#btnSelect').onclick = () => setSelectMode(!selectMode);
  $('#batchCancel').onclick = () => setSelectMode(false);
  $('#batchFav').onclick = () => {
    if (!picked.size) return;
    shelfAdd('favorites', [...picked]);
  };
  $('#batchRemove').onclick = () => {
    if (!picked.size || shelf === 'all' || shelf === 'favorites') return;
    shelfRemove(shelf, [...picked]);
  };
  $('#batchShelf').onclick = (e) => { e.stopPropagation(); toggleBatchMenu(); };
  $('#batchMenu').addEventListener('click', async (e) => {
    const add = e.target.closest('[data-add]');
    const fresh = e.target.closest('[data-new-shelf]');
    closeBatchMenu();
    if (add) {
      await shelfAdd(add.dataset.add, [...picked]);
      return;
    }
    if (fresh) {
      const name = await askName('New shelf', '', 'Create');
      if (!name) return;
      const record = await createShelf(name, { quiet: true });
      if (record && picked.size) await shelfAdd(record.id, [...picked]);
      else if (record) toast(`Shelf “${record.name}” created`);
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#batchMenu, #batchShelf')) closeBatchMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selectMode && !$('.drawer:not([hidden]), .modal:not([hidden])')) setSelectMode(false);
  });
}
