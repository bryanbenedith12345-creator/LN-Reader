/**
 * LN Reader — Backup & Restore Subsystem (JSZip Archive Integration)
 * Modular Subsystem: js/backup.js
 */

(function () {
  'use strict';

  window.LNReader = window.LNReader || {};

  const Backup = {
    async exportBackup() {
      const state = window.LNReader.state;
      const Storage = window.LNReader.Storage;
      const showToast = window.LNReader.Utils.showToast;

      try {
        const books = await Storage.getAllBooks();
        if (!books.length) {
          showToast('Library is empty. Nothing to export.');
          return;
        }

        showToast('Compiling library backup archive...');
        const zip = new JSZip();

        // 1. Comprehensive manifest metadata
        const manifest = {
          app: 'LN-EPUB-Reader-Pro',
          version: '2.5.0',
          exportedAt: new Date().toISOString(),
          settings: state.settings,
          books: books.map(b => ({
            id: b.id,
            title: b.title,
            author: b.author,
            description: b.description,
            coverUrl: b.coverUrl,
            fileName: b.fileName,
            fileSize: b.fileSize,
            fileHash: b.fileHash,
            progress: b.progress,
            scrollTop: b.scrollTop,
            scrollRatio: b.scrollRatio,
            currentCfi: b.currentCfi,
            currentChapter: b.currentChapter,
            status: b.status,
            isFavorite: b.isFavorite,
            bookmarks: b.bookmarks || [],
            highlights: b.highlights || [],
            readingSeconds: b.readingSeconds || 0,
            addedAt: b.addedAt,
            lastReadAt: b.lastReadAt
          }))
        };

        zip.file('manifest.json', JSON.stringify(manifest, null, 2));

        // 2. Binary EPUB files stored cleanly in epubs/
        const epubsFolder = zip.folder('epubs');
        for (const book of books) {
          if (book.fileBlob) {
            const arrayBuffer = await book.fileBlob.arrayBuffer();
            const safeName = `${book.id}_${(book.fileName || 'book.epub').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
            epubsFolder.file(safeName, arrayBuffer);
          }
        }

        // 3. Generate downloadable ZIP
        const contentBlob = await zip.generateAsync({
          type: 'blob',
          compression: 'DEFLATE',
          compressionOptions: { level: 6 }
        });

        const dateStr = new Date().toISOString().slice(0, 10);
        const fileName = `LN_Reader_Backup_${dateStr}.zip`;

        const a = document.createElement('a');
        a.href = URL.createObjectURL(contentBlob);
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);

        showToast(`Exported ${books.length} book(s) to ${fileName}`);
      } catch (err) {
        console.error('Backup export error:', err);
        showToast('Export failed: ' + (err.message || 'Unknown error'));
      }
    },

    async restoreBackup(file) {
      const state = window.LNReader.state;
      const Storage = window.LNReader.Storage;
      const UI = window.LNReader.UI;
      const showToast = window.LNReader.Utils.showToast;

      try {
        showToast('Reading backup archive...');
        const zip = await JSZip.loadAsync(file);

        const manifestFile = zip.file('manifest.json');
        if (!manifestFile) {
          showToast('Invalid backup file: manifest.json not found.');
          return;
        }

        const manifestText = await manifestFile.async('text');
        const manifest = JSON.parse(manifestText);

        if (!manifest.books || !Array.isArray(manifest.books)) {
          showToast('Invalid backup: No book records found.');
          return;
        }

        // Restore Settings if present
        if (manifest.settings) {
          state.settings = Object.assign({}, window.LNReader.DEFAULT_SETTINGS, manifest.settings);
          Storage.saveSettings(state.settings);
          if (UI) UI.applySettingsToDOM();
        }

        let restoredCount = 0;
        const epubsFolder = zip.folder('epubs');

        for (const record of manifest.books) {
          try {
            let bookBlob = null;
            if (epubsFolder) {
              const matchedZipFile = epubsFolder.file(new RegExp(`^${record.id}_`));
              if (matchedZipFile && matchedZipFile.length > 0) {
                const arrayBuffer = await matchedZipFile[0].async('arraybuffer');
                bookBlob = new Blob([arrayBuffer], { type: 'application/epub+zip' });
              }
            }

            if (!bookBlob) {
              const existing = await Storage.getBook(record.id);
              if (existing && existing.fileBlob) {
                bookBlob = existing.fileBlob;
              }
            }

            if (!bookBlob) {
              console.warn(`Skipping book "${record.title}": binary EPUB missing in backup archive.`);
              continue;
            }

            const restoredBook = Storage.normalizeBookRecord(Object.assign({}, record, {
              fileBlob: bookBlob
            }));

            await Storage.saveBook(restoredBook);
            restoredCount++;
          } catch (itemErr) {
            console.error(`Failed to restore book "${record.title}":`, itemErr);
          }
        }

        if (UI) await UI.loadAndRenderLibrary();
        showToast(`Successfully restored ${restoredCount} book(s) from backup!`);
      } catch (err) {
        console.error('Backup restore error:', err);
        showToast('Restore failed: ' + (err.message || 'Corrupt archive'));
      }
    }
  };

  window.LNReader.Backup = Backup;
})();
