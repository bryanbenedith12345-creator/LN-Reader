/**
 * LN Reader — Application State & Configuration
 * Modular Subsystem: js/state.js
 */

(function () {
  'use strict';

  window.LNReader = window.LNReader || {};

  const DEFAULT_SETTINGS = {
    chromeTheme: 'light',      // 'light' | 'dark' | 'slate' | 'espresso' | 'oled'
    canvasTheme: 'warm',       // 'warm' | 'light' | 'sepia' | 'obsidian' | 'solarized' | 'contrast'
    viewMode: 'grid',          // 'grid' | 'list'
    fontFamily: 'serif',       // 'serif' | 'sans' | 'literata' | 'dyslexic' | 'mono'
    fontSize: 18,              // 12 - 36 px
    lineHeight: '1.6',         // '1.3' | '1.6' | '1.8' | '2.1'
    textAlign: 'left',         // 'left' | 'justify'
    indent: false,             // First-line indent boolean
    maxWidth: 760,             // 550 - 1150 px
    letterSpacing: 0,          // 0 - 4 px
    sortAsc: false,
    activeFilter: 'all',
    sortBy: 'recent',
    lastOpenedBookId: null,
    searchScope: 'all'         // 'all' | 'chapter'
  };

  const CANVAS_PALETTES = {
    warm: {
      name: 'Warm Paper',
      bg: '#faf7f0',
      text: '#1c1917',         // Deep rich charcoal ink — No washed-out look
      accent: '#1c1917',
      border: '#e7dfd3',
      quoteBorder: '#8c7b6c'
    },
    light: {
      name: 'Light',
      bg: '#ffffff',
      text: '#18181b',
      accent: '#09090b',
      border: '#e4e4e7',
      quoteBorder: '#18181b'
    },
    sepia: {
      name: 'Sepia',
      bg: '#f5ebd7',
      text: '#2c180a',
      accent: '#3d2310',
      border: '#e2d2b8',
      quoteBorder: '#7d6142'
    },
    obsidian: {
      name: 'Obsidian',
      bg: '#121214',
      text: '#f4f4f5',
      accent: '#ffffff',
      border: '#27272a',
      quoteBorder: '#71717a'
    },
    solarized: {
      name: 'Solarized',
      bg: '#fdf6e3',
      text: '#475b62',
      accent: '#1a6e9c',
      border: '#eee8d5',
      quoteBorder: '#b58900'
    },
    contrast: {
      name: 'High Contrast',
      bg: '#000000',
      text: '#ffffff',
      accent: '#ffffff',
      border: '#333333',
      quoteBorder: '#ffffff'
    }
  };

  const FONT_MAP = {
    serif: '"Iowan Old Style", "Charter", "Sitka Text", "Palatino Linotype", "Georgia", serif',
    sans: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", "Helvetica Neue", sans-serif',
    literata: '"Merriweather", "Charter", "Book Antiqua", "Palatino", serif',
    dyslexic: '"Atkinson Hyperlegible", "OpenDyslexic", -apple-system, sans-serif',
    mono: '"JetBrains Mono", "SF Mono", "Consolas", monospace'
  };

  const HIGHLIGHT_COLORS = {
    yellow: { bg: 'rgba(254, 240, 138, 0.65)', border: '#facc15' },
    green:  { bg: 'rgba(187, 247, 208, 0.65)', border: '#4ade80' },
    blue:   { bg: 'rgba(186, 230, 253, 0.65)', border: '#38bdf8' },
    pink:   { bg: 'rgba(251, 207, 232, 0.65)', border: '#f472b6' },
    orange: { bg: 'rgba(254, 215, 170, 0.65)', border: '#fb923c' }
  };

  const state = {
    books: [],
    activeBook: null,
    epubInstance: null,
    renditionInstance: null,
    tocEntries: [],
    settings: Object.assign({}, DEFAULT_SETTINGS),
    activeSidebarTab: 'toc',
    isSidebarOpen: false,
    isReaderSettingsOpen: false,
    readingTimer: null,
    searchQuery: '',
    activeFilter: 'all',
    sortBy: 'recent',
    activeSelection: null,
    currentChapterWords: 0
  };

  window.LNReader.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  window.LNReader.CANVAS_PALETTES = CANVAS_PALETTES;
  window.LNReader.FONT_MAP = FONT_MAP;
  window.LNReader.HIGHLIGHT_COLORS = HIGHLIGHT_COLORS;
  window.LNReader.state = state;
})();


/**
 * LN Reader — Utility Helpers & Common Functions
 * Modular Subsystem: js/utils.js
 */

