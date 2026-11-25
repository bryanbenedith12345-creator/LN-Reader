/* Yolala's LN Reader - bindings for the reader: chrome, selection and files. */
'use strict';

function bindReaderUI() {
  const setSide = (hidden) => {
    $('.app').classList.toggle('side-collapsed', hidden);
    $('#sideOpen').hidden = !hidden;
    localStorage.setItem('ln.side', hidden ? '1' : '0');
  };
  $('#sideHide').onclick = () => setSide(true);
  $('#sideOpen').onclick = () => setSide(false);
  if (localStorage.getItem('ln.side') === '1') setSide(true);

  ttsBind();
  $('#rBack').onclick = closeReader;
  $('#rPrev').onclick = () => goChapter(-1);
  $('#rNext').onclick = () => goChapter(1);
  $('#rChapterBtn').onclick = () => togglePanel('dToc');
  $('#rFind').onclick = () => togglePanel('dFind');
  $('#rSettings').onclick = () => togglePanel('dSet');
  $('#rFav').onclick = () => toggleFavorite(R.id);
  $('#rTheme').onclick = toggleSepia;
  $('#rInfo').onclick = () => openBookInfo(R.id);
  $('#btnSepia').onclick = toggleSepia;
  $('#lbClose').onclick = closeLightbox;
  $('#lbSave').onclick = saveLightboxImage;
  $('#lbPrev').onclick = () => stepLightbox(-1);
  $('#lbNext').onclick = () => stepLightbox(1);
  $('#lbStage').addEventListener('click', (e) => {
    if (e.target.id === 'lbStage') toggleZoom();
    else if (e.target.id === 'lbImg') toggleZoom();
  });
  $('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') closeLightbox(); });
  $('#rFoot').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-go]');
    if (btn) goChapter(Number(btn.dataset.go));
  });

  $('#tocList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ch]');
    if (!btn) return;
    closePanels();
    loadChapter(Number(btn.dataset.ch));
  });
  $('#tocFilter').addEventListener('input', (e) => filterToc(e.target.value));

  $('#findInput').addEventListener('input', (e) => {
    if (e.target.value.trim()) scheduleFind(); else renderFindHighlights();
  });
  $('#findColors').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    findColor = chip.dataset.color;
    renderFindHighlights();
  });
  $('#findInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); findInBook(); }
  });
  $('#findList').addEventListener('click', (e) => {
    const hit = e.target.closest('.find-hit');
    if (!hit) return;
    if (hit.dataset.hid) {
      const h = highlightById(hit.dataset.hid);
      if (!h) return;
      closePanels();
      if (h.ch === R.ch) flashHighlight(h.id);
      else loadChapter(h.ch, { flash: h.id });
      return;
    }
    closePanels();
    loadChapter(Number(hit.dataset.ch), { text: $('#findInput').value.trim() });
  });

  $('#libSearchAll').addEventListener('input', scheduleAllSearch);
  $('#allHits').addEventListener('click', (e) => {
    const hit = e.target.closest('[data-book]');
    if (!hit) return;
    closePanels();
    openBook(hit.dataset.book, Number(hit.dataset.ch), { text: $('#libSearchAll').value.trim() });
  });

  bindSelectionUI();
}

