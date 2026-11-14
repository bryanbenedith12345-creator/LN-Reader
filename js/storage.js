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
