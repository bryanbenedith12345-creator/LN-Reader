/* Yolala's LN Reader - keyboard shortcuts and UI bindings.
   Classic script: loaded in order from index.html; shared globals. */
'use strict';

/* ------------------------------------------------------------------ events -- */
function bindUI() {
  $('#nav').addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-btn');
    if (btn) setView(btn.dataset.view);
  });

  $('#btnAdd').onclick = () => $('#fileEpub').click();
  $('#btnAdd2').onclick = () => $('#fileEpub').click();
  $('#fileEpub').onchange = (e) => { importBooks(e.target.files); e.target.value = ''; };
  $('#btnBackup').onclick = backupLibrary;
  $('#btnRestore').onclick = () => $('#fileBackup').click();
  $('#fileBackup').onchange = (e) => { restoreBackup(e.target.files[0]); e.target.value = ''; };
  $('#btnShortcuts').onclick = () => { closePanels(); $('#help').hidden = false; };

  $('#libSearch').addEventListener('input', renderLibrary);
  $('#libSort').addEventListener('change', () => {
    localStorage.setItem('ln.sort', $('#libSort').value);
    renderLibrary();
  });
  $('#grid').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      const book = S.books.find((b) => b.id === del.dataset.del);
      if (book) confirmDelete(book);
      return;
    }
    const card = e.target.closest('.card');
    if (card) openBook(card.dataset.id);
  });
  $('#grid').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.card');
    if (card) { e.preventDefault(); openBook(card.dataset.id); }
  });
  $('#continueWrap').addEventListener('click', (e) => {
    const node = e.target.closest('[data-id]');
    if (node) openBook(node.dataset.id);
  });

  $('#hlSearch').addEventListener('input', renderHighlights);
  $('#hlBook').addEventListener('change', () => { renderHighlightFilters(); renderHighlights(); });
  $('#hlColors').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    hlColorFilter = chip.dataset.color;
    renderHighlightFilters();
    renderHighlights();
  });
  $('#hlList').addEventListener('click', (e) => {
    const row = e.target.closest('.hl-row');
    if (!row) return;
    const h = highlightById(row.dataset.hid);
    if (!h) return;
    if (e.target.closest('[data-act="copy"]')) { copyText(h.quote); return; }
    if (e.target.closest('[data-act="delete"]')) { deleteHighlight(h); return; }
    const selection = window.getSelection();
    if (e.target.closest('[data-open]') && (!selection || selection.isCollapsed)) openBook(h.book, h.ch, { flash: h.id });
  });

  // reader chrome
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
  $('#rBookmark').onclick = toggleBookmark;
  $('#rTheme').onclick = toggleSepia;
  $('#btnSepia').onclick = toggleSepia;
  $('#lbClose').onclick = closeLightbox;
  $('#lbSave').onclick = saveLightboxImage;
  $('#lbPrev').onclick = () => stepLightbox(-1);
  $('#lbNext').onclick = () => stepLightbox(1);
  $('#lbStage').addEventListener('click', (e) => { if (e.target.id === 'lbStage') closeLightbox(); });
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

  $$('[data-close]').forEach((btn) => btn.addEventListener('click', () => {
    const box = btn.closest('.drawer, .modal');
    if (box.classList.contains('drawer')) hideDrawer(box); else box.hidden = true;
  }));
  $('#help').addEventListener('click', (e) => { if (e.target.id === 'help') $('#help').hidden = true; });

  // reading settings
  $('#fontSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-font]');
    if (btn) updateSetting('font', btn.dataset.font);
  });
  $('#setSize').addEventListener('input', (e) => updateSetting('size', Number(e.target.value)));
  $('#setLh').addEventListener('input', (e) => updateSetting('lh', Number(e.target.value)));
  $('#setWidth').addEventListener('input', (e) => updateSetting('width', Number(e.target.value)));
  $('#setJustify').addEventListener('change', (e) => updateSetting('justify', e.target.checked, false));
  $('#setReset').onclick = () => { S.settings = { ...DEFAULTS }; applySettings(); requestAnimationFrame(() => restoreScroll(currentRatio())); };

  // selection + highlights
  $('#selColors').innerHTML = COLORS.map((c) => `<button class="sw" data-c="${c.id}" title="${c.name}"></button>`).join('');
  $('#selColors').addEventListener('mousedown', (e) => e.preventDefault());
  $('#selColors').addEventListener('click', (e) => {
    const btn = e.target.closest('.sw');
    if (!btn) return;
    addHighlight(btn.dataset.c);
    // keep the toolbar in place if the user wants another colour
    if (pendingSel) { /* nothing */ }
  });
  $('#selCopy').addEventListener('mousedown', (e) => e.preventDefault());
  $('#selCopy').onclick = () => {
    if (!pendingSel) return;
    copyText(pendingSel.quote);
    hideSelBar();
  };
  document.addEventListener('mousedown', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target || !target.closest('#selBar, #hlPop')) hideSelBar();
    if (!target || !target.closest('#hlPop')) hideHighlightPop();
    if (target && !target.closest('.drawer, .modal, #ttsDock, #rFind, #rChapterBtn, #rSettings') && $$('.drawer').some((d) => !d.hidden)) closePanels();
  });
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

  // scroll + navigation
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

  // drag & drop
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    dragDepth++;
    $('#dropzone').hidden = false;
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $('#dropzone').hidden = true;
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('#dropzone').hidden = true;
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
      navigator.sendBeacon('/api/progress', new Blob([JSON.stringify({ book: R.id, ch: R.ch, ratio: currentRatio() })], { type: 'application/json' }));
    } catch (_) { /* ignore */ }
  });
}

function onKey(e) {
  if (!$('#lightbox').hidden) {
    if (e.key === 'Escape') { closeLightbox(); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepLightbox(-1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); stepLightbox(1); return; }
    return;
  }
  const tag = e.target.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
  if (e.key === 'Escape') {
    if (!$('#help').hidden) { $('#help').hidden = true; return; }
    if (!$('#hlPop').hidden) { hideHighlightPop(); return; }
    if (!$('#selBar').hidden) { hideSelBar(); return; }
    const openDrawer = $$('.drawer').find((d) => !d.hidden);
    if (openDrawer) { hideDrawer(openDrawer); return; }
    if (!$('#ttsDock').hidden) { ttsHide(); return; }
    if (typing) { e.target.blur(); return; }
    if (isOpen) closeReader();
    return;
  }
  if (typing) {
    if (isOpen && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      togglePanel('dFind');
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    backupLibrary();
    return;
  }
  if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    toggleSepia();
    return;
  }
  if (!isOpen) {
    if (e.key === '?') { closePanels(); $('#help').hidden = false; }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); togglePanel('dFind'); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); goChapter(-1); return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); goChapter(1); return; }
  if (e.key === 't' || e.key === 'T') { togglePanel('dToc'); return; }
  if ((e.key === 'b' || e.key === 'B') && !e.ctrlKey && !e.metaKey) { toggleBookmark(); return; }
  if ((e.key === 'v' || e.key === 'V') && !e.ctrlKey && !e.metaKey && !e.altKey) { ttsStartHere(); return; }
  if (e.key === '?' ) { closePanels(); $('#help').hidden = false; return; }
  if (e.key === '+' || e.key === '=') { updateSetting('size', clamp(S.settings.size + 1, 15, 27)); return; }
  if (e.key === '-' || e.key === '_') { updateSetting('size', clamp(S.settings.size - 1, 15, 27)); return; }
}
