/* Yolala's LN Reader - the side drawers and how they open and close. */
'use strict';

function showDrawer(panel) {
  showEl(panel);
  void panel.offsetWidth;
  panel.classList.add('open');
}

function hideDrawer(panel) {
  if (panel.hidden) return;
  panel.classList.remove('open');
  hideEl(panel, MOTION.drawer);
}

function closePanels() {
  $$('.drawer').forEach(hideDrawer);
  hideEl($('#help'), MOTION.fast);
  closeMenu();
}

function togglePanel(id) {
  const panel = $('#' + id);
  const wasOpen = !panel.hidden && panel.classList.contains('open');
  closePanels();
  if (wasOpen) return;
  showDrawer(panel);
  if (id === 'dToc') { $('#tocFilter').value = ''; filterToc(''); }
  if (id === 'dTts') { ttsLoadVoices(); ttsSyncUI(); if (TTS.engine === 'piper') ttsPiperWarm(); }
  if (id === 'dFind') {
    setTimeout(() => $('#findInput').focus(), 30);
    if ($('#findInput').value.trim()) findInBook(); else renderFindHighlights();
  }
  if (id === 'dSearch') {
    setTimeout(() => $('#libSearchAll').focus(), 30);
    searchAllBooks($('#libSearchAll').value.trim());
  }
}

/* ------------------------------------------------------------ drop menus -- */
function closeMenu() {
  hideEl($('#exportMenu'), MOTION.fast);
}

function toggleMenu(id) {
  const menu = $('#' + id);
  const wasOpen = isShown(menu);
  closeMenu();
  if (wasOpen) return;
  showEl(menu);
}
