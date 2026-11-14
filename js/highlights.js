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