(function () {
  'use strict';

  window.LNReader = window.LNReader || {};

  function debounce(fn, ms) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function throttle(fn, ms) {
    let wait = false;
    return function (...args) {
      if (!wait) {
        fn.apply(this, args);
        wait = true;
        setTimeout(() => { wait = false; }, ms);
      }
    };
  }

  function showToast(message, duration = 3000) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove('hidden');
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.classList.add('hidden'), 220);
    }, duration);
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatDate(timestamp) {
    if (!timestamp) return 'Never';
    const d = new Date(timestamp);
    const now = new Date();
    const diffMs = now - d;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      if (diffHours === 0) {
        const diffMins = Math.max(1, Math.floor(diffMs / (1000 * 60)));
        return `${diffMins}m ago`;
      }
      return `${diffHours}h ago`;
    }
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '0 mins';
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins} mins`;
    const hrs = (mins / 60).toFixed(1);
    return `${hrs} hrs`;
  }

  async function computeHash(buffer) {
    try {
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer.slice(0, 65536));
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return 'hash_' + buffer.byteLength;
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeRegExp(str) {
    if (!str) return '';
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function trapFocus(modalEl) {
    if (!modalEl) return () => {};
    const focusableSelectors = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusableEls = modalEl.querySelectorAll(focusableSelectors);
    if (!focusableEls.length) return () => {};
    const firstFocusable = focusableEls[0];
    const lastFocusable = focusableEls[focusableEls.length - 1];

    const handleKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === firstFocusable) {
          lastFocusable.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === lastFocusable) {
          firstFocusable.focus();
          e.preventDefault();
        }
      }
    };

    modalEl.addEventListener('keydown', handleKeyDown);
    return () => modalEl.removeEventListener('keydown', handleKeyDown);
  }

  function isTouchDevice() {
    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || window.matchMedia('(pointer: coarse)').matches;
  }

  const Utils = {
    debounce,
    throttle,
    showToast,
    formatBytes,
    formatDate,
    formatDuration,
    computeHash,
    escapeHtml,
    escapeRegExp,
    trapFocus,
    isTouchDevice
  };

  window.LNReader.Utils = Utils;
  // Expose top-level helpers for backward compatibility
  window.showToast = showToast;
})();


/**
 * LN Reader — Storage Subsystem (IndexedDB & LocalStorage)
 * Modular Subsystem: js/storage.js
 */

(function () {
  'use strict';

  window.LNReader = window.LNReader || {};

  const DB_NAME = 'LNReaderDB_v2';
  const DB_VERSION = 2;
  const STORE_BOOKS = 'books';

  const Storage = {
    db: null,

    async open() {
      if (this.db) return this.db;
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_BOOKS)) {
            const store = db.createObjectStore(STORE_BOOKS, { keyPath: 'id' });
            store.createIndex('title', 'title', { unique: false });
            store.createIndex('author', 'author', { unique: false });
            store.createIndex('lastReadAt', 'lastReadAt', { unique: false });
            store.createIndex('fileHash', 'fileHash', { unique: false });
            store.createIndex('isFavorite', 'isFavorite', { unique: false });
          }
        };
        req.onsuccess = () => {
          this.db = req.result;
          resolve(this.db);
        };
        req.onerror = () => reject(req.error);
      });
    },

    async getAllBooks() {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_BOOKS, 'readonly');
        const store = tx.objectStore(STORE_BOOKS);
        const req = store.getAll();
        req.onsuccess = () => {
          const results = (req.result || []).map(b => this.normalizeBookRecord(b));
          resolve(results);
        };
        req.onerror = () => reject(req.error);
      });
    },

    async getBook(id) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_BOOKS, 'readonly');
        const store = tx.objectStore(STORE_BOOKS);
        const req = store.get(id);
        req.onsuccess = () => {
          if (!req.result) resolve(null);
          else resolve(this.normalizeBookRecord(req.result));
        };
        req.onerror = () => reject(req.error);
      });
    },

    async saveBook(book) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_BOOKS, 'readwrite');
        const store = tx.objectStore(STORE_BOOKS);
        const normalized = this.normalizeBookRecord(book);
        const req = store.put(normalized);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },

    async deleteBook(id) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_BOOKS, 'readwrite');
        const store = tx.objectStore(STORE_BOOKS);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },

    async clearAll() {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_BOOKS, 'readwrite');
        const store = tx.objectStore(STORE_BOOKS);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },

    normalizeBookRecord(b) {
      if (!b) return b;
      if (!Array.isArray(b.bookmarks)) b.bookmarks = [];
      if (!Array.isArray(b.highlights)) b.highlights = [];
      if (typeof b.isFavorite !== 'boolean') b.isFavorite = false;
      if (typeof b.readingSeconds !== 'number') b.readingSeconds = 0;
      if (typeof b.progress !== 'number') b.progress = 0;
      if (typeof b.status !== 'string') {
        b.status = b.progress >= 0.99 ? 'completed' : (b.progress > 0 ? 'reading' : 'unread');
      }
      return b;
    },

    loadSettings() {
      try {
        const raw = localStorage.getItem('ln_reader_settings_v2') || localStorage.getItem('ln_reader_settings');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.theme && !parsed.canvasTheme) {
            parsed.canvasTheme = parsed.theme;
          }
          return Object.assign({}, window.LNReader.DEFAULT_SETTINGS, parsed);
        }
      } catch (e) {
        console.warn('Could not read settings from storage:', e);
      }
      return Object.assign({}, window.LNReader.DEFAULT_SETTINGS);
    },

    saveSettings(settings) {
      try {
        localStorage.setItem('ln_reader_settings_v2', JSON.stringify(settings));
      } catch (e) {
        console.error('Failed to save settings:', e);
      }
    },

    async getStorageUsage() {
      if (navigator.storage && navigator.storage.estimate) {
        try {
          const est = await navigator.storage.estimate();
          const usage = est.usage || 0;
          const quota = est.quota || 0;
          const percent = quota > 0 ? Math.min(100, Math.round((usage / quota) * 100)) : 0;
          return { usage, quota, percent };
        } catch (e) {
          console.warn('Storage estimate failed:', e);
        }
      }
      return { usage: 0, quota: 0, percent: 0 };
    }
  };

  window.LNReader.Storage = Storage;
})();


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


/**
 * LN Reader — Highlights & Annotations Subsystem
 * Modular Subsystem: js/highlights.js
 */

(function () {
  'use strict';

  window.LNReader = window.LNReader || {};

  const Highlights = {
    async addHighlight(color, note = '') {
      const state = window.LNReader.state;
      const Storage = window.LNReader.Storage;
      const HIGHLIGHT_COLORS = window.LNReader.HIGHLIGHT_COLORS;
      const showToast = window.LNReader.Utils.showToast;

      if (!state.activeBook || !state.activeSelection) return;
      const { cfiRange, text } = state.activeSelection;
      const colorDef = HIGHLIGHT_COLORS[color] || HIGHLIGHT_COLORS.yellow;

      const hlRecord = {
        id: 'hl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        cfiRange,
        text,
        color,
        note: note ? note.trim() : '',
        chapter: state.activeBook.currentChapter || 'Annotation',
        createdAt: Date.now()
      };

      state.activeBook.highlights.unshift(hlRecord);
      await Storage.saveBook(state.activeBook);

      // Render highlight in rendition
      if (state.renditionInstance) {
        state.renditionInstance.annotations.add('highlight', cfiRange, {}, (e) => {
          this.onHighlightClick(e, hlRecord);
        }, 'hl-mark', {
          fill: colorDef.border,
          'fill-opacity': '0.35'
        });
      }

      // Hide selection toolbar
      const toolbar = document.getElementById('selection-toolbar');
      if (toolbar) toolbar.classList.add('hidden');
      state.activeSelection = null;

      this.renderHighlightsList();
      showToast(note ? 'Note saved' : 'Highlight added');
    },

    reapplyExistingHighlights(contents) {
      const state = window.LNReader.state;
      const HIGHLIGHT_COLORS = window.LNReader.HIGHLIGHT_COLORS;
      if (!state.activeBook || !Array.isArray(state.activeBook.highlights)) return;

      state.activeBook.highlights.forEach(hl => {
        try {
          const colorDef = HIGHLIGHT_COLORS[hl.color] || HIGHLIGHT_COLORS.yellow;
          state.renditionInstance.annotations.add('highlight', hl.cfiRange, {}, (e) => {
            this.onHighlightClick(e, hl);
          }, 'hl-mark', {
            fill: colorDef.border,
            'fill-opacity': '0.35'
          });
        } catch (e) {
          // Suppress Range errors for unloaded chapters
        }
      });
    },

    onHighlightClick(e, hl) {
      const showToast = window.LNReader.Utils.showToast;
      const UI = window.LNReader.UI;
      if (hl.note) {
        showToast(`Note: "${hl.note}"`, 4000);
      } else {
        if (UI) UI.toggleSidebar(true, 'highlights');
      }
    },

    async deleteHighlight(id) {
      const state = window.LNReader.state;
      const Storage = window.LNReader.Storage;
      const showToast = window.LNReader.Utils.showToast;

      if (!state.activeBook) return;
      const hl = state.activeBook.highlights.find(h => h.id === id);
      if (hl && state.renditionInstance) {
        try {
          state.renditionInstance.annotations.remove(hl.cfiRange, 'highlight');
        } catch (e) {}
      }

      state.activeBook.highlights = state.activeBook.highlights.filter(h => h.id !== id);
      await Storage.saveBook(state.activeBook);
      this.renderHighlightsList();
      showToast('Highlight deleted');
    },

    renderHighlightsList() {
      const state = window.LNReader.state;
      const Utils = window.LNReader.Utils;
      const UI = window.LNReader.UI;

      const container = document.getElementById('highlights-list');
      if (!container) return;
      container.innerHTML = '';

      if (!state.activeBook || !state.activeBook.highlights || state.activeBook.highlights.length === 0) {
        container.innerHTML = '<div class="text-secondary text-sm">No highlights yet. Select text in the reader to highlight or add notes.</div>';
        return;
      }

      state.activeBook.highlights.forEach(hl => {
        const card = document.createElement('div');
        card.className = 'note-card';
        card.innerHTML = `
          <div class="item-card-header">
            <span class="font-medium text-sm text-main">${Utils.escapeHtml(hl.chapter)}</span>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="item-card-date">${Utils.formatDate(hl.createdAt)}</span>
              <button class="icon-btn-inline btn-del-hl" title="Delete highlight" data-id="${hl.id}">&times;</button>
            </div>
          </div>
          <div class="item-card-snippet" style="border-left: 3px solid ${hl.color || '#facc15'}; padding-left: 8px;">
            "${Utils.escapeHtml(hl.text)}"
          </div>
          ${hl.note ? `<div class="item-card-note-text">${Utils.escapeHtml(hl.note)}</div>` : ''}
        `;

        card.addEventListener('click', (e) => {
          if (e.target.closest('.btn-del-hl')) {
            e.stopPropagation();
            this.deleteHighlight(hl.id);
            return;
          }
          if (hl.cfiRange && state.renditionInstance) {
            state.renditionInstance.display(hl.cfiRange);
          }
          if (UI) UI.toggleSidebar(false);
        });

        container.appendChild(card);
      });
    },

    exportMarkdown() {
      const state = window.LNReader.state;
      const showToast = window.LNReader.Utils.showToast;

      if (!state.activeBook || !state.activeBook.highlights || !state.activeBook.highlights.length) {
        showToast('No notes or highlights to export.');
        return;
      }

      const book = state.activeBook;
      let md = `# Notes & Highlights: ${book.title}\n`;
      md += `**Author:** ${book.author}\n`;
      md += `**Exported:** ${new Date().toLocaleDateString()}\n\n---\n\n`;

      book.highlights.forEach((hl, i) => {
        md += `### ${i + 1}. ${hl.chapter}\n`;
        md += `> "${hl.text}"\n\n`;
        if (hl.note) {
          md += `**Note:** ${hl.note}\n\n`;
        }
        md += `*Added on ${new Date(hl.createdAt).toLocaleString()}*\n\n---\n\n`;
      });

      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${book.title.replace(/[^\w\s-]/gi, '')}_Notes.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      showToast('Exported Markdown notes');
    }
  };

  window.LNReader.Highlights = Highlights;
})();


