/* Yolala's LN Reader - selecting text, saving highlights and their notes.
   Classic script: shared globals. */
'use strict';

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
  showEl(bar);
  const rect = range.getBoundingClientRect();
  const w = bar.offsetWidth || 250;
  const left = clamp(rect.left + rect.width / 2 - w / 2, 12, innerWidth - w - 12);
  let top = rect.top - bar.offsetHeight - 10;
  if (top < 64) top = Math.min(innerHeight - 60, rect.bottom + 10);
  bar.style.left = left + 'px';
  bar.style.top = top + 'px';
}

function hideSelBar() { pendingSel = null; hideEl($('#selBar'), MOTION.fast); }

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
  showEl(pop);
  const rect = mark ? mark.getBoundingClientRect() : { left: innerWidth / 2 - 125, top: innerHeight / 2, width: 0, bottom: innerHeight / 2 };
  const w = 250;
  pop.style.left = clamp(rect.left + rect.width / 2 - w / 2, 12, innerWidth - w - 12) + 'px';
  let top = rect.top - pop.offsetHeight - 10;
  if (top < 60) top = Math.min(innerHeight - pop.offsetHeight - 12, rect.bottom + 10);
  pop.style.top = Math.max(56, top) + 'px';
  $('#popNote').focus({ preventScroll: true });
}

function hideHighlightPop() { hideEl($('#hlPop'), MOTION.fast); $('#hlPop').dataset.hid = ''; }

function updateHighlight(id, patch) {
  const h = R.hl.find((x) => x.id === id) || S.highlights.find((x) => x.id === id);
  if (!h) return;
  Object.assign(h, patch);
  saveHighlights();
}

