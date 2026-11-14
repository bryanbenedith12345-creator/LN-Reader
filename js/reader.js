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
        if (window.pywebview && window.pywebview.api && window.pywebview.api.set_title) {
          window.pywebview.api.set_title(`LN Reader — ${bookData.title}`);
        }
        document.getElementById('reader-chapter-title').textContent = bookData.currentChapter || 'Opening book...';
        this.updateProgressUI(bookData.progress || 0);
        this.updateBookmarkButtonState();

        let blob = bookData.fileBlob;
        if (!blob && bookData.id) {
          const stored = await Storage.getBook(bookData.id);
          if (stored && stored.fileBlob) blob = stored.fileBlob;
        }
        if (!blob && (bookData.url || bookData.fileName)) {
          const fUrl = bookData.url || ('/' + encodeURIComponent(bookData.fileName));
          const resp = await fetch(fUrl);
          if (resp.ok) blob = await resp.blob();
        }
        if (!blob) throw new Error('Could not load book file binary.');
        const arrayBuffer = await blob.arrayBuffer();
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

      if (window.LNReader && window.LNReader.UI && window.LNReader.UI.syncTitlebarTheme) {
        window.LNReader.UI.syncTitlebarTheme(canvasThemeKey, state ? state.settings.chromeTheme : 'light');
      }
    },

    applyChromeTheme(chromeThemeKey) {
      document.documentElement.setAttribute('data-theme', chromeThemeKey);
      const select = document.getElementById('setting-chrome-theme');
      if (select) select.value = chromeThemeKey;
      const selectMain = document.getElementById('setting-chrome-theme-main');
      if (selectMain) selectMain.value = chromeThemeKey;

      const state = window.LNReader.state;
      if (window.LNReader && window.LNReader.UI && window.LNReader.UI.syncTitlebarTheme) {
        window.LNReader.UI.syncTitlebarTheme(state ? state.settings.canvasTheme : 'warm', chromeThemeKey);
      }
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
      if (state.activeBook) {
        state.activeBook.fileBlob = null;
      }
      if (window.pywebview && window.pywebview.api && window.pywebview.api.set_title) {
        window.pywebview.api.set_title('LN Reader — Desktop EPUB Reader');
      }
      // Trigger immediate Python backend memory purge
      if (window.pywebview && window.pywebview.api && window.pywebview.api.trim_memory) {
        window.pywebview.api.trim_memory().catch(() => {});
      } else {
        fetch('/api/memory/trim', { method: 'POST' }).catch(() => {});
      }
    }
  };

  window.LNReader.Reader = Reader;
})();