/**
 * LN Reader — In-Book Search Subsystem with Canvas Pulse Highlighting
 * Modular Subsystem: js/search.js
 */

(function () {
  'use strict';

  window.LNReader = window.LNReader || {};

  const InBookSearch = {
    isSearching: false,
    searchScope: 'all', // 'all' | 'chapter' (UI-1046)

    clear() {
      const input = document.getElementById('input-inbook-search');
      const statusEl = document.getElementById('inbook-search-status');
      const resultsEl = document.getElementById('inbook-search-results');
      if (input) input.value = '';
      if (statusEl) statusEl.textContent = '';
      if (resultsEl) resultsEl.innerHTML = '';
      this.isSearching = false;
    },

    setScope(scope) {
      this.searchScope = scope;
      document.querySelectorAll('.search-scope-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.scope === scope);
      });
      const input = document.getElementById('input-inbook-search');
      if (input && input.value.trim().length >= 2) {
        this.executeSearch(input.value.trim());
      }
    },

    async executeSearch(query) {
      const state = window.LNReader.state;
      const Reader = window.LNReader.Reader;
      const Utils = window.LNReader.Utils;
      const showToast = Utils.showToast;

      if (!state.epubInstance || !query || query.length < 2) {
        showToast('Please enter at least 2 characters to search.');
        return;
      }

      const statusEl = document.getElementById('inbook-search-status');
      const resultsEl = document.getElementById('inbook-search-results');
      if (!statusEl || !resultsEl) return;

      this.isSearching = true;
      statusEl.textContent = this.searchScope === 'chapter' ? 'Searching current chapter...' : 'Searching all chapters...';
      resultsEl.innerHTML = '';

      try {
        const spine = state.epubInstance.spine;
        const items = spine.spineItems || [];
        const matches = [];

        // Determine which spine items to scan
        let targetItems = items;
        if (this.searchScope === 'chapter' && state.renditionInstance) {
          const loc = state.renditionInstance.currentLocation();
          if (loc && loc.start && typeof loc.start.index === 'number') {
            targetItems = [items[loc.start.index]].filter(Boolean);
          }
        }

        for (let i = 0; i < targetItems.length; i++) {
          const item = targetItems[i];
          await item.load(state.epubInstance.load.bind(state.epubInstance));
          const found = item.find(query);
          item.unload();

          if (found && found.length) {
            const chap = Reader.findChapterByHref(state.tocEntries, item.href);
            const chapTitle = chap ? chap.label.trim() : `Section ${i + 1}`;
            found.forEach(f => {
              matches.push({
                cfi: f.cfi,
                excerpt: f.excerpt,
                chapter: chapTitle
              });
            });
          }
        }

        this.isSearching = false;
        statusEl.textContent = `Found ${matches.length} result${matches.length === 1 ? '' : 's'}`;

        if (matches.length === 0) {
          resultsEl.innerHTML = '<div class="text-secondary text-sm">No matches found for "' + Utils.escapeHtml(query) + '"</div>';
          return;
        }

        const safeQuery = Utils.escapeRegExp(Utils.escapeHtml(query));
        const regex = new RegExp(safeQuery, 'gi');

        matches.forEach(m => {
          const card = document.createElement('div');
          card.className = 'search-result-card';
          card.setAttribute('tabindex', '0');
          card.setAttribute('role', 'button');
          card.setAttribute('aria-label', `${m.chapter}: ${m.excerpt}`);

          const highlightedExcerpt = Utils.escapeHtml(m.excerpt).replace(
            regex,
            match => `<mark>${match}</mark>`
          );

          card.innerHTML = `
            <div class="search-result-chapter">${Utils.escapeHtml(m.chapter)}</div>
            <div class="search-result-snippet">...${highlightedExcerpt}...</div>
          `;

          const activateResult = () => {
            resultsEl.querySelectorAll('.search-result-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            if (state.renditionInstance && m.cfi) {
              state.renditionInstance.display(m.cfi).then(() => {
                // UI-1043: Pulse matching target keyword on reading canvas
                this.pulseTargetWordOnCanvas(query);
              });
            }
          };

          card.addEventListener('click', activateResult);
          card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              activateResult();
            }
          });

          resultsEl.appendChild(card);
        });

      } catch (err) {
        this.isSearching = false;
        console.error('In-book search error:', err);
        statusEl.textContent = 'Error during search: ' + err.message;
      }
    },

    // UI-1043: Pulse target word on reader canvas
    pulseTargetWordOnCanvas(query) {
      const state = window.LNReader.state;
      if (!state.renditionInstance) return;
      try {
        const contents = state.renditionInstance.getContents()[0];
        if (!contents || !contents.document) return;
        const doc = contents.document;

        // Remove previous pulses
        doc.querySelectorAll('.search-target-pulse').forEach(el => {
          const parent = el.parentNode;
          while (el.firstChild) parent.insertBefore(el.firstChild, el);
          parent.removeChild(el);
        });

        // Find visible occurrences and wrap first match in pulse class
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null, false);
        let node;
        const lowerQuery = query.toLowerCase();

        while ((node = walker.nextNode())) {
          const text = node.nodeValue;
          const idx = text.toLowerCase().indexOf(lowerQuery);
          if (idx !== -1) {
            const span = doc.createElement('mark');
            span.className = 'search-target-pulse';
            const matchedText = text.substring(idx, idx + query.length);
            span.textContent = matchedText;

            const afterText = doc.createTextNode(text.substring(idx + query.length));
            node.nodeValue = text.substring(0, idx);

            node.parentNode.insertBefore(span, node.nextSibling);
            node.parentNode.insertBefore(afterText, span.nextSibling);

            // Smoothly center the element in viewport
            span.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // Auto-clean pulse after 3 seconds
            setTimeout(() => {
              if (span.parentNode) {
                span.classList.remove('search-target-pulse');
              }
            }, 3000);
            break;
          }
        }
      } catch (e) {
        // Suppress pulse errors on cross-domain or synthetic ranges
      }
    }
  };

  window.LNReader.InBookSearch = InBookSearch;
})();


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


