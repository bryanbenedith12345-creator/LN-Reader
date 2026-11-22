/* Yolala's LN Reader - highlight list, selection, painting and search jumps.
   Classic script: loaded in order from index.html; shared globals. */
'use strict';

/* --------------------------------------------------------- highlight list -- */
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
    return { id, meta, items: grouped.get(id), title: (book && book.title) || (meta && meta.title) || 'Unknown book' };
  });
  groups.sort((a, b) => Math.max(...b.items.map((h) => h.created)) - Math.max(...a.items.map((h) => h.created)));

  const html = groups.map((g) => {
    const rows = g.items.slice().sort((a, b) => b.created - a.created).map((h) => {
      const chapter = g.meta && g.meta.chapters[h.ch] ? g.meta.chapters[h.ch].title : `Chapter ${h.ch + 1}`;
      const color = (COLORS.find((c) => c.id === h.color) || COLORS[0]).hex;
      const quote = h.quote.length > 420 ? h.quote.slice(0, 420) + '…' : h.quote;
      return `<div class="hl-row" data-hid="${esc(h.id)}" style="--hl:${color}">
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

  $('#hlList').innerHTML = html;
  $('#hlEmpty').hidden = list.length > 0;
  const noneAtAll = S.highlights.length === 0;
  $('#hlEmpty h2').textContent = noneAtAll ? 'No highlights yet' : 'No matches';
  $('#hlEmpty p').textContent = noneAtAll
    ? 'Select text while reading, then pick a colour. Highlights are searchable here.'
    : 'Try a different search, colour or book.';
  $('#hlSub').textContent = `${S.highlights.length} highlights · ${readCount()} chapters read · ${fmtWords(S.stats.words || 0)} words`;
}

function highlightById(id) { return S.highlights.find((h) => h.id === id); }

async function deleteHighlight(h) {
  S.highlights = S.highlights.filter((x) => x.id !== h.id);
  if (R.id === h.book) { R.hl = R.hl.filter((x) => x.id !== h.id); paintHighlights(); }
  try { await postJSON('/api/highlights', { book: h.book, list: S.highlights.filter((x) => x.book === h.book) }); } catch (_) { /* ignore */ }
  S.stats.highlights = S.highlights.length;
  renderHighlightFilters();
  updateCounts();
  renderHighlights();
  toast('Highlight deleted');
}


/* ------------------------------------------------------------ highlighting -- */
function clearMarks(root) {
  $$('mark.hl, mark.hit', root).forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
  });
  root.normalize();
}
function paintHighlights() {
  const body = $('#rBody');
  if (!body) return;
  clearMarks(body);
  const list = R.hl.filter((h) => h.ch === R.ch);
  if (!list.length) return;
  const text = body.textContent;
  const anchored = [];
  for (const h of list) {
    let start = h.start, end = h.end;
    if (text.slice(start, end) !== h.quote) {
      let best = -1, bestDist = Infinity, from = 0, guard = 0;
      while (guard++ < 300) {
        const at = text.indexOf(h.quote, from);
        if (at < 0) break;
        const dist = Math.abs(at - start);
        if (dist < bestDist) { bestDist = dist; best = at; }
        from = at + 1;
      }
      if (best < 0) continue;
      start = best; end = best + h.quote.length;
    }
    if (end > start) anchored.push({ ...h, start, end });
  }
  if (!anchored.length) return;
  // Merge overlapping ranges so marks never nest; the first highlight keeps its colour.
  anchored.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const h of anchored) {
    const last = merged[merged.length - 1];
    if (last && h.start <= last.end) last.end = Math.max(last.end, h.end);
    else merged.push({ ...h });
  }
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let pos = 0, node;
  while ((node = walker.nextNode())) {
    const len = node.data.length;
    nodes.push([node, pos, pos + len]);
    pos += len;
  }
  for (const [textNode, start0, end0] of nodes) {
    const segs = merged
      .filter((h) => h.start < end0 && h.end > start0)
      .map((h) => [Math.max(h.start, start0) - start0, Math.min(h.end, end0) - start0, h])
      .sort((a, b) => b[0] - a[0]);
    for (const [a, b, h] of segs) {
      const limit = textNode.data.length;
      const from = clamp(a, 0, limit), to = clamp(b, 0, limit);
      if (from >= to || !textNode.parentNode) continue;
      const range = document.createRange();
      range.setStart(textNode, from);
      range.setEnd(textNode, to);
      const mark = document.createElement('mark');
      mark.className = 'hl';
      mark.dataset.color = h.color;
      mark.dataset.hid = h.id;
      if (h.note) mark.title = h.note;
      try { range.surroundContents(mark); } catch (_) { /* node boundary */ }
    }
  }
  if (TTS.model) {
    TTS.model = null;
    if (TTS.unit >= 0 && !$('#ttsDock').hidden) ttsPaintUnit(false);
  }
}
function rangeOffsets(range) {
  const body = $('#rBody');
  const pre = range.cloneRange();
  pre.selectNodeContents(body);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  pre.setEnd(range.endContainer, range.endOffset);
  const end = pre.toString().length;
  return { start, end, quote: body.textContent.slice(start, end) };
}
function captureSelection() {
  if (!isOpen) return;
  const sel = window.getSelection();
  const body = $('#rBody');
  if (!sel || sel.isCollapsed || !sel.rangeCount) return hideSelBar();
  const range = sel.getRangeAt(0);
  if (!body.contains(range.commonAncestorContainer)) return hideSelBar();
  if (range.collapsed) return hideSelBar();
  let info;
  try { info = rangeOffsets(range); } catch (_) { return hideSelBar(); }
  if (!info.quote.trim()) return hideSelBar();
  pendingSel = { ...info, ch: R.ch };
  showSelBar(range);
}
function showSelBar(range) {
  const bar = $('#selBar');
  bar.hidden = false;
  const rect = range.getBoundingClientRect();
  const w = bar.offsetWidth || 250;
  const left = clamp(rect.left + rect.width / 2 - w / 2, 12, innerWidth - w - 12);
  let top = rect.top - bar.offsetHeight - 10;
  if (top < 64) top = Math.min(innerHeight - 60, rect.bottom + 10);
  bar.style.left = left + 'px';
  bar.style.top = top + 'px';
}
function hideSelBar() { pendingSel = null; $('#selBar').hidden = true; }

function addHighlight(color) {
  if (!pendingSel) return;
  const pick = pendingSel;
  const text = $('#rBody').textContent;
  const overlap = R.hl.find((h) => h.ch === pick.ch && h.start < pick.end && h.end > pick.start);
  if (overlap) {
    overlap.start = Math.min(overlap.start, pick.start);
    overlap.end = Math.max(overlap.end, pick.end);
    overlap.quote = text.slice(overlap.start, overlap.end);
    overlap.color = color;
    R.hl = R.hl.map((h) => (h.id === overlap.id ? overlap : h));
    hideSelBar();
    paintHighlights();
    saveHighlights();
    toast('Highlight updated');
    return;
  }
  const h = {
    id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    book: R.id, ch: pick.ch, start: pick.start, end: pick.end,
    quote: pick.quote, color, note: '', created: Math.floor(Date.now() / 1000),
  };
  R.hl.push(h);
  if (h.ch === R.ch) paintHighlights();
  hideSelBar();
  const sel = window.getSelection();
  if (sel) sel.removeAllRanges();
  saveHighlights();
  toast('Highlight saved', { action: { label: 'Add note', fn: () => setTimeout(() => openHighlightPop(h.id), 40) } });
}
function saveHighlights() {
  if (!R.id) return;
  S.highlights = S.highlights.filter((x) => x.book !== R.id).concat(R.hl);
  S.stats.highlights = S.highlights.length;
  updateCounts();
  renderHighlightFilters();
  postJSON('/api/highlights', { book: R.id, list: R.hl }).catch(() => toast('Could not save highlight'));
}
function openHighlightPop(id) {
  const h = highlightById(id) || R.hl.find((x) => x.id === id);
  if (!h) return;
  const mark = $(`#rBody mark.hl[data-hid="${id}"]`);
  const pop = $('#hlPop');
  pop.dataset.hid = id;
  $('#popNote').value = h.note || '';
  $('#popColors').innerHTML = COLORS.map((c) =>
    `<button class="sw${c.id === h.color ? ' on' : ''}" data-c="${c.id}" title="${c.name}"></button>`).join('');
  pop.hidden = false;
  const rect = mark ? mark.getBoundingClientRect() : { left: innerWidth / 2 - 125, top: innerHeight / 2, width: 0, bottom: innerHeight / 2 };
  const w = 250;
  pop.style.left = clamp(rect.left + rect.width / 2 - w / 2, 12, innerWidth - w - 12) + 'px';
  let top = rect.top - pop.offsetHeight - 10;
  if (top < 60) top = Math.min(innerHeight - pop.offsetHeight - 12, rect.bottom + 10);
  pop.style.top = Math.max(56, top) + 'px';
  $('#popNote').focus({ preventScroll: true });
}
function hideHighlightPop() { $('#hlPop').hidden = true; $('#hlPop').dataset.hid = ''; }
function updateHighlight(id, patch) {
  const h = R.hl.find((x) => x.id === id) || S.highlights.find((x) => x.id === id);
  if (!h) return;
  Object.assign(h, patch);
  saveHighlights();
}
function flashHighlight(id) {
  const mark = $(`#rBody mark.hl[data-hid="${id}"]`);
  if (!mark) return;
  mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
  mark.classList.add('flash');
  setTimeout(() => mark.classList.remove('flash'), 1700);
}
function scrollToText(query) {
  const body = $('#rBody');
  const text = body.textContent;
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return;
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let pos = 0, node, startNode = null, startOff = 0, endNode = null, endOff = 0;
  while ((node = walker.nextNode())) {
    const len = node.data.length;
    if (!startNode && at < pos + len) { startNode = node; startOff = at - pos; }
    if (startNode && at + query.length <= pos + len) { endNode = node; endOff = at + query.length - pos; break; }
    pos += len;
  }
  if (!startNode) return;
  const range = document.createRange();
  range.setStart(startNode, startOff);
  range.setEnd(endNode || startNode, endNode ? endOff : startOff + query.length);
  const mark = document.createElement('mark');
  mark.className = 'hit';
  try {
    range.surroundContents(mark);
    mark.scrollIntoView({ block: 'center' });
    setTimeout(() => {
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      body.normalize();
    }, 2600);
  } catch (_) { /* ignore */ }
}
