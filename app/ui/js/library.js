/* Yolala's LN Reader - the shelf: covers, sorting, searching and removal. */
'use strict';

function hydrateCovers(root) {
  $$('.cover img', root).forEach((img) => {
    const settle = () => img.classList.add('loaded');
    img.addEventListener('load', settle);
    img.addEventListener('error', () => {
      img.remove();
      const gen = img.closest('.cover')?.querySelector('.cover-gen');
      if (gen) gen.hidden = false;
    });
    if (img.complete && img.naturalWidth) settle();
  });
}

function coverHTML(book, extra = '') {
  return `<div class="cover ${extra}">` +
    `<div class="cover-gen">${esc(book.title)}</div>` +
    (book.cover ? `<img src="/api/cover/${book.id}" alt="" loading="lazy">` : '') +
    `<div class="cover-prog"><i style="width:${bookPct(book).toFixed(1)}%"></i></div></div>`;
}

function bookById(id) {
  return S.books.find((b) => b.id === id);
}

function sortBooks(list) {
  const sort = $('#libSort').value;
  return list.sort((a, b) => {
    if (sort === 'added') return (b.added || 0) - (a.added || 0);
    if (sort === 'title') return a.title.localeCompare(b.title);
    if (sort === 'author') return a.author.localeCompare(b.author) || a.title.localeCompare(b.title);
    if (sort === 'progress') return bookPct(b) - bookPct(a);
    return ((b.progress || {}).updated || b.added || 0) - ((a.progress || {}).updated || a.added || 0);
  });
}

function cardHTML(book) {
  const fav = S.favorites.includes(book.id);
  const pick = picked.has(book.id);
  const favLabel = fav ? 'Remove from favorites' : 'Add to favorites';
  return `
    <div class="card${pick ? ' is-picked' : ''}" data-id="${book.id}" tabindex="0" role="button"
         aria-label="${esc(book.title)}" draggable="${!selectMode}">
      <div class="cover">
        <div class="cover-gen">${esc(book.title)}</div>
        ${book.cover ? `<img src="/api/cover/${book.id}" alt="" loading="lazy">` : ''}
        <button class="card-fav${fav ? ' is-on' : ''}" data-fav="${book.id}" title="${favLabel}" aria-label="${favLabel}">
          <svg><use href="#i-heart"/></svg>
        </button>
        <div class="card-tools">
          <button class="card-tool" data-info="${book.id}" title="Book details" aria-label="Details for ${esc(book.title)}">
            <svg><use href="#i-info"/></svg>
          </button>
          <button class="card-del" data-del="${book.id}" title="Remove book" aria-label="Remove ${esc(book.title)}">
            <svg><use href="#i-trash"/></svg>
          </button>
        </div>
        ${selectMode ? `<span class="card-pick"><input type="checkbox" data-pick="${book.id}" ${pick ? 'checked' : ''} aria-label="Select ${esc(book.title)}"></span>` : ''}
        <div class="cover-prog"><i style="width:${bookPct(book).toFixed(1)}%"></i></div>
      </div>
      <div class="card-meta">
        <span class="card-title">${esc(book.title)}</span>
        <span class="card-author">${esc(book.author)}</span>
      </div>
    </div>`;
}

function renderContinue() {
  const pool = shelf === 'all' ? S.books
    : shelf === 'favorites' ? S.books.filter((b) => S.favorites.includes(b.id))
    : S.books.filter((b) => (S.collectionBooks[shelf] || []).includes(b.id));
  const last = pool.filter((b) => b.progress && b.progress.updated)
    .sort((a, b) => b.progress.updated - a.progress.updated)[0];
  $('#continueWrap').innerHTML = !last ? '' : `
    <div class="continue" data-id="${last.id}">
      ${coverHTML(last, 'cc-cover')}
      <div class="cc-body">
        <span class="cc-eyebrow">Continue reading</span>
        <h2>${esc(last.title)}</h2>
        <p>Chapter ${(last.progress.ch || 0) + 1} of ${last.chapters} · ${Math.round(bookPct(last))}% · ${fmtDur((last.words || 0) * (1 - bookPct(last) / 100) / WPM)} left</p>
        <div class="cc-bar"><i style="width:${bookPct(last).toFixed(1)}%"></i></div>
      </div>
      <button class="btn primary" data-act="resume">Resume</button>
    </div>`;
  hydrateCovers($('#continueWrap'));
}

function renderLibrary() {
  const query = $('#libSearch').value.trim().toLowerCase();
  const ids = shelfIds();
  const pool = ids ? S.books.filter((b) => ids.has(b.id)) : S.books;
  const list = sortBooks(pool.filter((b) =>
    !query || (b.title + ' ' + b.author + ' ' + (b.tags || []).join(' ')).toLowerCase().includes(query)));

  renderContinue();

  const grid = $('#grid');
  grid.innerHTML = list.map(cardHTML).join('') || (query
    ? `<div class="find-note">No books match “${esc(query)}”${shelf === 'all' ? '' : ' on this shelf'}.</div>`
    : '');

  const noBooks = S.books.length === 0;
  const emptyShelf = !noBooks && pool.length === 0;
  if (emptyShelf) {
    $('#shelfEmptyTitle').textContent = shelf === 'favorites' ? 'No favorites yet' : `“${shelfName()}” is empty`;
    $('#shelfEmptyText').innerHTML = shelf === 'favorites'
      ? 'Tap the heart on any book and it stays here, ready to find again.'
      : 'Drag books onto this shelf, or pick several with <b>Select</b> and add them all at once.';
  }
  $('#empty').hidden = !noBooks;
  $('#shelfEmpty').hidden = !emptyShelf;
  grid.hidden = noBooks;
  $('#libTitle').textContent = shelfName();
  $('#libSub').textContent = noBooks ? 'Your shelf'
    : shelf === 'all' ? `${pool.length} book${pool.length === 1 ? '' : 's'} on the shelf`
    : `${pool.length} book${pool.length === 1 ? '' : 's'} ${shelf === 'favorites' ? 'hearted' : 'saved here'}`;

  hydrateCovers(grid);
}

function confirmDelete(book) {
  toast(`Remove “${book.title}” from your library?`, {
    timeout: 8000,
    action: {
      label: 'Remove', danger: true, fn: async () => {
        try {
          await postJSON('/api/delete', { book: book.id });
          metaCache.delete(book.id);
          await loadLibrary();
          toast('Book removed');
        } catch (err) { toast('Could not remove: ' + err.message); }
      },
    },
  });
}
