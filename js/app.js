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
