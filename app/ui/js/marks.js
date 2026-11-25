/* Yolala's LN Reader - painting highlights into the chapter text. */
'use strict';

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