/**
 * LN Reader — EPUB Reading Engine, Typography & Viewport Subsystem
 * Modular Subsystem: js/reader.js
 */

(function () {
  'use strict';

  window.LNReader = window.LNReader || {};

  const Reader = {
    saveDebounced: null,
    _onVpScroll: null,

    init() {
      const state = window.LNReader.state;
      const debounce = window.LNReader.Utils.debounce;

      this.saveDebounced = debounce((scrollTop, ratio, spineIndex) => {
        this.savePosition(scrollTop, ratio, spineIndex, false);
      }, 350);

      const handleFlush = () => this.flushCurrentPosition();
      window.addEventListener('beforeunload', handleFlush);
      window.addEventListener('pagehide', handleFlush);
      window.addEventListener('blur', handleFlush);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') handleFlush();
      });

      if (state.readingTimer) clearInterval(state.readingTimer);
      state.readingTimer = setInterval(() => {
        const readerView = document.getElementById('view-reader');
        if (state.activeBook && readerView && !readerView.classList.contains('hidden') && document.visibilityState === 'visible') {
          state.activeBook.readingSeconds = (state.activeBook.readingSeconds || 0) + 5;
        }
      }, 5000);
    },

    bindViewportScroll() {
      const state = window.LNReader.state;
      const vp = document.querySelector('.reader-canvas-container') || document.getElementById('reader-viewport');
      if (!vp) return;

      if (this._onVpScroll) vp.removeEventListener('scroll', this._onVpScroll);

      let ticking = false;
      this._onVpScroll = () => {
        if (!state.activeBook) return;
        if (!ticking) {
          requestAnimationFrame(() => {
            const maxScroll = Math.max(1, vp.scrollHeight - vp.clientHeight);
            const scrollTop = vp.scrollTop;
            const sectionRatio = Math.min(1, Math.max(0, scrollTop / maxScroll));

            let spineIndex = 0;
            const totalSpine = (state.epubInstance && state.epubInstance.spine && state.epubInstance.spine.spineItems)
              ? state.epubInstance.spine.spineItems.length
              : 1;

            if (state.renditionInstance) {
              const loc = state.renditionInstance.currentLocation();
              if (loc && loc.start && typeof loc.start.index === 'number') {
                spineIndex = loc.start.index;
              }
            } else if (state.activeBook && typeof state.activeBook.spineIndex === 'number') {
              spineIndex = state.activeBook.spineIndex;
            }

            const globalProgress = Math.min(1, Math.max(0, (spineIndex + sectionRatio) / Math.max(1, totalSpine)));
            this.updateProgressUI(globalProgress);
            this.saveDebounced(scrollTop, globalProgress, spineIndex);
            ticking = false;
          });
          ticking = true;
        }
      };

      vp.addEventListener('scroll', this._onVpScroll, { passive: true });
    },

    savePosition(scrollTop, ratio, spineIndex = 0, immediate = false) {
      const state = window.LNReader.state;
      const Storage = window.LNReader.Storage;
      if (!state.activeBook) return;

      let currentCfi = state.activeBook.currentCfi;
      try {
        if (state.renditionInstance) {
          const contents = state.renditionInstance.getContents()[0];
          if (contents && contents.document) {
            const elements = contents.document.querySelectorAll('p, h1, h2, h3, h4, blockquote, div');
            for (const el of elements) {
              if (el.offsetTop + el.offsetHeight >= scrollTop) {
                currentCfi = contents.cfiFromNode(el);
                break;
              }
            }
          }
        }
      } catch (e) {}

      state.activeBook.scrollTop = scrollTop;
      state.activeBook.scrollRatio = ratio;
      state.activeBook.progress = ratio;
      state.activeBook.spineIndex = spineIndex;
      state.activeBook.lastReadAt = Date.now();
      if (currentCfi) state.activeBook.currentCfi = currentCfi;

      const totalSpine = (state.epubInstance && state.epubInstance.spine && state.epubInstance.spine.spineItems)
        ? state.epubInstance.spine.spineItems.length
        : 1;

      if (ratio >= 0.98 && spineIndex >= totalSpine - 1) {
        state.activeBook.status = 'completed';
      } else if (ratio > 0.01) {
        state.activeBook.status = 'reading';
      }

      state.settings.lastOpenedBookId = state.activeBook.id;
      Storage.saveSettings(state.settings);

      const idx = state.books.findIndex(b => b.id === state.activeBook.id);
      if (idx !== -1) state.books[idx] = Object.assign({}, state.activeBook);

      Storage.saveBook(state.activeBook).catch(err => console.error('Save progress error:', err));
    },

    flushCurrentPosition() {
      const state = window.LNReader.state;
      if (!state.activeBook) return;
      const vp = document.querySelector('.reader-canvas-container') || document.getElementById('reader-viewport');
      if (!vp) return;
      const maxScroll = Math.max(1, vp.scrollHeight - vp.clientHeight);
      const scrollTop = vp.scrollTop;
      const sectionRatio = Math.min(1, Math.max(0, scrollTop / maxScroll));
      const spineIndex = state.activeBook.spineIndex || 0;
      const totalSpine = (state.epubInstance && state.epubInstance.spine && state.epubInstance.spine.spineItems)
        ? state.epubInstance.spine.spineItems.length
        : 1;
      const globalRatio = Math.min(1, Math.max(0, (spineIndex + sectionRatio) / Math.max(1, totalSpine)));
      this.savePosition(scrollTop, globalRatio, spineIndex, true);
    },

    restoreScrollPosition(bookData) {
      const vp = document.querySelector('.reader-canvas-container') || document.getElementById('reader-viewport');
      if (!vp) return;

      const targetScroll = (typeof bookData.scrollTop === 'number' && bookData.scrollTop > 0)
        ? bookData.scrollTop
        : (bookData.scrollRatio ? Math.round(bookData.scrollRatio * (vp.scrollHeight - vp.clientHeight)) : 0);

      if (targetScroll <= 0) return;
      vp.scrollTop = targetScroll;

      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (vp.scrollHeight > vp.clientHeight && Math.abs(vp.scrollTop - targetScroll) > 10) {
          vp.scrollTop = targetScroll;
        }
        if (attempts >= 10 || Math.abs(vp.scrollTop - targetScroll) <= 2) {
          clearInterval(interval);
        }
      }, 80);
    },

    async openBook(bookData) {
      const state = window.LNReader.state;
      const Storage = window.LNReader.Storage;
      const Bookmarks = window.LNReader.Bookmarks;
      const Highlights = window.LNReader.Highlights;
      const showToast = window.LNReader.Utils.showToast;

      try {
        this.destroy();
        state.activeBook = Storage.normalizeBookRecord(bookData);
        state.settings.lastOpenedBookId = bookData.id;
        Storage.saveSettings(state.settings);

        document.getElementById('view-library').classList.add('hidden');
        document.getElementById('library-header').classList.add('hidden');
        document.getElementById('view-reader').classList.remove('hidden');

        document.getElementById('reader-book-title').textContent = bookData.title;
        document.getElementById('reader-chapter-title').textContent = bookData.currentChapter || 'Opening book...';
        this.updateProgressUI(bookData.progress || 0);
        this.updateBookmarkButtonState();

        const arrayBuffer = await bookData.fileBlob.arrayBuffer();
        state.epubInstance = ePub();
        await state.epubInstance.open(arrayBuffer);

        const viewerEl = document.getElementById('epub-viewer');
        viewerEl.innerHTML = '';

        state.renditionInstance = state.epubInstance.renderTo('epub-viewer', {
          flow: 'scrolled-doc',
          width: '100%',
          height: '100%'
        });

        state.renditionInstance.hooks.content.register((contents) => {
          this.sanitizeAnchors(contents);
          this.applyStyling(contents);
          this.bindSelectionListener(contents);
          if (Highlights) Highlights.reapplyExistingHighlights(contents);
          this.calculateChapterStats(contents);
          this.bindIllustrationZoomListener(contents);
        });

        const navigation = await state.epubInstance.loaded.navigation;
        state.tocEntries = navigation.toc || [];
        this.renderTOC(state.tocEntries);
        if (Bookmarks) Bookmarks.renderBookmarksList();
        if (Highlights) Highlights.renderHighlightsList();

        if (bookData.currentCfi) {
          await state.renditionInstance.display(bookData.currentCfi);
        } else {
          await state.renditionInstance.display();
        }

        this.applyTheme(state.settings.canvasTheme);
        this.applyChromeTheme(state.settings.chromeTheme);
        this.bindViewportScroll();
        this.restoreScrollPosition(bookData);

        state.renditionInstance.on('relocated', (location) => {
          if (!location || !location.start || !location.start.href) return;
          const found = this.findChapterByHref(state.tocEntries, location.start.href);
          if (found && found.label) {
            const currentChapTitle = found.label.trim();
            document.getElementById('reader-chapter-title').textContent = currentChapTitle;
            state.activeBook.currentChapter = currentChapTitle;
          }
        });

        state.epubInstance.locations.generate(1024).then(() => {
          try {
            if (state.renditionInstance) {
              const loc = state.renditionInstance.currentLocation();
              if (loc && loc.start && (!bookData.scrollTop || bookData.scrollTop === 0)) {
                const pct = state.epubInstance.locations.percentageFromCfi(loc.start.cfi);
                if (pct !== undefined && pct !== null) this.updateProgressUI(pct);
              }
            }
          } catch (e) {}
        }).catch(() => {});

      } catch (err) {
        console.error('Failed to open book:', err);
        showToast('Error opening book: ' + (err.message || 'Corrupt EPUB'));
        this.closeReader();
      }
    },

    bindSelectionListener(contents) {
      const state = window.LNReader.state;
      const UI = window.LNReader.UI;
      const Bookmarks = window.LNReader.Bookmarks;
      if (!contents || !contents.document) return;
      const doc = contents.document;
      const toolbar = document.getElementById('selection-toolbar');

      contents.on('selected', (cfiRange) => {
        try {
          const selection = contents.window.getSelection();
          const selectedText = selection.toString().trim();
          if (!selectedText) {
            toolbar.classList.add('hidden');
            state.activeSelection = null;
            return;
          }

          state.activeSelection = { cfiRange, text: selectedText };
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          const iframeRect = contents.window.frameElement.getBoundingClientRect();

          const posX = iframeRect.left + rect.left + (rect.width / 2);
          const posY = iframeRect.top + rect.top - 10;

          toolbar.style.left = `${Math.max(160, Math.min(window.innerWidth - 160, posX))}px`;
          toolbar.style.top = `${Math.max(60, posY)}px`;
          toolbar.classList.remove('hidden');
        } catch (e) {
          toolbar.classList.add('hidden');
        }
      });

      doc.addEventListener('mousedown', () => {
        setTimeout(() => {
          if (!toolbar.matches(':hover')) toolbar.classList.add('hidden');
        }, 150);
      });

      document.addEventListener('mousedown', (e) => {
        if (!e.target.closest('#selection-toolbar') && !toolbar.contains(e.target)) {
          toolbar.classList.add('hidden');
          state.activeSelection = null;
        }
      });

      // Keyboard shortcuts inside EPUB iframe
      doc.addEventListener('keydown', (e) => {
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(doc.activeElement && doc.activeElement.tagName)) return;
        const sc = document.querySelector('.reader-canvas-container');
        if (e.key === 'Escape') {
          if (state.isSidebarOpen || state.isReaderSettingsOpen) {
            if (UI) { UI.toggleSidebar(false); UI.toggleReaderSettings(false); }
          } else if (state.activeBook) {
            Reader.closeReader();
          }
        } else if (e.key === 'ArrowRight' || e.key === 'j' || e.key === 'J') {
          Reader.nextChapter();
        } else if (e.key === 'ArrowLeft' || e.key === 'k' || e.key === 'K') {
          Reader.prevChapter();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (sc) sc.scrollBy({ top: 120, behavior: 'smooth' });
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (sc) sc.scrollBy({ top: -120, behavior: 'smooth' });
        } else if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'PageDown') {
          e.preventDefault();
          if (sc) sc.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
        } else if (e.key === 'PageUp') {
          e.preventDefault();
          if (sc) sc.scrollBy({ top: -window.innerHeight * 0.8, behavior: 'smooth' });
        } else if (e.key === 't' || e.key === 'T') {
          if (UI) UI.toggleSidebar();
        } else if (e.key === 's' || e.key === 'S') {
          if (UI) UI.toggleReaderSettings();
        } else if (e.key === 'b' || e.key === 'B') {
          if (Bookmarks) Bookmarks.toggleBookmark();
        } else if (e.key === '/') {
          e.preventDefault();
          if (UI) UI.toggleSidebar(true, 'search');
        } else if (e.key === 'f' || e.key === 'F') {
          document.getElementById('btn-toggle-fullscreen')?.click();
        }
      });
    },

    bindIllustrationZoomListener(contents) {
      if (!contents || !contents.document) return;
      const UI = window.LNReader.UI;

      contents.document.querySelectorAll('img, svg image').forEach(img => {
        const setup = () => {
          const w = img.naturalWidth || 0;
          const h = img.naturalHeight || 0;
          const isInline = (w > 0 && w <= 120 && h <= 120) ||
                           img.closest('.orn, .chapter-number, h1, h2, h3, p.orn') ||
                           img.classList.contains('calibre5');

          if (isInline) {
            img.classList.remove('ln-illustration-art');
            img.classList.add('ln-inline-glyph');
            img.style.setProperty('display', 'inline-block', 'important');
            img.style.setProperty('vertical-align', 'middle', 'important');
            img.style.setProperty('width', 'auto', 'important');
            img.style.setProperty('height', '1.25em', 'important');
            img.style.setProperty('max-height', '1.5em', 'important');
            img.style.setProperty('max-width', '3em', 'important');
            img.style.setProperty('min-width', '0', 'important');
            img.style.setProperty('margin', '0 4px', 'important');
            img.style.setProperty('box-shadow', 'none', 'important');
            img.style.setProperty('border-radius', '0', 'important');
            img.style.setProperty('cursor', 'default', 'important');
            return;
          }

          // Large book illustrations
          img.classList.add('ln-illustration-art');
          img.style.setProperty('display', 'block', 'important');
          img.style.setProperty('margin', '1.5em auto', 'important');
          img.style.setProperty('height', 'auto', 'important');
          img.style.setProperty('max-height', 'none', 'important');
          img.style.setProperty('cursor', 'zoom-in', 'important');
          img.title = 'Click to zoom illustration';

          if (w >= 480 || img.closest('.booktitlepage, .cover, .illustration, .pc, figure')) {
            img.style.setProperty('width', '100%', 'important');
            img.style.setProperty('max-width', '100%', 'important');
          } else {
            img.style.setProperty('width', 'auto', 'important');
            img.style.setProperty('max-width', '100%', 'important');
          }

          const parent = img.closest('.booktitlepage, .center1, .pc, .illustration, figure, section');
          if (parent) {
            parent.style.setProperty('text-align', 'center', 'important');
            parent.style.setProperty('width', '100%', 'important');
            parent.style.setProperty('height', 'auto', 'important');
            parent.style.setProperty('max-height', 'none', 'important');
          }

          img.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const src = img.currentSrc || img.src || img.getAttribute('src') || img.getAttribute('xlink:href');
            if (src && UI) UI.openImageLightbox(src);
          });
        };

        if (img.complete && img.naturalWidth > 0) {
          setup();
        } else {
          img.addEventListener('load', setup, { once: true });
        }
      });
    },

    calculateChapterStats(contents) {
      const state = window.LNReader.state;
      if (!contents || !contents.document || !contents.document.body) return;
      const text = contents.document.body.innerText || '';
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      state.currentChapterWords = words;

      const readingSpeedWpm = 220;
      const minutesRemaining = Math.max(1, Math.round(words / readingSpeedWpm));

      const timeEstimateEl = document.getElementById('reader-time-estimate');
      if (timeEstimateEl) timeEstimateEl.textContent = `~${minutesRemaining} min${minutesRemaining === 1 ? '' : 's'} left`;

      const statEstTime = document.getElementById('stat-est-time');
      if (statEstTime) statEstTime.textContent = `~${minutesRemaining} min${minutesRemaining === 1 ? '' : 's'}`;

      const statTotalChap = document.getElementById('stat-total-chapters');
      if (statTotalChap && state.tocEntries) statTotalChap.textContent = state.tocEntries.length || 1;
    },

    findChapterByHref(tocList, href) {
      if (!tocList || !href) return null;
      const cleanTarget = href.split('#')[0].replace(/^.*[\\/]/, '').toLowerCase();
      for (const item of tocList) {
        if (item.href) {
          const itemClean = item.href.split('#')[0].replace(/^.*[\\/]/, '').toLowerCase();
          if (itemClean === cleanTarget || href.toLowerCase().includes(itemClean)) return item;
        }
        if (item.subitems && item.subitems.length) {
          const sub = this.findChapterByHref(item.subitems, href);
          if (sub) return sub;
        }
      }
      return null;
    },

    renderTOC(tocList, level = 0) {
      const state = window.LNReader.state;
      const UI = window.LNReader.UI;
      const container = document.getElementById('toc-nav-list');
      if (level === 0) container.innerHTML = '';

      if (!tocList || tocList.length === 0) {
        if (level === 0) container.innerHTML = '<div class="text-secondary text-sm">No table of contents declared in book.</div>';
        return;
      }

      const frontMatterKeywords = ['cover', 'title', 'copyright', 'illustration', 'color', 'table of contents', 'contents'];

      tocList.forEach(item => {
        const link = document.createElement('a');
        const labelText = item.label ? item.label.trim() : 'Untitled Section';
        const isFrontMatter = frontMatterKeywords.some(kw => labelText.toLowerCase().includes(kw));

        link.className = `toc-item-link toc-level-${level} ${isFrontMatter ? 'toc-frontmatter' : ''}`;
        link.href = '#';
        link.textContent = labelText;
        link.title = labelText;
        link.dataset.href = item.href || '';

        if (state.activeBook && state.activeBook.currentChapter && labelText === state.activeBook.currentChapter) {
          link.classList.add('active');
        }

        link.addEventListener('click', (e) => {
          e.preventDefault();
          if (state.renditionInstance && item.href) {
            state.renditionInstance.display(item.href);
            document.getElementById('reader-chapter-title').textContent = labelText;
            document.querySelectorAll('.toc-item-link').forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            if (UI) UI.toggleSidebar(false);
          }
        });
        container.appendChild(link);

        if (item.subitems && item.subitems.length) {
          this.renderTOC(item.subitems, level + 1);
        }
      });
    },

    // Fix unclosed XML self-closing anchors (<a id="page-X"/>) that capture paragraphs
    sanitizeAnchors(contents) {
      if (!contents || !contents.document) return;
      const doc = contents.document;
      doc.querySelectorAll('a:not([href])').forEach(a => {
        if (a.children.length > 0 || a.textContent.length > 0) {
          const parent = a.parentNode;
          if (parent) {
            while (a.firstChild) {
              parent.insertBefore(a.firstChild, a);
            }
          }
        }
      });
    },

    // Strict Typography Injection: No Horizontal Scrollbar, Aspect Ratio Image Scaling
    applyStyling(contents) {
      const state = window.LNReader.state;
      const CANVAS_PALETTES = window.LNReader.CANVAS_PALETTES;
      const FONT_MAP = window.LNReader.FONT_MAP;

      if (!contents || !contents.document) return;
      const doc = contents.document;
      let styleEl = doc.getElementById('ln-reader-injected-style');
      if (!styleEl) {
        styleEl = doc.createElement('style');
        styleEl.id = 'ln-reader-injected-style';
        doc.head.appendChild(styleEl);
      }

      const colors = CANVAS_PALETTES[state.settings.canvasTheme] || CANVAS_PALETTES.warm;
      const font = FONT_MAP[state.settings.fontFamily] || FONT_MAP.serif;
      const indentStyle = state.settings.indent ? 'text-indent: 1.5em !important;' : 'text-indent: 0 !important;';
      const letterSpacingStyle = state.settings.letterSpacing ? `letter-spacing: ${state.settings.letterSpacing}px !important;` : '';
      const hyphenStyle = state.settings.textAlign === 'justify' ? 'hyphens: auto !important; -webkit-hyphens: auto !important; text-justify: inter-word !important;' : '';

      styleEl.textContent = `
        html, body {
          background-color: ${colors.bg} !important;
          color: ${colors.text} !important;
          font-family: ${font} !important;
          font-size: ${state.settings.fontSize}px !important;
          line-height: ${state.settings.lineHeight} !important;
          text-align: ${state.settings.textAlign} !important;
          padding: 0 16px !important;
          margin: 0 auto !important;
          box-sizing: border-box !important;
          ${letterSpacingStyle}
          ${hyphenStyle}
          hanging-punctuation: first last;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          text-rendering: optimizeLegibility;
          overflow: hidden !important;
          overflow-x: hidden !important;
          overflow-y: hidden !important;
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
          max-width: 100vw !important;
        }
        html::-webkit-scrollbar, body::-webkit-scrollbar {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
        }
        * {
          max-width: 100% !important;
          box-sizing: border-box !important;
        }
        body * {
          font-family: inherit !important;
          line-height: inherit !important;
          color: inherit !important;
        }
        p {
          margin-top: 0 !important;
          margin-bottom: ${state.settings.indent ? '0.45em' : '0.85em'} !important;
          text-align: ${state.settings.textAlign} !important;
          ${indentStyle}
        }
        p:has(> [data-dialogue]), p.dialogue {
          text-indent: -0.45em !important;
          padding-left: 0.45em !important;
        }
        ruby {
          font-family: inherit !important;
          ruby-position: over;
        }
        rt {
          font-size: 0.52em !important;
          line-height: 1 !important;
          color: ${colors.accent} !important;
          user-select: none;
        }
        h1, h2, h3, h4, h5, h6 {
          text-indent: 0 !important;
          margin-top: 1.8em !important;
          margin-bottom: 0.6em !important;
          color: ${colors.accent} !important;
          line-height: 1.25 !important;
        }
        h1 { font-size: 1.6em !important; }
        h2 { font-size: 1.35em !important; }
        h3 { font-size: 1.15em !important; }
        sup, sub { font-size: 0.75em !important; line-height: 0 !important; }
        /* Real navigational links only */
        a[href] {
          color: ${colors.accent} !important;
          text-decoration: underline;
          cursor: pointer;
        }
        /* Page anchors, bookmark landmarks, unclosed targets */
        a:not([href]), a:not([href]) * {
          color: inherit !important;
          text-decoration: none !important;
          cursor: inherit !important;
          font-weight: inherit !important;
        }
        /* Inline glyphs: musical notes, symbols, ornaments, calibre5 */
        img.calibre5, [class*="calibre5"],
        .ln-inline-glyph,
        .orn img, h1 img, h2 img, h3 img, .chapter-number img,
        p.orn img {
          display: inline-block !important;
          vertical-align: middle !important;
          width: auto !important;
          height: 1.25em !important;
          max-height: 1.5em !important;
          max-width: 3em !important;
          min-width: 0 !important;
          margin: 0 4px !important;
          box-shadow: none !important;
          border-radius: 0 !important;
          cursor: default !important;
        }

        /* Large illustrations, title pages, color inserts, cover spreads */
        .ln-illustration-art,
        .booktitlepage img, .cover img, [epub\\:type~="cover"] img,
        .illustration img, .illust img, .illus img, .insert img, .pc img,
        figure img, .duokan-image-single img,
        section:has(> .booktitlepage) img {
          display: block !important;
          margin: 1.5em auto !important;
          width: 100% !important;
          max-width: 100% !important;
          height: auto !important;
          max-height: none !important;
          object-fit: contain !important;
          border-radius: 6px;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
          cursor: zoom-in;
        }
        .booktitlepage, .center1, .pc, .illustration, figure, section {
          height: auto !important;
          max-height: none !important;
          width: 100% !important;
        }

        /* Fallback for general images */
        img, svg {
          max-width: 100% !important;
          height: auto !important;
        }
        blockquote {
          border-left: 3px solid ${colors.quoteBorder} !important;
          margin-left: 0 !important;
          padding-left: 14px !important;
          opacity: 0.92;
          font-style: italic;
        }
        hr, .scene-break, .separator {
          border: none !important;
          text-align: center !important;
          margin: 2.2em 0 !important;
          opacity: 0.6;
        }
        hr::after {
          content: "❖ ❖ ❖";
          letter-spacing: 0.6em;
          font-size: 0.85em;
          color: ${colors.accent};
        }
        ::selection {
          background-color: rgba(254, 240, 138, 0.5) !important;
        }
        .search-target-pulse {
          background-color: #fde047 !important;
          color: #18181b !important;
          border-radius: 2px !important;
          padding: 1px 4px !important;
          font-weight: 700 !important;
          box-shadow: 0 0 0 4px rgba(250, 204, 21, 0.5) !important;
        }
      `;
    },

    applyTheme(canvasThemeKey) {
      const CANVAS_PALETTES = window.LNReader.CANVAS_PALETTES;
      document.documentElement.setAttribute('data-canvas-theme', canvasThemeKey);
      const label = document.getElementById('label-active-canvas-theme');
      if (label) label.textContent = canvasThemeKey.charAt(0).toUpperCase() + canvasThemeKey.slice(1);

      const labelSettings = document.getElementById('label-settings-active-theme');
      if (labelSettings) labelSettings.textContent = canvasThemeKey.charAt(0).toUpperCase() + canvasThemeKey.slice(1);

      document.querySelectorAll('#canvas-theme-swatches .theme-swatch, #settings-theme-swatches .theme-swatch').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.canvas === canvasThemeKey);
      });

      const colors = CANVAS_PALETTES[canvasThemeKey] || CANVAS_PALETTES.warm;
      const readerVp = document.getElementById('reader-viewport');
      if (readerVp) readerVp.style.backgroundColor = colors.bg;
      const readerView = document.getElementById('view-reader');
      if (readerView) readerView.style.backgroundColor = colors.bg;

      const state = window.LNReader.state;
      if (state.renditionInstance) {
        const contents = state.renditionInstance.getContents();
        if (contents && contents.length) {
          contents.forEach(c => this.applyStyling(c));
        }
      }
    },

    applyChromeTheme(chromeThemeKey) {
      document.documentElement.setAttribute('data-theme', chromeThemeKey);
      const select = document.getElementById('setting-chrome-theme');
      if (select) select.value = chromeThemeKey;
      const selectMain = document.getElementById('setting-chrome-theme-main');
      if (selectMain) selectMain.value = chromeThemeKey;
    },

    updateProgressUI(progressRatio) {
      const pct = Math.min(100, Math.max(0, Math.round(progressRatio * 100)));
      const topFill = document.getElementById('reader-progress-fill');
      if (topFill) topFill.style.width = `${pct}%`;

      const statGlobalProg = document.getElementById('stat-global-progress');
      if (statGlobalProg) statGlobalProg.textContent = `${pct}%`;
    },

    updateBookmarkButtonState() {
      const Bookmarks = window.LNReader.Bookmarks;
      const btn = document.getElementById('btn-toggle-bookmark');
      if (!btn || !Bookmarks) return;
      const isBm = Bookmarks.isCurrentLocationBookmarked();
      btn.classList.toggle('active', isBm);
      btn.title = isBm ? 'Remove Bookmark (B)' : 'Bookmark Position (B)';
      btn.setAttribute('aria-label', btn.title);
    },

    async nextChapter() {
      const state = window.LNReader.state;
      if (state.renditionInstance) {
        await state.renditionInstance.next();
        const sc = document.querySelector('.reader-canvas-container') || document.getElementById('reader-viewport');
        if (sc) sc.scrollTop = 0;
      }
    },

    async prevChapter() {
      const state = window.LNReader.state;
      if (state.renditionInstance) {
        await state.renditionInstance.prev();
        const sc = document.querySelector('.reader-canvas-container') || document.getElementById('reader-viewport');
        if (sc) sc.scrollTop = 0;
      }
    },

    closeReader() {
      const state = window.LNReader.state;
      const UI = window.LNReader.UI;
      this.flushCurrentPosition();
      this.destroy();

      document.getElementById('view-reader').classList.add('hidden');
      document.getElementById('library-header').classList.remove('hidden');
      document.getElementById('view-library').classList.remove('hidden');

      state.activeBook = null;
      if (UI) {
        UI.toggleSidebar(false);
        UI.toggleReaderSettings(false);
        UI.loadAndRenderLibrary();
      }
    },

    destroy() {
      const state = window.LNReader.state;
      if (state.renditionInstance) {
        try { state.renditionInstance.destroy(); } catch (e) {}
        state.renditionInstance = null;
      }
      if (state.epubInstance) {
        try { state.epubInstance.destroy(); } catch (e) {}
        state.epubInstance = null;
      }
      const viewerEl = document.getElementById('epub-viewer');
      if (viewerEl) viewerEl.innerHTML = '';
      state.tocEntries = [];
    }
  };

  window.LNReader.Reader = Reader;
})();


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
      if (Reader) Reader.init();
      this.loadAndRenderLibrary(true);
    },

    async loadAndRenderLibrary(autoResume = false) {
      const state = window.LNReader.state;
      const Storage = window.LNReader.Storage;
      const Reader = window.LNReader.Reader;

      try {
        state.books = await Storage.getAllBooks();
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

      // App Settings Modal & Library Theme Toggle
      const btnOpenSettings = document.getElementById('btn-open-settings');
      const btnLibraryTheme = document.getElementById('btn-library-theme-toggle');
      const btnCloseSettings = document.getElementById('btn-close-app-settings');
      const btnDoneSettings = document.getElementById('btn-done-app-settings');
      const modalAppSettings = document.getElementById('modal-app-settings');

      if (btnOpenSettings) btnOpenSettings.addEventListener('click', () => this.toggleAppSettings(true));
      if (btnLibraryTheme) btnLibraryTheme.addEventListener('click', () => this.toggleAppSettings(true));
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


/**
 * LN Reader — Application Bootstrap & Runtime Orchestration
 * Modular Subsystem: js/app.js
 */

(function () {
  'use strict';

  window.LNReader = window.LNReader || {};

  // Filter harmless EPUB.js internal DOM Range recovery warning
  const _origConsoleError = console.error;
  console.error = function (...args) {
    if (args[0] && typeof args[0] === 'string' && args[0].includes('setting end offset to start container length failed')) {
      return;
    }
    _origConsoleError.apply(console, args);
  };

  // Expose assembled modules on window.LNReader namespace
  const LNReader = window.LNReader;
  LNReader.state = LNReader.state;
  LNReader.Storage = LNReader.Storage;
  LNReader.Reader = LNReader.Reader;
  LNReader.Bookmarks = LNReader.Bookmarks;
  LNReader.Highlights = LNReader.Highlights;
  LNReader.InBookSearch = LNReader.InBookSearch;
  LNReader.Backup = LNReader.Backup;
  LNReader.UI = LNReader.UI;
  LNReader.Utils = LNReader.Utils;

  // Application Lifecycle Bootstrap
  document.addEventListener('DOMContentLoaded', () => {
    try {
      LNReader.state.settings = LNReader.Storage.loadSettings();
      LNReader.UI.init();
    } catch (e) {
      console.error('LN Reader initialization error:', e);
    }
  });

})();
