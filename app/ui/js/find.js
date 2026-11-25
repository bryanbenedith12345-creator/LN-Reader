/* Yolala's LN Reader - the in-book find panel and its highlight list. */
'use strict';

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
    const quote = h.quote.length > 160 ? h.quote.slice(0, 160) + '…' : h.quote;
    return `<button class="find-hit" data-hid="${esc(h.id)}">
      <span class="fh"><i class="fdot" style="background:${colorHex(h.color)}"></i><b>${esc(chapterTitle(h.ch))}</b><span>ch. ${h.ch + 1}</span></span>
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
