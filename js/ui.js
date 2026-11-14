/**
 * LN Reader — User Interface, Navigation & Interaction Subsystem
 * Modular Subsystem: js/ui.js
 */

(function () {
  'use strict';

  window.LNReader = window.LNReader || {};

  const UI = {
    _lastActiveElement: null,
    _settingsTriggerElement: null,
    _releaseSettingsTrap: null,
    _lightboxState: { scale: 1, posX: 0, posY: 0, isDragging: false, startX: 0, startY: 0 },

    init() {
      const Reader = window.LNReader.Reader;
      this.bindDOMEvents();
      this.bindLightboxEvents();
      this.applySettingsToDOM();
      this.initBackendBridge();
      if (Reader) Reader.init();
      this.loadAndRenderLibrary(true);
    },

    syncTitlebarTheme(canvasTheme, chromeTheme) {
      const state = window.LNReader.state;
      const cTheme = canvasTheme || (state && state.settings ? state.settings.canvasTheme : 'warm');
      const chTheme = chromeTheme || (state && state.settings ? state.settings.chromeTheme : 'light');
      if (window.pywebview && window.pywebview.api && window.pywebview.api.set_theme) {
        window.pywebview.api.set_theme(cTheme, chTheme).catch(() => {});
      }
    },

    async loadAndRenderLibrary(autoResume = false) {
      const state = window.LNReader.state;
      const Storage = window.LNReader.Storage;
      const Reader = window.LNReader.Reader;

      try {
        state.books = await Storage.getAllBooks();
        if (state.books.length === 0) {
          await this.scanAndImportLocalBooks();
          state.books = await Storage.getAllBooks();
        }
        this.renderBooks();
        this.updateStats();

        if (autoResume && state.settings.lastOpenedBookId) {
          const lastBook = state.books.find(b => b.id === state.settings.lastOpenedBookId);
          if (lastBook && Reader) Reader.openBook(lastBook);
        }
      } catch (err) {
        console.error('Failed to load library:', err);
      }
    },

    initBackendBridge() {
      // Quiet background backend connection, initial memory trim and titlebar theme sync
      window.addEventListener('pywebviewready', () => {
        const state = window.LNReader.state;
        if (window.pywebview && window.pywebview.api) {
          if (window.pywebview.api.trim_memory) {
            window.pywebview.api.trim_memory().catch(() => {});
          }
          if (window.pywebview.api.set_theme && state && state.settings) {
            window.pywebview.api.set_theme(state.settings.canvasTheme, state.settings.chromeTheme).catch(() => {});
          }
        }
      });
    },

    async scanAndImportLocalBooks() {
      const Storage = window.LNReader.Storage;
      try {
        let localBooks = [];
        if (window.pywebview && window.pywebview.api && window.pywebview.api.scan_local_books) {
          localBooks = await window.pywebview.api.scan_local_books();
        } else {
          const resp = await fetch('/api/library/books');
          if (resp.ok) {
            const data = await resp.json();
            localBooks = data.books || [];
          }
        }
        if (!Array.isArray(localBooks)) return;
        for (const bk of localBooks) {
          try {
            const fileResp = await fetch(bk.url || ('/' + encodeURIComponent(bk.fileName)));
            if (!fileResp.ok) continue;
            const blob = await fileResp.blob();
            const record = Storage.normalizeBookRecord({
              id: bk.id || ('book_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)),
              title: bk.title || bk.fileName,
              author: bk.author || 'Unknown Author',
              description: bk.description || '',
              coverUrl: bk.coverUrl || null,
              fileBlob: blob,
              fileName: bk.fileName,
              fileSize: bk.fileSize || blob.size,
              fileHash: bk.fileName,
              progress: 0,
              scrollTop: 0,
              scrollRatio: 0,
              currentCfi: null,
              currentChapter: '',
              status: 'unread',
              isFavorite: false,
              readingSeconds: 0,
              createdAt: Date.now(),
              lastReadAt: Date.now()
            });
            await Storage.saveBook(record);
          } catch (err) {
            console.warn('Failed to import local book', bk.fileName, err);
          }
        }
      } catch (err) {}
    },

    getFilteredAndSortedBooks() {
      const state = window.LNReader.state;
      let filtered = state.books.slice();

      if (state.activeFilter === 'reading') {
        filtered = filtered.filter(b => (b.progress > 0 && b.progress < 0.99) || b.status === 'reading');
      } else if (state.activeFilter === 'completed') {
        filtered = filtered.filter(b => b.progress >= 0.99 || b.status === 'completed');
      } else if (state.activeFilter === 'favorites') {
        filtered = filtered.filter(b => !!b.isFavorite);
      }

      if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        filtered = filtered.filter(b =>
          (b.title && b.title.toLowerCase().includes(q)) ||
          (b.author && b.author.toLowerCase().includes(q))
        );
      }

      const reverse = !!(state.settings && state.settings.sortAsc);
      filtered.sort((a, b) => {
        let res = 0;
        if (state.sortBy === 'recent') res = (b.lastReadAt || 0) - (a.lastReadAt || 0);
        else if (state.sortBy === 'title') res = (a.title || '').localeCompare(b.title || '');
        else if (state.sortBy === 'author') res = (a.author || '').localeCompare(b.author || '');
        else if (state.sortBy === 'progress') res = (b.progress || 0) - (a.progress || 0);
        else if (state.sortBy === 'size') res = (b.fileSize || 0) - (a.fileSize || 0);
        return reverse ? -res : res;
      });

      return filtered;
    },

    renderBooks() {
      const state = window.LNReader.state;
      const filtered = this.getFilteredAndSortedBooks();
      const countLabel = document.getElementById('library-count-text');
      const emptyZone = document.getElementById('library-empty');
      const grid = document.getElementById('books-grid');
      const tableWrap = document.getElementById('books-table-wrap');

      const filterSuffix = state.activeFilter !== 'all' ? ` (${state.activeFilter})` : '';
      if (countLabel) {
        countLabel.textContent = `${filtered.length} ${filtered.length === 1 ? 'book' : 'books'}${filterSuffix}`;
      }

      if (filtered.length === 0) {
        if (grid) grid.innerHTML = '';
        if (tableWrap) tableWrap.classList.add('hidden');
        if (emptyZone) emptyZone.classList.remove('hidden');
        return;
      }

      if (emptyZone) emptyZone.classList.add('hidden');

      if (state.settings.viewMode === 'list') {
        if (grid) grid.classList.add('hidden');
        if (tableWrap) tableWrap.classList.remove('hidden');
        this.renderTableView(filtered);
      } else {
        if (tableWrap) tableWrap.classList.add('hidden');
        if (grid) grid.classList.remove('hidden');
        this.renderGridView(filtered);
      }
    },

    renderGridView(books) {
      const grid = document.getElementById('books-grid');
      const Utils = window.LNReader.Utils;
      const Reader = window.LNReader.Reader;
      if (!grid) return;
      grid.innerHTML = '';

      books.forEach(book => {
        const card = document.createElement('article');
        card.className = 'book-card';
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', `${book.title} by ${book.author}`);

        const pct = Math.min(100, Math.max(0, Math.round((book.progress || 0) * 100)));
        const isCompleted = book.status === 'completed' || pct >= 99;

        const coverHtml = book.coverUrl
          ? `<img src="${book.coverUrl}" alt="Cover" class="book-cover-img" loading="lazy">`
          : `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:12px;text-align:center;">
               <span class="font-semibold text-sm">${Utils.escapeHtml(book.title)}</span>
               <span class="text-xs text-muted" style="margin-top:4px;">${Utils.escapeHtml(book.author)}</span>
             </div>`;

        const statusBadgeHtml = isCompleted
          ? `<span class="badge badge-completed">Done</span>`
          : (pct > 0 ? `<span class="badge badge-reading">${pct}%</span>` : `<span class="badge badge-unread">Unread</span>`);

        const favClass = book.isFavorite ? 'favorited' : '';

        card.innerHTML = `
          <div class="book-cover-container">
            ${coverHtml}
            ${book.isFavorite ? `
              <span class="book-star-badge" title="Favorite">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="var(--star-gold)" stroke="var(--star-gold)" stroke-width="1.5">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
              </span>` : ''}
            <div class="card-hover-actions">
              <button class="card-action-btn card-favorite-btn ${favClass}" title="Toggle Favorite" data-fav-id="${book.id}" aria-label="Favorite">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="${book.isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              </button>
              <button class="card-action-btn btn-info-book" title="Book Details" data-info-id="${book.id}" aria-label="Book Details">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
              </button>
              <button class="card-action-btn btn-delete-book" title="Remove Book" data-del-id="${book.id}" aria-label="Remove Book">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
              </button>
            </div>
            <button class="card-touch-btn btn-info-book" title="Book Options" data-info-id="${book.id}" aria-label="Book Options">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="12" cy="12" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="12" cy="19" r="2"/></svg>
            </button>
          </div>
          <div class="book-info-block">
            <h4 class="book-title-text" title="${Utils.escapeHtml(book.title)}">${Utils.escapeHtml(book.title)}</h4>
            <span class="book-author-text" title="${Utils.escapeHtml(book.author)}">${Utils.escapeHtml(book.author)}</span>
            <div class="book-meta-row">
              ${statusBadgeHtml}
              <span class="text-xs text-muted">${pct}%</span>
            </div>
            <div class="card-progress-bar">
              <div class="card-progress-fill" style="width: ${pct}%"></div>
            </div>
          </div>
        `;

        card.addEventListener('click', (e) => {
          if (e.target.closest('.btn-delete-book') || e.target.closest('.card-favorite-btn') || e.target.closest('.btn-info-book')) return;
          if (Reader) Reader.openBook(book);
        });

        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && Reader) Reader.openBook(book);
        });

        grid.appendChild(card);
      });
    },

    renderTableView(books) {
      const tbody = document.getElementById('books-table-body');
      const Utils = window.LNReader.Utils;
      const Reader = window.LNReader.Reader;
      if (!tbody) return;
      tbody.innerHTML = '';

      books.forEach(book => {
        const tr = document.createElement('tr');
        const pct = Math.min(100, Math.max(0, Math.round((book.progress || 0) * 100)));
        const favClass = book.isFavorite ? 'favorited' : '';

        const coverThumb = book.coverUrl
          ? `<img src="${book.coverUrl}" class="table-cover-thumb" alt="">`
          : `<div class="table-cover-thumb" style="display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;color:var(--text-muted)">EPUB</div>`;

        tr.innerHTML = `
          <td style="width:32px;text-align:center;">
            <button class="icon-btn-inline table-fav-btn ${favClass}" data-fav-id="${book.id}" title="Favorite">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="${book.isFavorite ? 'var(--star-gold)' : 'none'}" stroke="${book.isFavorite ? 'var(--star-gold)' : 'currentColor'}" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            </button>
          </td>
          <td style="width:44px;">${coverThumb}</td>
          <td>
            <div style="font-weight:600;color:var(--text-main);">${Utils.escapeHtml(book.title)}</div>
            <div style="font-size:0.76rem;color:var(--text-secondary);">${Utils.escapeHtml(book.author)}</div>
          </td>
          <td style="width:140px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <div class="card-progress-bar" style="flex:1;margin:0;">
                <div class="card-progress-fill" style="width:${pct}%"></div>
              </div>
              <span style="font-size:0.75rem;font-variant-numeric:tabular-nums;min-width:32px;text-align:right;">${pct}%</span>
            </div>
          </td>
          <td style="width:90px;">
            <span class="badge ${book.status === 'completed' ? 'badge-completed' : (pct > 0 ? 'badge-reading' : 'badge-unread')}">${book.status}</span>
          </td>
          <td style="font-size:0.78rem;color:var(--text-muted);">${Utils.formatDate(book.lastReadAt)}</td>
          <td style="font-size:0.78rem;color:var(--text-muted);">${Utils.formatBytes(book.fileSize)}</td>
          <td style="width:70px;text-align:right;">
            <button class="icon-btn-inline btn-info-book" title="Details" data-info-id="${book.id}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            </button>
            <button class="icon-btn-inline btn-delete-book" title="Delete" data-del-id="${book.id}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </td>
        `;

        tr.addEventListener('click', (e) => {
          if (e.target.closest('.btn-delete-book') || e.target.closest('.table-fav-btn') || e.target.closest('.btn-info-book')) return;
          if (Reader) Reader.openBook(book);
        });

        tbody.appendChild(tr);
      });
    },

    async toggleFavorite(bookId) {
      const state = window.LNReader.state;
      const Storage = window.LNReader.Storage;
      const showToast = window.LNReader.Utils.showToast;
      const book = state.books.find(b => b.id === bookId);
      if (!book) return;
      book.isFavorite = !book.isFavorite;
      await Storage.saveBook(book);
      this.renderBooks();
      showToast(book.isFavorite ? `Added "${book.title}" to Favorites ★` : `Removed from Favorites`);
    },

    showBookDetails(bookId) {
      const state = window.LNReader.state;
      const Utils = window.LNReader.Utils;
      const Reader = window.LNReader.Reader;
      const book = state.books.find(b => b.id === bookId);
      if (!book) return;

      const modal = document.getElementById('modal-book-details');
      const content = document.getElementById('book-details-content');
      document.getElementById('modal-book-title').textContent = book.title;

      const coverHtml = book.coverUrl
        ? `<img style="width:110px;height:160px;object-fit:cover;border-radius:var(--radius-sm);box-shadow:var(--shadow-card);" src="${book.coverUrl}" alt="${Utils.escapeHtml(book.title)}">`
        : `<div style="width:110px;height:160px;display:flex;align-items:center;justify-content:center;background:var(--bg-subtle);border-radius:var(--radius-sm);font-size:0.8rem;color:var(--text-muted);">No Cover</div>`;

      content.innerHTML = `
        <div style="display:flex;gap:18px;">
          ${coverHtml}
          <div style="flex:1;display:flex;flex-direction:column;gap:6px;">
            <h4 style="font-size:1rem;font-weight:600;">${Utils.escapeHtml(book.title)}</h4>
            <div class="text-secondary text-sm">${Utils.escapeHtml(book.author)}</div>
            <div style="font-size:0.8125rem;line-height:1.5;color:var(--text-secondary);max-height:80px;overflow-y:auto;margin-top:4px;">
              ${Utils.escapeHtml(book.description || 'No description provided in book metadata.')}
            </div>
            <div class="stats-grid-4" style="margin-top:6px;">
              <div class="stat-box"><span class="stat-label">Progress</span><span class="stat-value">${Math.round((book.progress || 0) * 100)}%</span></div>
              <div class="stat-box"><span class="stat-label">Reading Time</span><span class="stat-value">${Utils.formatDuration(book.readingSeconds)}</span></div>
            </div>
          </div>
        </div>
        <div style="font-size:0.78rem;color:var(--text-muted);display:flex;flex-direction:column;gap:3px;padding:8px 12px;background:var(--bg-subtle);border-radius:var(--radius-sm);margin-top:14px;">
          <div><strong>File:</strong> ${Utils.escapeHtml(book.fileName)} (${Utils.formatBytes(book.fileSize)})</div>
          <div><strong>Last Read:</strong> ${Utils.formatDate(book.lastReadAt)}</div>
        </div>
        <div class="modal-footer" style="padding:12px 0 0 0;margin-top:14px;">
          <button class="btn btn-ghost" id="btn-details-close">Close</button>
          <button class="btn btn-primary" id="btn-details-read">Read Book</button>
        </div>
      `;

      this._lastActiveElement = document.activeElement;
      modal.classList.remove('hidden');
      const releaseTrap = Utils.trapFocus(modal);

      const closeModal = () => {
        releaseTrap();
        modal.classList.add('hidden');
        if (this._lastActiveElement && typeof this._lastActiveElement.focus === 'function') {
          this._lastActiveElement.focus();
        }
      };

      document.getElementById('btn-details-close').onclick = closeModal;
      document.getElementById('btn-close-book-details').onclick = closeModal;
      document.getElementById('btn-details-read').onclick = () => {
        closeModal();
        if (Reader) Reader.openBook(book);
      };
    },

    // Interactive Zoomable Lightbox Implementation (Fits Screen Aspect Ratio, Zoom & Pan)
    openImageLightbox(imgSrc) {
      const modal = document.getElementById('modal-image-lightbox');
      const img = document.getElementById('lightbox-img');
      if (!modal || !img) return;

      this._lightboxState = { scale: 1, posX: 0, posY: 0, isDragging: false, startX: 0, startY: 0 };
      img.src = imgSrc;
      this.updateLightboxTransform();
      modal.classList.remove('hidden');
    },

    closeImageLightbox() {
      const modal = document.getElementById('modal-image-lightbox');
      if (modal) modal.classList.add('hidden');
    },

    updateLightboxTransform() {
      const img = document.getElementById('lightbox-img');
      const resetBtn = document.getElementById('btn-lightbox-reset');
      if (!img) return;
      img.style.transform = `translate(${this._lightboxState.posX}px, ${this._lightboxState.posY}px) scale(${this._lightboxState.scale})`;
      if (resetBtn) resetBtn.textContent = `${Math.round(this._lightboxState.scale * 100)}%`;
    },

    bindLightboxEvents() {
      const modal = document.getElementById('modal-image-lightbox');
      const img = document.getElementById('lightbox-img');
      const vp = document.getElementById('lightbox-viewport');
      if (!modal || !img || !vp) return;

      const zoomIn = () => {
        this._lightboxState.scale = Math.min(4, this._lightboxState.scale + 0.35);
        this.updateLightboxTransform();
      };
      const zoomOut = () => {
        this._lightboxState.scale = Math.max(0.6, this._lightboxState.scale - 0.35);
        if (this._lightboxState.scale <= 1) { this._lightboxState.posX = 0; this._lightboxState.posY = 0; }
        this.updateLightboxTransform();
      };
      const resetZoom = () => {
        this._lightboxState.scale = 1;
        this._lightboxState.posX = 0;
        this._lightboxState.posY = 0;
        this.updateLightboxTransform();
      };

      document.getElementById('btn-lightbox-zoom-in')?.addEventListener('click', (e) => { e.stopPropagation(); zoomIn(); });
      document.getElementById('btn-lightbox-zoom-out')?.addEventListener('click', (e) => { e.stopPropagation(); zoomOut(); });
      document.getElementById('btn-lightbox-reset')?.addEventListener('click', (e) => { e.stopPropagation(); resetZoom(); });
      document.getElementById('btn-lightbox-close')?.addEventListener('click', (e) => { e.stopPropagation(); this.closeImageLightbox(); });

      // Click on backdrop closes lightbox
      modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target === vp) this.closeImageLightbox();
      });

      // Mouse wheel zoom
      vp.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (e.deltaY < 0) zoomIn();
        else zoomOut();
      }, { passive: false });

      // Click to toggle zoom (1x -> 1.8x -> 1x)
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this._lightboxState.scale > 1) resetZoom();
        else { this._lightboxState.scale = 1.8; this.updateLightboxTransform(); }
      });

      // Drag to pan when zoomed
      vp.addEventListener('mousedown', (e) => {
        if (this._lightboxState.scale <= 1) return;
        this._lightboxState.isDragging = true;
        this._lightboxState.startX = e.clientX - this._lightboxState.posX;
        this._lightboxState.startY = e.clientY - this._lightboxState.posY;
        vp.classList.add('panning');
      });
      window.addEventListener('mousemove', (e) => {
        if (!this._lightboxState.isDragging) return;
        this._lightboxState.posX = e.clientX - this._lightboxState.startX;
        this._lightboxState.posY = e.clientY - this._lightboxState.startY;
        this.updateLightboxTransform();
      });
      window.addEventListener('mouseup', () => {
        this._lightboxState.isDragging = false;
        vp.classList.remove('panning');
      });
    },

    async extractEpubMetadata(buffer) {
      try {
        const zip = await JSZip.loadAsync(buffer);
        let opfPath = 'OEBPS/content.opf';
        const containerFile = zip.file('META-INF/container.xml');
        if (containerFile) {
          const cXml = await containerFile.async('text');
          const cDoc = new DOMParser().parseFromString(cXml, 'application/xml');
          const rootfile = cDoc.querySelector('rootfile');
          if (rootfile && rootfile.getAttribute('full-path')) opfPath = rootfile.getAttribute('full-path');
        }

        const opfFile = zip.file(opfPath);
        if (!opfFile) return null;
        const opfXml = await opfFile.async('text');
        const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml');

        const titleEl = opfDoc.querySelector('title') || opfDoc.getElementsByTagName('dc:title')[0];
        const authorEl = opfDoc.querySelector('creator') || opfDoc.getElementsByTagName('dc:creator')[0];
        const descEl = opfDoc.querySelector('description') || opfDoc.getElementsByTagName('dc:description')[0];

        const title = titleEl ? titleEl.textContent.trim() : '';
        const author = authorEl ? authorEl.textContent.trim() : '';
        const description = descEl ? descEl.textContent.trim() : '';

        let coverDataUrl = null;
        const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
        let coverHref = null;
        const coverItem = opfDoc.querySelector('item[properties~="cover-image"]');
        if (coverItem) {
          coverHref = coverItem.getAttribute('href');
        } else {
          const metaCover = opfDoc.querySelector('meta[name="cover"]');
          if (metaCover) {
            const coverId = metaCover.getAttribute('content');
            const item = opfDoc.querySelector(`item[id="${coverId}"]`);
            if (item) coverHref = item.getAttribute('href');
          }
        }

        if (coverHref) {
          const fullPath = opfDir + coverHref;
          const imgFile = zip.file(fullPath) || zip.file(coverHref);
          if (imgFile) {
            const ext = coverHref.split('.').pop().toLowerCase();
            const mime = ext === 'png' ? 'image/png' : (ext === 'webp' ? 'image/webp' : 'image/jpeg');
            const base64 = await imgFile.async('base64');
            coverDataUrl = `data:${mime};base64,${base64}`;
          }
        }

        return { title, author, description, coverDataUrl };
      } catch (err) {
        console.warn('Metadata extraction note:', err);
        return null;
      }
    },

    async importFiles(fileList) {
      const state = window.LNReader.state;
      const Storage = window.LNReader.Storage;
      const Utils = window.LNReader.Utils;
      const showToast = Utils.showToast;

      if (!fileList || !fileList.length) return;
      showToast(`Importing ${fileList.length} book(s)...`);

      let addedCount = 0;
      for (const file of fileList) {
        if (!file.name.toLowerCase().endsWith('.epub')) continue;
        try {
          const buffer = await file.arrayBuffer();
          const hash = await Utils.computeHash(buffer);
          const existing = state.books.find(b => b.fileHash === hash || (b.fileName === file.name && b.fileSize === file.size));
          if (existing) continue;

          const meta = await this.extractEpubMetadata(buffer) || {};
          const newBook = Storage.normalizeBookRecord({
            id: 'book_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            title: meta.title || file.name.replace(/\.epub$/i, '') || 'Untitled Book',
            author: meta.author || 'Unknown Author',
            description: meta.description || '',
            coverUrl: meta.coverDataUrl || null,
            fileBlob: new Blob([buffer], { type: 'application/epub+zip' }),
            fileName: file.name,
            fileSize: file.size,
            fileHash: hash,
            progress: 0,
            scrollTop: 0,
            scrollRatio: 0,
            currentCfi: null,
            currentChapter: '',
            status: 'unread',
            isFavorite: false,
            bookmarks: [],
            highlights: [],
            readingSeconds: 0,
            addedAt: Date.now(),
            lastReadAt: Date.now()
          });

          await Storage.saveBook(newBook);
          state.books.push(newBook);
          addedCount++;
        } catch (err) {
          console.error(`Error importing ${file.name}:`, err);
        }
      }

      await this.loadAndRenderLibrary();
      showToast(`Added ${addedCount} new book(s) to library.`);
    },

    toggleSidebar(force, targetTab) {
      const state = window.LNReader.state;
      const drawer = document.getElementById('drawer-sidebar');
      const backdrop = document.getElementById('drawer-backdrop');
      state.isSidebarOpen = typeof force === 'boolean' ? force : !state.isSidebarOpen;
      if (!drawer) return;

      if (state.isSidebarOpen) {
        drawer.classList.remove('hidden');
        drawer.classList.add('open');
        if (backdrop) backdrop.classList.remove('hidden');
        this.toggleReaderSettings(false);
        if (targetTab) this.switchSidebarTab(targetTab);
      } else {
        drawer.classList.remove('open');
        drawer.classList.add('hidden');
        if (!state.isReaderSettingsOpen && backdrop) backdrop.classList.add('hidden');
      }
    },

    switchSidebarTab(tabName) {
      const state = window.LNReader.state;
      const Bookmarks = window.LNReader.Bookmarks;
      const Highlights = window.LNReader.Highlights;

      state.activeSidebarTab = tabName;
      document.querySelectorAll('.drawer-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
      });
      document.querySelectorAll('.sidebar-tab-pane').forEach(pane => {
        pane.classList.toggle('hidden', pane.id !== `tab-pane-${tabName}`);
      });

      if (tabName === 'bookmarks' && Bookmarks) Bookmarks.renderBookmarksList();
      if (tabName === 'highlights' && Highlights) Highlights.renderHighlightsList();
      if (tabName === 'search') {
        setTimeout(() => {
          const input = document.getElementById('input-inbook-search');
          if (input) input.focus();
        }, 100);
      }
    },

    toggleReaderSettings(force) {
      const state = window.LNReader.state;
      const drawer = document.getElementById('drawer-appearance');
      const backdrop = document.getElementById('drawer-backdrop');
      state.isReaderSettingsOpen = typeof force === 'boolean' ? force : !state.isReaderSettingsOpen;
      if (!drawer) return;

      if (state.isReaderSettingsOpen) {
        drawer.classList.remove('hidden');
        drawer.classList.add('open');
        if (backdrop) backdrop.classList.remove('hidden');
        this.toggleSidebar(false);
      } else {
        drawer.classList.remove('open');
        drawer.classList.add('hidden');
        if (!state.isSidebarOpen && backdrop) backdrop.classList.add('hidden');
      }
    },

    // Remade Minimalist Settings Modal (Stored Books & Themes Only)
    async toggleAppSettings(open) {
      const modal = document.getElementById('modal-app-settings');
      const Utils = window.LNReader.Utils;
      const Storage = window.LNReader.Storage;
      const state = window.LNReader.state;
      if (!modal) return;

      if (open) {
        this._settingsTriggerElement = document.activeElement;
        const countEl = document.getElementById('stat-books-count');
        const storageEl = document.getElementById('stat-storage-used');
        if (countEl) countEl.textContent = `${state.books.length} ${state.books.length === 1 ? 'book' : 'books'} stored`;

        if (Storage) {
          const est = await Storage.getStorageUsage();
          if (storageEl) storageEl.textContent = `${Utils.formatBytes(est.usage)} used in browser storage`;
        }

        const labelSettings = document.getElementById('label-settings-active-theme');
        if (labelSettings) {
          labelSettings.textContent = (state.settings.canvasTheme || 'warm').charAt(0).toUpperCase() + (state.settings.canvasTheme || 'warm').slice(1);
        }

        document.querySelectorAll('#settings-theme-swatches .theme-swatch').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.canvas === state.settings.canvasTheme);
        });

        const selectMain = document.getElementById('setting-chrome-theme-main');
        if (selectMain) selectMain.value = state.settings.chromeTheme;

        modal.classList.remove('hidden');
        this._releaseSettingsTrap = Utils.trapFocus(modal);
      } else {
        if (this._releaseSettingsTrap) {
          this._releaseSettingsTrap();
          this._releaseSettingsTrap = null;
        }
        modal.classList.add('hidden');
        if (this._settingsTriggerElement && typeof this._settingsTriggerElement.focus === 'function') {
          this._settingsTriggerElement.focus();
        }
      }
    },

    openPromptModal(title, onSave) {
      const modal = document.getElementById('modal-prompt');
      const titleEl = document.getElementById('modal-prompt-title');
      const textarea = document.getElementById('prompt-textarea');
      const Utils = window.LNReader.Utils;

      titleEl.textContent = title;
      textarea.value = '';
      const triggerEl = document.activeElement;
      modal.classList.remove('hidden');
      setTimeout(() => textarea.focus(), 80);
      const releaseTrap = Utils.trapFocus(modal);

      const handleSave = () => {
        const val = textarea.value.trim();
        releaseTrap();
        modal.classList.add('hidden');
        cleanup();
        if (triggerEl && typeof triggerEl.focus === 'function') triggerEl.focus();
        onSave(val);
      };

      const handleCancel = () => {
        releaseTrap();
        modal.classList.add('hidden');
        cleanup();
        if (triggerEl && typeof triggerEl.focus === 'function') triggerEl.focus();
      };

      function cleanup() {
        document.getElementById('btn-save-prompt').removeEventListener('click', handleSave);
        document.getElementById('btn-cancel-prompt').removeEventListener('click', handleCancel);
        document.getElementById('btn-close-prompt').removeEventListener('click', handleCancel);
      }

      document.getElementById('btn-save-prompt').addEventListener('click', handleSave);
      document.getElementById('btn-cancel-prompt').addEventListener('click', handleCancel);
      document.getElementById('btn-close-prompt').addEventListener('click', handleCancel);
    },

    async updateStats() {
      const state = window.LNReader.state;
      const Utils = window.LNReader.Utils;
      const countEl = document.getElementById('stat-books-count');
      const storageEl = document.getElementById('stat-storage-used');
      if (countEl) countEl.textContent = `${state.books.length} ${state.books.length === 1 ? 'book' : 'books'} stored`;

      if (navigator.storage && navigator.storage.estimate) {
        try {
          const est = await navigator.storage.estimate();
          if (storageEl) storageEl.textContent = `${Utils.formatBytes(est.usage)} used in browser storage`;
        } catch {
          if (storageEl) storageEl.textContent = 'Local sandbox';
        }
      }
    },

    applySettingsToDOM() {
      const state = window.LNReader.state;
      const Reader = window.LNReader.Reader;

      if (Reader) {
        Reader.applyChromeTheme(state.settings.chromeTheme);
        Reader.applyTheme(state.settings.canvasTheme);
      }
      this.syncTitlebarTheme(state.settings.canvasTheme, state.settings.chromeTheme);

      const btnGrid = document.getElementById('btn-view-grid');
      const btnList = document.getElementById('btn-view-list');
      if (btnGrid) btnGrid.classList.toggle('active', state.settings.viewMode === 'grid');
      if (btnList) btnList.classList.toggle('active', state.settings.viewMode === 'list');

      const fontSelect = document.getElementById('setting-font-family');
      if (fontSelect) fontSelect.value = state.settings.fontFamily;

      const sizeInput = document.getElementById('setting-font-size');
      const sizeLabel = document.getElementById('label-font-size');
      const stepperVal = document.getElementById('stepper-val-font');
      if (sizeInput && sizeLabel) {
        sizeInput.value = state.settings.fontSize;
        sizeLabel.textContent = `${state.settings.fontSize}px`;
        if (stepperVal) stepperVal.textContent = state.settings.fontSize;
      }

      document.querySelectorAll('#control-line-height .tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.val === String(state.settings.lineHeight));
      });
      const lhLabel = document.getElementById('label-line-height');
      if (lhLabel) lhLabel.textContent = state.settings.lineHeight;

      document.querySelectorAll('#control-text-align .tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.val === state.settings.textAlign);
      });
      const toggleIndent = document.getElementById('toggle-indent');
      if (toggleIndent) toggleIndent.checked = !!state.settings.indent;

      const mwInput = document.getElementById('setting-max-width');
      const mwLabel = document.getElementById('label-max-width');
      if (mwInput && mwLabel) {
        mwInput.value = state.settings.maxWidth;
        mwLabel.textContent = `${state.settings.maxWidth}px`;
      }
      document.documentElement.style.setProperty('--reader-max-width', `${state.settings.maxWidth}px`);

      const lsInput = document.getElementById('setting-letter-spacing');
      const lsLabel = document.getElementById('label-letter-spacing');
      if (lsInput && lsLabel) {
        lsInput.value = state.settings.letterSpacing;
        lsLabel.textContent = state.settings.letterSpacing === 0 ? 'Normal' : `${state.settings.letterSpacing}px`;
      }

      const sortSelect = document.getElementById('select-sort');
      if (sortSelect && state.sortBy) sortSelect.value = state.sortBy;
      this.updateSortDirectionUI();

      if (state.renditionInstance && Reader) {
        const contents = state.renditionInstance.getContents();
        if (contents && contents.length) {
          contents.forEach(c => Reader.applyStyling(c));
        }
      }
    },

    updateSortDirectionUI() {
      const state = window.LNReader.state;
      const sortDirBtn = document.getElementById('btn-sort-direction');
      if (!sortDirBtn) return;
      const isAsc = !!(state.settings && state.settings.sortAsc);
      sortDirBtn.title = isAsc ? 'Sort: Ascending' : 'Sort: Default';
      sortDirBtn.classList.toggle('active', isAsc);
    },

    bindDOMEvents() {
      const state = window.LNReader.state;
      const Storage = window.LNReader.Storage;
      const Reader = window.LNReader.Reader;
      const Bookmarks = window.LNReader.Bookmarks;
      const Highlights = window.LNReader.Highlights;
      const InBookSearch = window.LNReader.InBookSearch;
      const Backup = window.LNReader.Backup;
      const showToast = window.LNReader.Utils.showToast;

      // View Switcher
      const btnGrid = document.getElementById('btn-view-grid');
      const btnList = document.getElementById('btn-view-list');
      if (btnGrid) {
        btnGrid.addEventListener('click', () => {
          state.settings.viewMode = 'grid';
          Storage.saveSettings(state.settings);
          this.applySettingsToDOM();
          this.renderBooks();
        });
      }
      if (btnList) {
        btnList.addEventListener('click', () => {
          state.settings.viewMode = 'list';
          Storage.saveSettings(state.settings);
          this.applySettingsToDOM();
          this.renderBooks();
        });
      }

      // Filter Tabs
      document.querySelectorAll('.filter-tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.filter-tabs .tab-btn').forEach(b => {
            b.classList.remove('active');
            b.setAttribute('aria-selected', 'false');
          });
          btn.classList.add('active');
          btn.setAttribute('aria-selected', 'true');
          state.activeFilter = btn.dataset.filter;
          this.renderBooks();
        });
      });

      // Search Box
      const searchInput = document.getElementById('input-search');
      const clearSearchBtn = document.getElementById('btn-clear-search');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          state.searchQuery = e.target.value.trim();
          if (clearSearchBtn) clearSearchBtn.classList.toggle('hidden', !state.searchQuery);
          this.renderBooks();
        });
      }
      if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => {
          if (searchInput) searchInput.value = '';
          state.searchQuery = '';
          clearSearchBtn.classList.add('hidden');
          this.renderBooks();
        });
      }

      // Sort
      const sortSelect = document.getElementById('select-sort');
      if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
          state.sortBy = e.target.value;
          this.renderBooks();
        });
      }
      const sortDirBtn = document.getElementById('btn-sort-direction');
      if (sortDirBtn) {
        sortDirBtn.addEventListener('click', () => {
          state.settings.sortAsc = !state.settings.sortAsc;
          Storage.saveSettings(state.settings);
          this.updateSortDirectionUI();
          this.renderBooks();
        });
      }

      // Import EPUB
      const fileEpubInput = document.getElementById('input-file-epub');
      const btnImport = document.getElementById('btn-import-epub');
      const btnEmptyImport = document.getElementById('btn-empty-import');
      if (btnImport && fileEpubInput) btnImport.addEventListener('click', () => fileEpubInput.click());
      if (btnEmptyImport && fileEpubInput) btnEmptyImport.addEventListener('click', () => fileEpubInput.click());
      if (fileEpubInput) {
        fileEpubInput.addEventListener('change', (e) => {
          if (e.target.files && e.target.files.length) {
            const fileArray = Array.from(e.target.files);
            fileEpubInput.value = '';
            this.importFiles(fileArray);
          }
        });
      }

      // Drag & Drop
      window.addEventListener('dragover', (e) => e.preventDefault());
      window.addEventListener('drop', (e) => {
        e.preventDefault();
        if (e.dataTransfer && e.dataTransfer.files) {
          this.importFiles(Array.from(e.dataTransfer.files));
        }
      });

      // Backup & Restore
      const backupTrigger = document.getElementById('btn-backup-trigger');
      const backupMenu = document.getElementById('dropdown-backup-menu');
      if (backupTrigger && backupMenu) {
        backupTrigger.addEventListener('click', (e) => {
          e.stopPropagation();
          backupMenu.classList.toggle('hidden');
        });
        document.addEventListener('click', () => backupMenu.classList.add('hidden'));
      }
      const btnExportBackup = document.getElementById('btn-export-backup');
      if (btnExportBackup && Backup) {
        btnExportBackup.addEventListener('click', () => {
          if (backupMenu) backupMenu.classList.add('hidden');
          Backup.exportBackup();
        });
      }
      const fileBackupInput = document.getElementById('input-file-backup');
      const btnRestoreBackup = document.getElementById('btn-restore-backup');
      if (btnRestoreBackup && fileBackupInput && Backup) {
        btnRestoreBackup.addEventListener('click', () => {
          if (backupMenu) backupMenu.classList.add('hidden');
          fileBackupInput.click();
        });
        fileBackupInput.addEventListener('change', (e) => {
          if (e.target.files && e.target.files[0]) {
            Backup.restoreBackup(e.target.files[0]);
            fileBackupInput.value = '';
          }
        });
      }
      const btnExportAnnot = document.getElementById('btn-export-annotations');
      if (btnExportAnnot && Highlights) {
        btnExportAnnot.addEventListener('click', () => {
          if (backupMenu) backupMenu.classList.add('hidden');
          Highlights.exportMarkdown();
        });
      }

      // Book Actions Delegation
      const handleBookActions = async (e) => {
        const delBtn = e.target.closest('.btn-delete-book');
        if (delBtn) {
          e.stopPropagation();
          const id = delBtn.dataset.delId || delBtn.dataset.id;
          const book = state.books.find(b => b.id === id);
          if (!book) return;
          if (confirm(`Remove "${book.title}" from your library?`)) {
            await Storage.deleteBook(id);
            state.books = state.books.filter(b => b.id !== id);
            showToast(`Removed "${book.title}"`);
            this.renderBooks();
            this.updateStats();
          }
          return;
        }

        const favBtn = e.target.closest('.card-favorite-btn, .table-fav-btn');
        if (favBtn) {
          e.stopPropagation();
          this.toggleFavorite(favBtn.dataset.favId);
          return;
        }

        const infoBtn = e.target.closest('.btn-info-book, .card-touch-btn');
        if (infoBtn) {
          e.stopPropagation();
          this.showBookDetails(infoBtn.dataset.infoId);
          return;
        }
      };

      const gridEl = document.getElementById('books-grid');
      const tableWrapEl = document.getElementById('books-table-wrap');
      if (gridEl) gridEl.addEventListener('click', handleBookActions);
      if (tableWrapEl) tableWrapEl.addEventListener('click', handleBookActions);

      // Reader Navigation Buttons
      const btnReaderBack = document.getElementById('btn-reader-back');
      if (btnReaderBack && Reader) btnReaderBack.addEventListener('click', () => Reader.closeReader());

      ['btn-next-chapter', 'btn-floating-next', 'btn-header-next'].forEach(id => {
        const el = document.getElementById(id);
        if (el && Reader) el.addEventListener('click', () => Reader.nextChapter());
      });

      ['btn-prev-chapter', 'btn-floating-prev', 'btn-header-prev'].forEach(id => {
        const el = document.getElementById(id);
        if (el && Reader) el.addEventListener('click', () => Reader.prevChapter());
      });

      // Bookmark Current Location
      const btnBm = document.getElementById('btn-toggle-bookmark');
      const btnAddBm = document.getElementById('btn-add-current-bookmark');
      if (btnBm && Bookmarks) btnBm.addEventListener('click', () => Bookmarks.toggleBookmark());
      if (btnAddBm && Bookmarks) btnAddBm.addEventListener('click', () => Bookmarks.toggleBookmark());

      // Sidebar
      const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
      const btnCloseSidebar = document.getElementById('btn-close-sidebar');
      if (btnToggleSidebar) btnToggleSidebar.addEventListener('click', () => this.toggleSidebar());
      if (btnCloseSidebar) btnCloseSidebar.addEventListener('click', () => this.toggleSidebar(false));

      document.querySelectorAll('.drawer-tab-btn').forEach(tabBtn => {
        tabBtn.addEventListener('click', () => this.switchSidebarTab(tabBtn.dataset.tab));
      });

      // In-Book Search
      const btnOpenInbook = document.getElementById('btn-open-inbook-search');
      if (btnOpenInbook) btnOpenInbook.addEventListener('click', () => this.toggleSidebar(true, 'search'));

      const inputInbook = document.getElementById('input-inbook-search');
      const btnExecSearch = document.getElementById('btn-exec-inbook-search');
      if (btnExecSearch && inputInbook && InBookSearch) {
        btnExecSearch.addEventListener('click', () => InBookSearch.executeSearch(inputInbook.value.trim()));
      }
      if (inputInbook && InBookSearch) {
        inputInbook.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') InBookSearch.executeSearch(inputInbook.value.trim());
        });
      }
      const clearInbookBtn = document.getElementById('btn-clear-inbook-search');
      if (clearInbookBtn && InBookSearch) {
        clearInbookBtn.addEventListener('click', () => InBookSearch.clear());
      }
      document.querySelectorAll('.search-scope-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          if (InBookSearch) InBookSearch.setScope(btn.dataset.scope);
        });
      });

      // Export notes
      const btnExportNotes = document.getElementById('btn-export-notes-pane');
      if (btnExportNotes && Highlights) {
        btnExportNotes.addEventListener('click', () => Highlights.exportMarkdown());
      }

      // Selection Toolbar
      document.querySelectorAll('#selection-toolbar .btn-highlight-color').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (Highlights) Highlights.addHighlight(btn.dataset.color);
        });
      });
      const btnAddNote = document.getElementById('btn-add-note');
      if (btnAddNote && Highlights) {
        btnAddNote.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openPromptModal('Add Note to Selection', (noteText) => {
            Highlights.addHighlight('yellow', noteText);
          });
        });
      }
      const btnCopyQuote = document.getElementById('btn-copy-quote');
      if (btnCopyQuote) {
        btnCopyQuote.addEventListener('click', (e) => {
          e.stopPropagation();
          if (state.activeSelection && state.activeSelection.text) {
            const quote = `"${state.activeSelection.text}" — ${state.activeBook ? state.activeBook.title : ''}`;
            navigator.clipboard.writeText(quote).catch(() => {});
            showToast('Quote copied to clipboard');
            document.getElementById('selection-toolbar').classList.add('hidden');
            state.activeSelection = null;
          }
        });
      }

      // Reading Appearance Drawer
      const btnToggleReaderSet = document.getElementById('btn-toggle-reader-settings');
      const btnCloseReaderSet = document.getElementById('btn-close-reader-settings');
      if (btnToggleReaderSet) btnToggleReaderSet.addEventListener('click', () => this.toggleReaderSettings());
      if (btnCloseReaderSet) btnCloseReaderSet.addEventListener('click', () => this.toggleReaderSettings(false));

      const backdrop = document.getElementById('drawer-backdrop');
      if (backdrop) {
        backdrop.addEventListener('click', () => {
          this.toggleSidebar(false);
          this.toggleReaderSettings(false);
        });
      }

      // Fullscreen
      const btnFullscreen = document.getElementById('btn-toggle-fullscreen');
      if (btnFullscreen) {
        btnFullscreen.addEventListener('click', () => {
          if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
          else document.exitFullscreen().catch(() => {});
        });
      }

      // Mobile Overflow
      const btnOverflow = document.getElementById('btn-reader-overflow');
      const overflowMenu = document.getElementById('reader-overflow-dropdown');
      if (btnOverflow && overflowMenu) {
        btnOverflow.addEventListener('click', (e) => {
          e.stopPropagation();
          overflowMenu.classList.toggle('hidden');
        });
        document.addEventListener('click', () => overflowMenu.classList.add('hidden'));
      }

      // App Settings Modal
      const btnOpenSettings = document.getElementById('btn-open-settings');
      const btnCloseSettings = document.getElementById('btn-close-app-settings');
      const btnDoneSettings = document.getElementById('btn-done-app-settings');
      const modalAppSettings = document.getElementById('modal-app-settings');

      if (btnOpenSettings) btnOpenSettings.addEventListener('click', () => this.toggleAppSettings(true));
      if (btnCloseSettings) btnCloseSettings.addEventListener('click', () => this.toggleAppSettings(false));
      if (btnDoneSettings) btnDoneSettings.addEventListener('click', () => this.toggleAppSettings(false));
      if (modalAppSettings) {
        modalAppSettings.addEventListener('click', (e) => {
          if (e.target.id === 'modal-app-settings') this.toggleAppSettings(false);
        });
      }

      // Clear All Data
      const btnClearAll = document.getElementById('btn-clear-all-data');
      if (btnClearAll) {
        btnClearAll.addEventListener('click', async () => {
          if (confirm('Are you sure you want to delete ALL books and reading data? This cannot be undone.')) {
            await Storage.clearAll();
            this.toggleAppSettings(false);
            await this.loadAndRenderLibrary();
            showToast('All library data cleared.');
          }
        });
      }

      // Settings Theme Swatches & Reader Theme Swatches
      const bindThemeSwatches = (containerId) => {
        const el = document.getElementById(containerId);
        if (el && Reader) {
          el.addEventListener('click', (e) => {
            const swatch = e.target.closest('.theme-swatch');
            if (!swatch) return;
            state.settings.canvasTheme = swatch.dataset.canvas;
            Storage.saveSettings(state.settings);
            Reader.applyTheme(state.settings.canvasTheme);
          });
        }
      };
      bindThemeSwatches('canvas-theme-swatches');
      bindThemeSwatches('settings-theme-swatches');

      // Chrome Theme Selector (Main Settings & Reader Drawer)
      const bindChromeSelect = (selectId) => {
        const select = document.getElementById(selectId);
        if (select && Reader) {
          select.addEventListener('change', (e) => {
            state.settings.chromeTheme = e.target.value;
            Storage.saveSettings(state.settings);
            Reader.applyChromeTheme(state.settings.chromeTheme);
          });
        }
      };
      bindChromeSelect('setting-chrome-theme');
      bindChromeSelect('setting-chrome-theme-main');

      // Typeface
      const fontSelect = document.getElementById('setting-font-family');
      if (fontSelect) {
        fontSelect.addEventListener('change', (e) => {
          state.settings.fontFamily = e.target.value;
          Storage.saveSettings(state.settings);
          this.applySettingsToDOM();
        });
      }

      // Font Size Controls & Numeric Steppers
      const sizeInput = document.getElementById('setting-font-size');
      if (sizeInput) {
        sizeInput.addEventListener('input', (e) => {
          state.settings.fontSize = parseInt(e.target.value, 10);
          Storage.saveSettings(state.settings);
          this.applySettingsToDOM();
        });
      }
      const btnFontDec = document.getElementById('btn-font-dec');
      const btnFontInc = document.getElementById('btn-font-inc');
      if (btnFontDec) {
        btnFontDec.addEventListener('click', () => {
          state.settings.fontSize = Math.max(12, state.settings.fontSize - 1);
          Storage.saveSettings(state.settings);
          this.applySettingsToDOM();
        });
      }
      if (btnFontInc) {
        btnFontInc.addEventListener('click', () => {
          state.settings.fontSize = Math.min(36, state.settings.fontSize + 1);
          Storage.saveSettings(state.settings);
          this.applySettingsToDOM();
        });
      }

      // Line Height
      document.querySelectorAll('#control-line-height .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          state.settings.lineHeight = btn.dataset.val;
          Storage.saveSettings(state.settings);
          this.applySettingsToDOM();
        });
      });

      // Text Alignment & Indent
      document.querySelectorAll('#control-text-align .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          state.settings.textAlign = btn.dataset.val;
          Storage.saveSettings(state.settings);
          this.applySettingsToDOM();
        });
      });

      const toggleIndent = document.getElementById('toggle-indent');
      if (toggleIndent) {
        toggleIndent.addEventListener('change', (e) => {
          state.settings.indent = e.target.checked;
          Storage.saveSettings(state.settings);
          this.applySettingsToDOM();
        });
      }

      // Max Width
      const mwInput = document.getElementById('setting-max-width');
      if (mwInput) {
        mwInput.addEventListener('input', (e) => {
          state.settings.maxWidth = parseInt(e.target.value, 10);
          Storage.saveSettings(state.settings);
          this.applySettingsToDOM();
        });
      }

      // Letter Spacing
      const lsInput = document.getElementById('setting-letter-spacing');
      if (lsInput) {
        lsInput.addEventListener('input', (e) => {
          state.settings.letterSpacing = parseInt(e.target.value, 10);
          Storage.saveSettings(state.settings);
          this.applySettingsToDOM();
        });
      }

      // Global Keyboard Shortcuts
      document.addEventListener('keydown', (e) => {
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement && document.activeElement.tagName)) return;

        const readerView = document.getElementById('view-reader');
        const isReaderActive = state.activeBook && readerView && !readerView.classList.contains('hidden');
        const lightbox = document.getElementById('modal-image-lightbox');
        const isLightboxActive = lightbox && !lightbox.classList.contains('hidden');

        if (e.key === 'Escape') {
          if (isLightboxActive) {
            this.closeImageLightbox();
          } else if (state.isSidebarOpen || state.isReaderSettingsOpen) {
            this.toggleSidebar(false);
            this.toggleReaderSettings(false);
          } else if (isReaderActive && Reader) {
            Reader.closeReader();
          } else if (!document.getElementById('modal-app-settings').classList.contains('hidden')) {
            this.toggleAppSettings(false);
          } else if (!document.getElementById('modal-book-details').classList.contains('hidden')) {
            document.getElementById('modal-book-details').classList.add('hidden');
          }
        }

        if (isReaderActive && !isLightboxActive) {
          if (e.key === 't' || e.key === 'T') {
            this.toggleSidebar();
          } else if (e.key === 's' || e.key === 'S') {
            this.toggleReaderSettings();
          } else if ((e.key === 'b' || e.key === 'B') && Bookmarks) {
            Bookmarks.toggleBookmark();
          } else if (e.key === '/') {
            e.preventDefault();
            this.toggleSidebar(true, 'search');
          } else if (e.key === 'f' || e.key === 'F') {
            document.getElementById('btn-toggle-fullscreen').click();
          } else if (e.key === 'ArrowRight' || e.key === 'j' || e.key === 'J') {
            if (Reader) Reader.nextChapter();
          } else if (e.key === 'ArrowLeft' || e.key === 'k' || e.key === 'K') {
            if (Reader) Reader.prevChapter();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const sc = document.querySelector('.reader-canvas-container');
            if (sc) sc.scrollBy({ top: 120, behavior: 'smooth' });
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const sc = document.querySelector('.reader-canvas-container');
            if (sc) sc.scrollBy({ top: -120, behavior: 'smooth' });
          } else if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'PageDown') {
            e.preventDefault();
            const sc = document.querySelector('.reader-canvas-container');
            if (sc) sc.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
          } else if (e.key === 'PageUp') {
            e.preventDefault();
            const sc = document.querySelector('.reader-canvas-container');
            if (sc) sc.scrollBy({ top: -window.innerHeight * 0.8, behavior: 'smooth' });
          }
        }
      });
    }
  };

  window.LNReader.UI = UI;
})();
