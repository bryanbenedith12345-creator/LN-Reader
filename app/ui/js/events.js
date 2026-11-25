/* Yolala's LN Reader - bindings for the shell, the shelf and the list views. */
'use strict';

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
  $('#btnShortcuts').onclick = () => { closePanels(); showEl($('#help')); };
  $('#btnSearchAll').onclick = () => togglePanel('dSearch');
  bindExportMenu();

  $('#libSearch').addEventListener('input', renderLibrary);
  $('#libSort').addEventListener('change', () => {
    localStorage.setItem('ln.sort', $('#libSort').value);
    renderLibrary();
  });
  $('#grid').addEventListener('click', (e) => {
    const fav = e.target.closest('[data-fav]');
    if (fav) {
      e.stopPropagation();
      toggleFavorite(fav.dataset.fav);
      return;
    }
    const info = e.target.closest('[data-info]');
    if (info) {
      e.stopPropagation();
      openBookInfo(info.dataset.info);
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      const book = bookById(del.dataset.del);
      if (book) confirmDelete(book);
      return;
    }
    const pick = e.target.closest('[data-pick]');
    if (pick) { e.stopPropagation(); return; }
    const card = e.target.closest('.card');
    if (!card) return;
    if (selectMode) togglePick(card.dataset.id);
    else openBook(card.dataset.id);
  });
  $('#grid').addEventListener('change', (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) togglePick(pick.dataset.pick);
  });
  $('#grid').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.card');
    if (!card) return;
    e.preventDefault();
    if (selectMode) togglePick(card.dataset.id);
    else openBook(card.dataset.id);
  });
  $('#continueWrap').addEventListener('click', (e) => {
    const node = e.target.closest('[data-id]');
    if (node) openBook(node.dataset.id);
  });

  /* highlights */
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

  /* panels */
  $$('[data-close]').forEach((btn) => btn.addEventListener('click', () => {
    const box = btn.closest('.drawer, .modal');
    if (box.classList.contains('drawer')) hideDrawer(box); else hideEl(box, MOTION.fast);
  }));
  $('#help').addEventListener('click', (e) => { if (e.target.id === 'help') hideEl($('#help'), MOTION.fast); });
  document.addEventListener('mousedown', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (target && !target.closest('#exportMenu, #btnExport')) closeMenu();
    if (target && !target.closest('.drawer, .modal, #ttsDock, #rFind, #rChapterBtn, #rSettings, #btnSearchAll') && $$('.drawer').some((d) => !d.hidden)) {
      closePanels();
    }
  });

  /* reading settings */
  $('#fontSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-font]');
    if (btn) updateSetting('font', btn.dataset.font);
  });
  $('#setSize').addEventListener('input', (e) => updateSetting('size', Number(e.target.value)));
  $('#setLh').addEventListener('input', (e) => updateSetting('lh', Number(e.target.value)));
  $('#setWidth').addEventListener('input', (e) => updateSetting('width', Number(e.target.value)));
  $('#setJustify').addEventListener('change', (e) => updateSetting('justify', e.target.checked, false));
  $('#setScope').addEventListener('change', (e) => toggleScope(e.target.checked));
  $('#setReset').onclick = () => {
    if (scope === 'book' && R.id) {
      // clear only this book's override, leave the shared settings alone
      const book = bookById(R.id);
      if (book) book.settings = {};
      postJSON('/api/book-settings', { book: R.id, settings: null }).catch(() => {});
      toggleScope(false);
    } else {
      S.settings = { ...DEFAULTS };
      applySettings();
    }
    requestAnimationFrame(() => restoreScroll(currentRatio()));
  };

  bindBookInfo();
  bindShelves();
  bindBatch();
}

