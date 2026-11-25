/* Yolala's LN Reader - favorites and putting books on shelves. */
'use strict';

function syncFavorites(bookId) {
  const on = S.favorites.includes(bookId);
  const label = on ? 'Remove from favorites' : 'Add to favorites';
  $$(`[data-fav="${bookId}"]`).forEach((btn) => {
    btn.classList.toggle('is-on', on);
    btn.title = label;
    btn.setAttribute('aria-label', label);
  });
  const readBtn = $('#rFav');
  if (readBtn && R.id === bookId) {
    readBtn.classList.toggle('on', on);
    readBtn.title = label;
  }
  if (typeof renderInfoShelves === 'function') renderInfoShelves(bookId);
}

function applyFavorite(bookId, on) {
  S.favorites = on
    ? (S.favorites.includes(bookId) ? S.favorites : [...S.favorites, bookId])
    : S.favorites.filter((b) => b !== bookId);
  syncFavorites(bookId);
  renderShelves();
  if (shelf === 'favorites') renderLibrary();
  updateCounts();
}

async function toggleFavorite(bookId, force) {
  const had = S.favorites.includes(bookId);
  const on = force === undefined ? !had : !!force;
  if (on === had) return;
  applyFavorite(bookId, on);
  try {
    const res = await postJSON('/api/favorite', { book: bookId, on });
    if (res && Array.isArray(res.favorites)) {
      S.favorites = res.favorites;
      syncFavorites(bookId);
      renderShelves();
      if (shelf === 'favorites') renderLibrary();
      updateCounts();
    }
    toast(on ? 'Added to favorites' : 'Removed from favorites', { timeout: 1700 });
  } catch (err) {
    applyFavorite(bookId, had);
    toast('Could not save that favorite');
  }
}

async function shelfAdd(shelfId, bookIds) {
  const ids = [...new Set(bookIds || [])];
  if (!ids.length) return;
  try {
    const res = await postJSON('/api/shelf-books', { shelf: shelfId, add: ids });
    if (res.favorites) S.favorites = res.favorites;
    if (res.books) S.collectionBooks[shelfId] = res.books;
    renderShelves();
    if (shelf === shelfId || shelf === 'favorites') renderLibrary();
    if (typeof renderInfoShelves === 'function') renderInfoShelves();
    updateCounts();
    const name = shelfName(shelfId);
    toast(`${ids.length} book${ids.length === 1 ? '' : 's'} added to ${name}`, { timeout: 2600 });
  } catch (err) {
    toast('Could not add those books: ' + err.message);
  }
}

async function shelfRemove(shelfId, bookIds) {
  const ids = [...new Set(bookIds || [])];
  if (!ids.length) return;
  try {
    const res = await postJSON('/api/shelf-books', { shelf: shelfId, remove: ids });
    if (res.favorites) S.favorites = res.favorites;
    if (res.books) S.collectionBooks[shelfId] = res.books;
    renderShelves();
    renderLibrary();
    if (typeof renderInfoShelves === 'function') renderInfoShelves();
    updateCounts();
    toast(`Removed ${ids.length} book${ids.length === 1 ? '' : 's'} from ${shelfName(shelfId)}`, { timeout: 2600 });
  } catch (err) {
    toast('Could not remove those books: ' + err.message);
  }
}