function bindSelectionUI() {
  $('#selColors').innerHTML = COLORS.map((c) => `<button class="sw" data-c="${c.id}" title="${c.name}"></button>`).join('');
  $('#selColors').addEventListener('mousedown', (e) => e.preventDefault());
  $('#selColors').addEventListener('click', (e) => {
    const btn = e.target.closest('.sw');
    if (btn) addHighlight(btn.dataset.c);
  });
  $('#selCopy').addEventListener('mousedown', (e) => e.preventDefault());
  $('#selCopy').onclick = () => {
    if (!pendingSel) return;
    copyText(pendingSel.quote);
    hideSelBar();
  };
  document.addEventListener('mouseup', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (target && target.closest('#selBar, #hlPop, .drawer, .modal, .rbar, .rfoot, .rnav, #ttsDock')) return;
    setTimeout(captureSelection, 0);
  });
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if ((!sel || sel.isCollapsed) && !$('#selBar').hidden) hideSelBar();
  });
  $('#rBody').addEventListener('click', (e) => {
    const link = e.target.closest('a[data-ch]');
    if (link) {
      e.preventDefault();
      const target = Number(link.dataset.ch);
      if (Number.isInteger(target)) loadChapter(target);
      return;
    }
    const mark = e.target.closest('mark.hl');
    if (mark) { e.stopPropagation(); openHighlightPop(mark.dataset.hid); return; }
    const image = e.target.closest('img');
    if (image) { e.preventDefault(); openLightbox(image); return; }
    if (e.target.closest('mark.hl, a')) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    const at = ttsIndexAtPoint(e.clientX, e.clientY);
    if (at == null) return;
    ttsSelect(at, TTS.playing || TTS.paused);
  });
  $('#popColors').addEventListener('mousedown', (e) => e.preventDefault());
  $('#popColors').addEventListener('click', (e) => {
    const btn = e.target.closest('.sw');
    if (!btn) return;
    const id = $('#hlPop').dataset.hid;
    updateHighlight(id, { color: btn.dataset.c });
    paintHighlights();
    $$('#popColors .sw').forEach((s) => s.classList.toggle('on', s === btn));
  });
  $('#popNote').addEventListener('input', () => {
    clearTimeout(openHighlightPop.timer);
    openHighlightPop.timer = setTimeout(() => {
      const id = $('#hlPop').dataset.hid;
      if (!id) return;
      updateHighlight(id, { note: $('#popNote').value });
      const mark = $(`#rBody mark.hl[data-hid="${id}"]`);
      if (mark) mark.title = $('#popNote').value;
    }, 350);
  });
  $('#hlPop').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const h = (R.hl.find((x) => x.id === $('#hlPop').dataset.hid)) || highlightById($('#hlPop').dataset.hid);
    if (!h) return;
    if (act === 'copy') copyText(h.quote);
    if (act === 'read') { hideHighlightPop(); ttsSelect(h.start, true); }
    if (act === 'del') {
      hideHighlightPop();
      const bookId = h.book;
      R.hl = R.hl.filter((x) => x.id !== h.id);
      if (bookId) deleteHighlight({ ...h, book: bookId });
      paintHighlights();
    }
  });

  $('#rScroll').addEventListener('scroll', () => {
    if (!isOpen || !R.ready) return;
    updateProgressBar();
    if (scrollLocked) return;
    if (R.scrollFrame) return;
    R.scrollFrame = requestAnimationFrame(() => {
      R.scrollFrame = null;
      queueProgress(R.ch, currentRatio());
    });
  }, { passive: true });
  $('#rScroll').addEventListener('wheel', () => { scrollLocked = true; }, { passive: true });
  $('#rScroll').addEventListener('touchmove', () => { scrollLocked = true; }, { passive: true });
}

function bindFileDrop() {
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    dragDepth++;
    showEl($('#dropzone'));
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) hideEl($('#dropzone'), MOTION.base);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    hideEl($('#dropzone'), MOTION.base);
    const files = Array.from(e.dataTransfer?.files || []);
    const zip = files.find((f) => /\.zip$/i.test(f.name));
    if (zip && files.length === 1) restoreBackup(zip);
    else importBooks(files);
  });

  document.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', () => {
    if (TTS.supported) { try { window.speechSynthesis.cancel(); } catch (_) { /* ignore */ } }
    if (!isOpen || !R.id) return;
    try {
      navigator.sendBeacon('/api/progress?t=' + encodeURIComponent(TOKEN), new Blob([JSON.stringify({ book: R.id, ch: R.ch, ratio: currentRatio() })], { type: 'application/json' }));
    } catch (_) { /* ignore */ }
  });
}
