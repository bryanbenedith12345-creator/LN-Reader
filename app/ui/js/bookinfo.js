/* Yolala's LN Reader - book details: your own title, author, series and tags. */
'use strict';

async function openBookInfo(bookId) {
  const book = bookById(bookId);
  if (!book) return;
  let meta = metaCache.get(bookId);
  if (!meta) {
    try { meta = await getMeta(bookId); } catch (_) { /* keep the shelf values */ }
  }
  $('#infoTitle').textContent = book.title;
  $('#infoSub').textContent = `${book.author} · ${book.chapters} chapters · ${fmtWords(book.words)} words`;
  $('#infoEpub').textContent = (meta && meta.title) || book.epub_title || book.title;
  $('#infoName').value = book.title || '';
  $('#infoAuthor').value = book.author || '';
  $('#infoSeries').value = book.series || '';
  $('#infoTags').value = (book.tags || []).join(', ');
  $('#bookInfo').dataset.book = bookId;
  renderInfoShelves(bookId);
  showEl($('#bookInfo'));
  setTimeout(() => $('#infoName').focus({ preventScroll: true }), 40);
}

function renderInfoShelves(bookId = $('#bookInfo').dataset.book) {
  /** Chips for every shelf; tapping one files the book in or out. */
  const box = $('#infoShelves');
  if (!box || !bookId) return;
  const onFavorite = S.favorites.includes(bookId);
  const rows = [`<button class="shelf-chip${onFavorite ? ' on' : ''}" data-shelf-chip="favorites">
      <svg><use href="#i-heart"/></svg>Favorites</button>`];
  for (const c of S.collections) {
    const on = (S.collectionBooks[c.id] || []).includes(bookId);
    rows.push(`<button class="shelf-chip${on ? ' on' : ''}" data-shelf-chip="${c.id}">
        <svg><use href="#i-folder"/></svg>${esc(c.name)}</button>`);
  }
  rows.push('<button class="shelf-chip ghost" data-new-chip="1"><svg><use href="#i-plus"/></svg>New shelf</button>');
  box.innerHTML = rows.join('');
}

function closeBookInfo() {
  hideEl($('#bookInfo'), MOTION.base);
  $('#bookInfo').dataset.book = '';
}

async function saveBookInfo() {
  const bookId = $('#bookInfo').dataset.book;
  if (!bookId) return;
  const payload = {
    book: bookId,
    title: $('#infoName').value,
    author: $('#infoAuthor').value,
    series: $('#infoSeries').value,
    tags: $('#infoTags').value.split(',').map((t) => t.trim()).filter(Boolean),
  };
  try {
    await postJSON('/api/book-info', payload);
    await loadLibrary();
    if (R.id === bookId) $('#rTitle').textContent = bookTitle(bookId);
    closeBookInfo();
    toast('Book details saved');
  } catch (err) {
    toast('Could not save: ' + err.message);
  }
}

function bindBookInfo() {
  $('#infoClose').onclick = closeBookInfo;
  $('#infoSave').onclick = saveBookInfo;
  $('#infoReset').onclick = () => {
    const bookId = $('#bookInfo').dataset.book;
    const book = bookById(bookId) || {};
    const meta = metaCache.get(bookId) || {};
    $('#infoName').value = meta.title || book.epub_title || '';
    $('#infoAuthor').value = meta.author || '';
    $('#infoSeries').value = '';
    $('#infoTags').value = '';
  };
  $('#bookInfo').addEventListener('click', (e) => {
    if (e.target.id === 'bookInfo') closeBookInfo();
  });
}
