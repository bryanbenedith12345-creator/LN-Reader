/* Yolala's LN Reader - exporting highlights and notes out of the library. */
'use strict';

async function exportNotes(format, bookId) {
  closeMenu();
  toast('Preparing export…');
  try {
    const result = await postJSON('/api/export-notes', { format, book: bookId || '' });
    if (result.saved) {
      const name = String(result.path).split(/[\\/]/).pop();
      toast('Exported · ' + name);
    } else {
      toast('Export cancelled');
    }
  } catch (err) {
    // No native dialog available: fall back to a plain download.
    const params = new URLSearchParams({ format });
    if (bookId) params.set('book', bookId);
    const link = document.createElement('a');
    link.href = '/api/export-notes?' + params.toString();
    link.download = '';
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast('Downloading ' + String(format).toUpperCase() + '…');
  }
}

function bindExportMenu() {
  const button = $('#btnExport');
  if (!button) return;
  button.onclick = (e) => { e.stopPropagation(); toggleMenu('exportMenu'); };
  $('#exportMenu').addEventListener('click', (e) => {
    const item = e.target.closest('[data-fmt]');
    if (!item) return;
    const scopeItem = item.dataset.scope || 'all';
    const bookId = scopeItem === 'book' && $('#hlBook').value ? $('#hlBook').value : '';
    exportNotes(item.dataset.fmt, bookId);
  });
}
