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
