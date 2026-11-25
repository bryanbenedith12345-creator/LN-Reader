/* Yolala's LN Reader - the table of contents. */
'use strict';

function buildToc() {
  const list = $('#tocList');
  if (!list || !R.meta) return;
  const read = new Set(R.prog.read || []);
  list.innerHTML = '<div class="toc-sub">Chapters</div>' + R.meta.chapters.map((c, i) => `
    <button class="toc-item${i === R.ch ? ' on' : ''}" data-ch="${i}">
      <span class="num">${i + 1}</span>
      <span class="t">${esc(c.title)}</span>
      ${read.has(i) ? '<svg class="tick"><use href="#i-check"/></svg>' : ''}
    </button>`).join('');
  filterToc($('#tocFilter').value);
}

function filterToc(query) {
  const needle = query.trim().toLowerCase();
  $$('#tocList .toc-item').forEach((btn) => {
    btn.hidden = !!needle && !btn.textContent.toLowerCase().includes(needle);
  });
}
