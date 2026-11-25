/* Yolala's LN Reader - keyboard shortcuts. */
'use strict';

function onKey(e) {
  if (isShown($('#lightbox'))) {
    if (e.key === 'Escape') { closeLightbox(); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepLightbox(-1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); stepLightbox(1); return; }
    return;
  }
  const tag = e.target.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
  if (e.key === 'Escape') {
    if (isShown($('#voiceLib'))) { hideEl($('#voiceLib'), MOTION.fast); return; }
    if (isShown($('#help'))) { hideEl($('#help'), MOTION.fast); return; }
    if (isShown($('#bookInfo'))) { closeBookInfo(); return; }
    if (isShown($('#hlPop'))) { hideHighlightPop(); return; }
    if (isShown($('#selBar'))) { hideSelBar(); return; }
    const openDrawer = $$('.drawer').find((d) => !d.hidden);
    if (openDrawer) { hideDrawer(openDrawer); return; }
    if (isShown($('#ttsDock'))) { ttsHide(); return; }
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
    if (e.key === '?') { closePanels(); showEl($('#help')); }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); togglePanel('dFind'); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); goChapter(-1); return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); goChapter(1); return; }
  if (e.key === 't' || e.key === 'T') { togglePanel('dToc'); return; }
  if (e.key === 'i' || e.key === 'I') { openBookInfo(R.id); return; }
  if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) { toggleFavorite(R.id); return; }
  if ((e.key === 'v' || e.key === 'V') && !e.ctrlKey && !e.metaKey && !e.altKey) { ttsStartHere(); return; }
  if (e.key === '?') { closePanels(); showEl($('#help')); return; }
  if (e.key === '+' || e.key === '=') { updateSetting('size', clamp(effectiveSettings().size + 1, 15, 27)); return; }
  if (e.key === '-' || e.key === '_') { updateSetting('size', clamp(effectiveSettings().size - 1, 15, 27)); return; }
}
