/* Yolala's LN Reader - opening books, loading chapters and tracking progress. */
'use strict';

async function getMeta(id) {
  if (metaCache.has(id)) return metaCache.get(id);
  const detail = await getJSON('/api/book/' + id);
  metaCache.set(id, detail.meta);
  return detail.meta;
}

async function getChapter(bookId, index) {
  const key = bookId + ':' + index;
  if (chapterCache.has(key)) return chapterCache.get(key);
  const data = await getJSON(`/api/book/${bookId}/chapter/${index}`);
  chapterCache.set(key, data);
  while (chapterCache.size > 8) chapterCache.delete(chapterCache.keys().next().value);
  return data;
}

function bookTitle(id) {
  const book = bookById(id);
  return (book && book.title) || (R.meta && R.meta.title) || '';
}

async function openBook(id, chapter, opts = {}) {
  let detail;
  try {
    detail = await getJSON('/api/book/' + id);
  } catch (err) {
    toast('Could not open this book: ' + err.message);
    return;
  }
  metaCache.set(id, detail.meta);
  R.id = id;
  R.meta = detail.meta;
  R.prog = detail.progress || {};
  R.hl = detail.highlights || [];
  R.ready = false;
  findColor = '';
  R.prog.scroll = R.prog.scroll || {};
  R.ch = clamp(chapter ?? R.prog.ch ?? 0, 0, R.meta.chapters.length - 1);
  scope = (detail.settings && Object.keys(detail.settings).length) ? 'book' : 'global';
  applySettings(false);
  $('#rTitle').textContent = bookTitle(id);
  showEl($('#reader'));
  isOpen = true;
  document.title = bookTitle(id) + " — Yolala's LN Reader";
  buildToc();
  updateFavBtn();
  await loadChapter(R.ch, opts);
}

function currentRatio() {
  const sc = $('#rScroll');
  const max = sc.scrollHeight - sc.clientHeight;
  if (max <= 4) return 1;
  return clamp(sc.scrollTop / max, 0, 1);
}

let scrollLocked = true;
function restoreScroll(ratio) {
  const sc = $('#rScroll');
  scrollLocked = false;
  const apply = () => {
    if (scrollLocked || !isOpen) return;
    const max = sc.scrollHeight - sc.clientHeight;
    if (max > 0) sc.scrollTop = clamp(ratio, 0, 1) * max;
  };
  apply();
  requestAnimationFrame(apply);
  $$('#rBody img').forEach((img) => {
    if (!img.complete) img.addEventListener('load', apply, { once: true });
  });
  [60, 220, 500].forEach((ms) => setTimeout(apply, ms));
  setTimeout(() => { scrollLocked = true; }, 1200);
}

let chapterToken = 0;
async function loadChapter(index, opts = {}) {
  if (!R.meta) return;
  const total = R.meta.chapters.length;
  const next = clamp(index, 0, total - 1);
  ttsReset();
  const token = ++chapterToken;
  if (R.ready) {
    const ratio = currentRatio();
    R.prog.scroll[String(R.ch)] = ratio;
    queueProgress(R.ch, ratio);
  }
  R.ready = false;
  hideSelBar();
  hideHighlightPop();
  let data;
  try {
    data = await getChapter(R.id, next);
  } catch (err) {
    if (token === chapterToken) R.ready = true;
    toast('Could not load this chapter: ' + err.message);
    return;
  }
  if (token !== chapterToken || !isOpen || !R.meta) return;
  R.ch = next;
  const body = $('#rBody');
  body.innerHTML = data.html;
  R.words = (body.textContent || '').trim().split(/\s+/).filter(Boolean).length;
  body.classList.remove('enter');
  void body.offsetWidth;
  body.classList.add('enter');
  $$('#rBody img').forEach((img) => img.addEventListener('error', () => img.remove(), { once: true }));
  paintHighlights();
  R.ready = true;
  const stored = R.prog.scroll[String(next)];
  const ratio = opts.ratio != null ? opts.ratio : (typeof stored === 'number' ? stored : 0);
  updateChapterChrome();
  updateProgressBar();
  restoreScroll(ratio);
  if (opts.flash) requestAnimationFrame(() => flashHighlight(opts.flash));
  if (opts.text) requestAnimationFrame(() => scrollToText(opts.text));
  queueProgress(next, ratio);
  if (next + 1 < total) getChapter(R.id, next + 1).catch(() => {});
  if (next > 0) getChapter(R.id, next - 1).catch(() => {});
}

