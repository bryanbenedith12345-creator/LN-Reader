/* Yolala's LN Reader - adding books, making backups and restoring them. */
'use strict';

async function importBooks(files) {
  const books = Array.from(files).filter((f) => /\.epub$/i.test(f.name));
  if (!books.length) return toast('Choose EPUB files to add');
  toast(`Adding ${books.length} book${books.length === 1 ? '' : 's'}…`, { timeout: 60000 });
  let added = 0, failed = 0;
  for (const file of books) {
    try {
      await api('/api/import?name=' + encodeURIComponent(file.name), {
        method: 'POST', headers: { 'Content-Type': 'application/epub+zip' }, body: file,
      });
      added++;
    } catch (err) {
      failed++;
      console.error(file.name, err);
    }
  }
  await loadLibrary();
  toast(`${added} book${added === 1 ? '' : 's'} added${failed ? ` · ${failed} failed` : ''}`, { timeout: 5200 });
}

async function backupLibrary() {
  try {
    const result = await postJSON('/api/backup', {});
    toast(`Backup saved · ${result.name}`, {
      timeout: 9000,
      action: { label: 'Show file', fn: () => postJSON('/api/reveal', { path: result.path }).catch(() => {}) },
    });
  } catch (err) {
    toast('Backup failed: ' + err.message);
  }
}

async function restoreBackup(file) {
  if (!file) return;
  toast('Restoring backup…', { timeout: 60000 });
  try {
    const result = await api('/api/import-backup', {
      method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: file,
    });
    await loadLibrary();
    toast(`Restored ${result.imported} book${result.imported === 1 ? '' : 's'} and your reading history`);
  } catch (err) {
    toast('Restore failed: ' + err.message);
  }
}
