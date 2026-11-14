/**
 * LN Reader — Bookmarks Subsystem
 * Modular Subsystem: js/bookmarks.js
 */

(function () {
  'use strict';

  window.LNReader = window.LNReader || {};

  const Bookmarks = {
    isCurrentLocationBookmarked() {
      const state = window.LNReader.state;
      if (!state.activeBook || !Array.isArray(state.activeBook.bookmarks)) return false;
      const cfi = state.activeBook.currentCfi;
      const scrollTop = state.activeBook.scrollTop || 0;
      return state.activeBook.bookmarks.some(b => {
        if (cfi && b.cfi === cfi) return true;
        if (b.scrollTop !== undefined && Math.abs(b.scrollTop - scrollTop) < 30) return true;
        return false;
      });
    },

    async toggleBookmark() {
      const state = window.LNReader.state;
      const Storage = window.LNReader.Storage;
      const Reader = window.LNReader.Reader;
      const showToast = window.LNReader.Utils.showToast;

      if (!state.activeBook) return;

      if (this.isCurrentLocationBookmarked()) {
        const cfi = state.activeBook.currentCfi;
        const scrollTop = state.activeBook.scrollTop || 0;
        state.activeBook.bookmarks = state.activeBook.bookmarks.filter(b => {
          if (cfi && b.cfi === cfi) return false;
          if (b.scrollTop !== undefined && Math.abs(b.scrollTop - scrollTop) < 30) return false;
          return true;
        });
        showToast('Bookmark removed');
      } else {
        await this.addBookmark();
        showToast('Bookmark saved');
      }

      await Storage.saveBook(state.activeBook);
      if (Reader) Reader.updateBookmarkButtonState();
      this.renderBookmarksList();
    },

    async addBookmark() {
      const state = window.LNReader.state;
      const Storage = window.LNReader.Storage;
      const Reader = window.LNReader.Reader;

      if (!state.activeBook) return;
      const vp = document.getElementById('reader-viewport');
      const scrollTop = vp ? vp.scrollTop : 0;
      const progress = state.activeBook.progress || 0;
      const chapter = state.activeBook.currentChapter || 'Bookmark';

      // Capture short text snippet near scroll position (UI-1051)
      let excerpt = '';
      try {
        if (state.renditionInstance) {
          const contents = state.renditionInstance.getContents()[0];
          if (contents && contents.document) {
            const doc = contents.document;
            const elements = doc.querySelectorAll('p, h1, h2, h3, blockquote');
            for (const el of elements) {
              if (el.offsetTop + el.offsetHeight >= scrollTop) {
                excerpt = el.innerText.trim().slice(0, 140) + '...';
                break;
              }
            }
          }
        }
      } catch (e) {}

      const newBm = {
        id: 'bm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        cfi: state.activeBook.currentCfi || null,
        scrollTop,
        progress,
        chapter,
        excerpt: excerpt || `Location at ${Math.round(progress * 100)}%`,
        createdAt: Date.now()
      };

      state.activeBook.bookmarks.unshift(newBm);
      await Storage.saveBook(state.activeBook);
      if (Reader) Reader.updateBookmarkButtonState();
      this.renderBookmarksList();
    },

    async deleteBookmark(id) {
      const state = window.LNReader.state;
      const Storage = window.LNReader.Storage;
      const Reader = window.LNReader.Reader;
      const showToast = window.LNReader.Utils.showToast;

      if (!state.activeBook) return;
      state.activeBook.bookmarks = state.activeBook.bookmarks.filter(b => b.id !== id);
      await Storage.saveBook(state.activeBook);
      if (Reader) Reader.updateBookmarkButtonState();
      this.renderBookmarksList();
      showToast('Bookmark deleted');
    },

    renderBookmarksList() {
      const state = window.LNReader.state;
      const Utils = window.LNReader.Utils;
      const UI = window.LNReader.UI;

      const container = document.getElementById('bookmarks-list');
      if (!container) return;
      container.innerHTML = '';

      if (!state.activeBook || !state.activeBook.bookmarks || state.activeBook.bookmarks.length === 0) {
        container.innerHTML = '<div class="text-secondary text-sm">No bookmarks yet. Press B to bookmark the current position.</div>';
        return;
      }

      state.activeBook.bookmarks.forEach(bm => {
        const card = document.createElement('div');
        card.className = 'bookmark-card';
        card.innerHTML = `
          <div class="item-card-header">
            <span class="font-medium text-sm text-main">${Utils.escapeHtml(bm.chapter)}</span>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="item-card-date">${Utils.formatDate(bm.createdAt)}</span>
              <button class="icon-btn-inline btn-del-bm" title="Delete bookmark" data-id="${bm.id}">&times;</button>
            </div>
          </div>
          <div class="item-card-snippet">${Utils.escapeHtml(bm.excerpt)}</div>
          <div class="text-muted text-xs">${Math.round((bm.progress || 0) * 100)}% through book</div>
        `;

        card.addEventListener('click', (e) => {
          if (e.target.closest('.btn-del-bm')) {
            e.stopPropagation();
            this.deleteBookmark(bm.id);
            return;
          }
          if (bm.cfi && state.renditionInstance) {
            state.renditionInstance.display(bm.cfi);
          } else if (typeof bm.scrollTop === 'number') {
            const vp = document.getElementById('reader-viewport');
            if (vp) vp.scrollTop = bm.scrollTop;
          }
          if (UI) UI.toggleSidebar(false);
        });

        container.appendChild(card);
      });
    }
  };

  window.LNReader.Bookmarks = Bookmarks;
})();
