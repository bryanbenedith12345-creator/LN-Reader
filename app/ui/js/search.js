/* Yolala's LN Reader - searching the full text of every book on the shelf. */
'use strict';

let allSearchTimer = null;

async function searchAllBooks(query) {
  const list = $('#allHits');
  if (!query || query.length < 2) {
    list.innerHTML = '<div class="find-note">Type at least two characters to search every book.</div>';
    $('#allSub').textContent = 'Search inside all books';
    return;
  }
  list.innerHTML = '<div class="find-note">Searching…</div>';
  try {
    const data = await getJSON('/api/search-all?q=' + encodeURIComponent(query));
    const hits = data.hits || [];
    $('#allSub').textContent = hits.length
      ? `${hits.length} match${hits.length === 1 ? '' : 'es'} in your library`
      : 'Search inside all books';
    if (!hits.length) {
      list.innerHTML = `<div class="find-note">Nothing matches “${esc(query)}”.</div>`;
      return;
    }
    list.innerHTML = hits.map((hit) => `
      <button class="find-hit" data-book="${hit.book}" data-ch="${hit.chapter}">
        <span class="fh"><b>${esc(bookById(hit.book) ? bookById(hit.book).title : hit.book)}</b><span>${esc(hit.title)}</span></span>
        <span class="fs">${markQuery(hit.snippet, query)}</span>
      </button>`).join('');
  } catch (err) {
    list.innerHTML = `<div class="find-note">Search failed: ${esc(err.message)}</div>`;
  }
}

function scheduleAllSearch() {
  clearTimeout(allSearchTimer);
  allSearchTimer = setTimeout(() => searchAllBooks($('#libSearchAll').value.trim()), 340);
}
