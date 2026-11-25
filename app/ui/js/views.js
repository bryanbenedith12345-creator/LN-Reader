/* Yolala's LN Reader - navigation between the library views and counters. */
'use strict';

function readCount() {
  return S.books.reduce((total, book) => total + ((book.progress && book.progress.read) || []).length, 0);
}

function updateCounts() {
  $('#navCount').textContent = S.books.length || '';
  $('#hlNavCount').textContent = S.highlights.length || '';
  const s = (n) => (n === 1 ? '' : 's');
  $('#sideFoot').innerHTML = `<b>${S.books.length}</b> book${s(S.books.length)} · <b>${S.highlights.length}</b> highlight${s(S.highlights.length)} · <b>${S.favorites.length}</b> hearted<br>` +
    `<b>${readCount()}</b> chapter${s(readCount())} read · <b>${fmtWords(S.stats.words || 0)}</b> words`;
}

function setView(name) {
  view = name;
  $$('.nav-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === 'view-' + name));
  if (name === 'highlights') renderHighlights();
  else renderShelves();
}

function loadLibrary() {
  return getJSON('/api/library').then((data) => {
    S.books = data.books || [];
    S.highlights = data.highlights || [];
    S.favorites = data.favorites || [];
    S.collections = data.collections || [];
    S.collectionBooks = data.collection_books || {};
    S.stats = data.stats || {};
    S.settings = { ...DEFAULTS, ...(data.settings || {}) };
    if (shelf !== 'all' && shelf !== 'favorites' && !S.collections.some((c) => c.id === shelf)) shelf = 'all';
    applySettings(false);
    renderShelves();
    renderLibrary();
    renderHighlightFilters();
    renderHighlights();
    updateCounts();
    return data;
  });
}