function chapterTitle(index) {
  return R.meta && R.meta.chapters[index] ? R.meta.chapters[index].title : '';
}

function updateChapterChrome() {
  const total = R.meta.chapters.length;
  $('#rChapter').textContent = `${chapterTitle(R.ch)} · ${R.ch + 1} of ${total}`;
  $('#rPrev').disabled = R.ch <= 0;
  $('#rNext').disabled = R.ch >= total - 1;
  $('#rFoot').innerHTML = `
    <button class="prev" data-go="-1" ${R.ch <= 0 ? 'disabled' : ''}><svg><use href="#i-back"/></svg>Previous</button>
    <span>~${Math.max(1, Math.ceil(R.words / WPM))} min in this chapter</span>
    <button class="next" data-go="1" ${R.ch >= total - 1 ? 'disabled' : ''}>Next<svg><use href="#i-back"/></svg></button>`;
  $$('#tocList .toc-item').forEach((btn, i) => btn.classList.toggle('on', i === R.ch));
}

function updateProgressBar() {
  if (!R.meta) return;
  const total = R.meta.chapters.length;
  const ratio = currentRatio();
  const overall = clamp((R.ch + ratio) / total, 0, 1);
  $('#rProgFill').style.width = (overall * 100).toFixed(2) + '%';
  $('#rPos').textContent = Math.round(overall * 100) + '% · chapter ' + (R.ch + 1) + ' of ' + total;
  $('#rTime').textContent = fmtDur((R.meta.words || 0) * (1 - overall) / WPM) + ' left in book';
}

function goChapter(delta) {
  const target = R.ch + delta;
  if (target < 0 || target >= R.meta.chapters.length) return;
  loadChapter(target);
}

function queueProgress(chapter, ratio) {
  if (!R.id) return;
  R.prog.ch = chapter;
  R.prog.ratio = ratio;
  R.prog.scroll = R.prog.scroll || {};
  R.prog.scroll[String(chapter)] = ratio;
  R.prog.updated = Date.now() / 1000;
  if (ratio >= 0.97) {
    R.prog.read = R.prog.read || [];
    if (!R.prog.read.includes(chapter)) R.prog.read.push(chapter);
  }
  const book = bookById(R.id);
  if (book) book.progress = { ...R.prog, scroll: { ...R.prog.scroll } };
  clearTimeout(progressTimer);
  progressTimer = setTimeout(flushProgress, 600);
}

function flushProgress() {
  clearTimeout(progressTimer);
  progressTimer = null;
  if (!R.id) return;
  const payload = { book: R.id, ch: R.prog.ch, ratio: R.prog.ratio, scroll: R.prog.scroll || {} };
  postJSON('/api/progress', payload).catch(() => {});
}

function closeReader() {
  if (!isOpen) return;
  chapterToken++;
  if (R.ready) queueProgress(R.ch, currentRatio());
  flushProgress();
  isOpen = false;
  R.ready = false;
  ttsReset();
  hideEl($('#reader'), MOTION.base);
  closePanels();
  closeLightbox();
  hideSelBar();
  hideHighlightPop();
  document.title = "Yolala's LN Reader";
  scope = 'global';
  updateCounts();
  renderLibrary();
  renderHighlights();
  R.id = null; R.meta = null;
}

function updateFavBtn() {
  const btn = $('#rFav');
  if (!btn || !R.id) return;
  const on = S.favorites.includes(R.id);
  btn.classList.toggle('on', on);
  btn.title = on ? 'Remove from favorites (F)' : 'Favorite this book (F)';
}
