/* Yolala's LN Reader - the highlights view: search, filters and actions. */
'use strict';

function renderHighlightFilters() {
  const bookId = $('#hlBook').value;
  const pool = S.highlights.filter((h) => !bookId || h.book === bookId);
  if (hlColorFilter && !pool.some((h) => h.color === hlColorFilter)) hlColorFilter = '';
  const chips = COLORS.map((c) => {
    const n = pool.filter((h) => h.color === c.id).length;
    if (!n) return '';
    return `<button class="chip${hlColorFilter === c.id ? ' on' : ''}" data-color="${c.id}">
      <i style="background:${c.hex}"></i>${c.name}<span class="n">${n}</span></button>`;
  }).join('');
  $('#hlColors').innerHTML = `<button class="chip${hlColorFilter ? '' : ' on'}" data-color="">All<span class="n">${pool.length}</span></button>${chips}`;

  const select = $('#hlBook');
  const current = select.value;
  select.innerHTML = `<option value="">All books</option>` + S.books
    .map((b) => `<option value="${b.id}">${esc(b.title)}</option>`).join('');
  select.value = S.books.some((b) => b.id === current) ? current : '';
}

async function renderHighlights() {
  const token = ++hlRenderToken;
  const query = $('#hlSearch').value.trim();
  const needle = query.toLowerCase();
  const bookId = $('#hlBook').value;
  const list = S.highlights.filter((h) =>
    (!hlColorFilter || h.color === hlColorFilter) &&
    (!bookId || h.book === bookId) &&
    (!needle || (h.quote + ' ' + (h.note || '')).toLowerCase().includes(needle)));

  const grouped = new Map();
  for (const h of list) {
    if (!grouped.has(h.book)) grouped.set(h.book, []);
    grouped.get(h.book).push(h);
  }
  const ids = Array.from(grouped.keys());
  const metas = await Promise.all(ids.map((id) => getMeta(id).catch(() => null)));
  if (token !== hlRenderToken) return;
  const groups = ids.map((id, index) => {
    const book = S.books.find((b) => b.id === id);
    const meta = metas[index];
    return {
      id, meta, items: grouped.get(id),
      title: (book && book.title) || (meta && meta.title) || 'Unknown book',
    };
  });
  groups.sort((a, b) => Math.max(...b.items.map((h) => h.created)) - Math.max(...a.items.map((h) => h.created)));

  $('#hlList').innerHTML = groups.map((g) => {
    const rows = g.items.slice().sort((a, b) => b.created - a.created).map((h) => {
      const chapter = g.meta && g.meta.chapters[h.ch] ? g.meta.chapters[h.ch].title : `Chapter ${h.ch + 1}`;
      const quote = h.quote.length > 420 ? h.quote.slice(0, 420) + '…' : h.quote;
      return `<div class="hl-row" data-hid="${esc(h.id)}" style="--hl:${colorHex(h.color)}">
        <i class="hl-bar"></i>
        <div class="hl-main" data-open="${esc(h.id)}">
          <div class="hl-quote">${markQuery(quote, query)}</div>
          ${h.note ? `<div class="hl-note">${markQuery(h.note, query)}</div>` : ''}
          <div class="hl-meta"><span>${esc(chapter)}</span><span class="sep">·</span><span>${fmtDate(h.created)}</span></div>
        </div>
        <div class="hl-acts">
          <button data-act="copy" title="Copy quote"><svg><use href="#i-mark"/></svg></button>
          <button data-act="delete" class="danger" title="Delete highlight"><svg><use href="#i-trash"/></svg></button>
        </div>
      </div>`;
    }).join('');
    return `<div class="hl-book"><span>${esc(g.title)}</span></div>${rows}`;
  }).join('');

  $('#hlEmpty').hidden = list.length > 0;
  const noneAtAll = S.highlights.length === 0;
  $('#hlEmpty h2').textContent = noneAtAll ? 'No highlights yet' : 'No matches';
  $('#hlEmpty p').textContent = noneAtAll
    ? 'Select text while reading, then pick a colour. Highlights are searchable here.'
    : 'Try a different search, colour or book.';
  const s = (n) => (n === 1 ? '' : 's');
  $('#hlSub').textContent = `${S.highlights.length} highlight${s(S.highlights.length)} · ${readCount()} chapter${s(readCount())} read · ${fmtWords(S.stats.words || 0)} words`;
}

function highlightById(id) {
  return S.highlights.find((h) => h.id === id);
}

async function deleteHighlight(h) {
  S.highlights = S.highlights.filter((x) => x.id !== h.id);
  if (R.id === h.book) { R.hl = R.hl.filter((x) => x.id !== h.id); paintHighlights(); }
  try {
    await postJSON('/api/highlights', { book: h.book, list: S.highlights.filter((x) => x.book === h.book) });
  } catch (_) { /* ignore */ }
  S.stats.highlights = S.highlights.length;
  renderHighlightFilters();
  updateCounts();
  renderHighlights();
  toast('Highlight deleted');
}
