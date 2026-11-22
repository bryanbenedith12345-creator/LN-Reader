/* Yolala's LN Reader - library shelf, covers and delete flow.
   Classic script: loaded in order from index.html; shared globals. */
'use strict';

/* -------------------------------------------------------------- library -- */
async function loadLibrary() {
  const data = await getJSON('/api/library');
  S.books = data.books || [];
  S.highlights = data.highlights || [];
  S.bookmarks = data.bookmarks || [];
  S.stats = data.stats || {};
  S.settings = { ...DEFAULTS, ...(data.settings || {}) };
  applySettings(false);
  renderLibrary();
  renderHighlightFilters();
  renderHighlights();
  updateCounts();
}
function readCount() {
  return S.books.reduce((total, book) => total + ((book.progress && book.progress.read) || []).length, 0);
}
function updateCounts() {
  $('#navCount').textContent = S.books.length || '';
  $('#hlNavCount').textContent = S.highlights.length || '';
  $('#sideFoot').innerHTML = `<b>${S.books.length}</b> books · <b>${S.highlights.length}</b> highlights<br>` +
    `<b>${readCount()}</b> chapters read · <b>${fmtWords(S.stats.words || 0)}</b> words`;
}
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
function renderLibrary() {
  const query = $('#libSearch').value.trim().toLowerCase();
  const sort = $('#libSort').value;
  const list = S.books
    .filter((b) => !query || (b.title + ' ' + b.author).toLowerCase().includes(query))
    .sort((a, b) => {
      if (sort === 'added') return (b.added || 0) - (a.added || 0);
      if (sort === 'title') return a.title.localeCompare(b.title);
      if (sort === 'author') return a.author.localeCompare(b.author) || a.title.localeCompare(b.title);
      if (sort === 'progress') return bookPct(b) - bookPct(a);
      return ((b.progress || {}).updated || b.added || 0) - ((a.progress || {}).updated || a.added || 0);
    });

  const last = S.books.filter((b) => b.progress && b.progress.updated)
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

  const grid = $('#grid');
  grid.innerHTML = list.map((b) => `
    <div class="card" data-id="${b.id}" tabindex="0" role="button" aria-label="${esc(b.title)}">
      ${coverHTML(b)}
      <button class="card-del" data-del="${b.id}" title="Remove book" aria-label="Remove ${esc(b.title)}">
        <svg><use href="#i-trash"/></svg>
      </button>
      <div class="card-meta">
        <span class="card-title">${esc(b.title)}</span>
        <span class="card-author">${esc(b.author)}</span>
      </div>
    </div>`).join('');

  if (!list.length && S.books.length) {
    grid.innerHTML = `<div class="find-note">No books match “${esc(query)}”.</div>`;
  }
  $('#empty').hidden = S.books.length > 0;
  $('#grid').hidden = S.books.length === 0;
  $('#libSub').textContent = S.books.length
    ? `${S.books.length} book${S.books.length === 1 ? '' : 's'} on the shelf`
    : 'Your shelf';

  hydrateCovers(grid);
}
function confirmDelete(book) {
  toast(`Remove “${book.title}” from your library?`, {
    timeout: 8000,
    action: {
      label: 'Remove', danger: true, fn: async () => {
        try {
          const lib = await postJSON('/api/delete', { book: book.id });
          metaCache.delete(book.id);
          S.books = lib.books; S.highlights = lib.highlights; S.stats = lib.stats;
          renderLibrary(); renderHighlightFilters(); renderHighlights(); updateCounts();
          toast('Book removed');
        } catch (err) { toast('Could not remove: ' + err.message); }
      },
    },
  });
}

/* ---------------------------------------------------------------- views -- */
function setView(name) {
  view = name;
  $$('.nav-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === 'view-' + name));
  if (name === 'highlights') renderHighlights();
}
