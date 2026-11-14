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
