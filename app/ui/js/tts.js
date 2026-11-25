/* Yolala's LN Reader - read aloud: preferences and the text model.
   Classic script: shared globals. */
'use strict';

const TTS_PREFS = 'ln.tts';
const TTS_DEFAULT = {
  engine: 'system', voice: '', pack: '',
  rate: 1, pitch: 1, volume: 1, mode: 'sentence',
  comma: false, period: false, other: false, word: true, follow: true,
};
const TTS = {
  supported: typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined',
  voices: [], model: null, unit: -1, sentence: null, utter: null,
  playing: false, paused: false, pendingEnd: false, token: 0, restartTimer: null,
  ...ttsPrefs(),
};

function ttsPrefs() {
  try { return { ...TTS_DEFAULT, ...JSON.parse(localStorage.getItem(TTS_PREFS) || '{}') }; }
  catch (_) { return { ...TTS_DEFAULT }; }
}

function ttsSavePrefs() {
  const out = {};
  for (const key of Object.keys(TTS_DEFAULT)) out[key] = TTS[key];
  localStorage.setItem(TTS_PREFS, JSON.stringify(out));
}

function ttsVoices() {
  try { return (window.speechSynthesis.getVoices() || []).slice(); } catch (_) { return []; }
}

/* ------------------------------------------------------------ text model -- */
function ttsBuild() {
  if (TTS.model) return TTS.model;
  const body = $('#rBody');
  const nodes = [], nodeMap = new Map(), blocks = [];
  let full = '', lastBlock = null;
  const blockCache = new Map();
  const blockOf = (el) => {
    if (blockCache.has(el)) return blockCache.get(el);
    let n = el;
    while (n && n !== body) {
      const d = getComputedStyle(n).display;
      if (d !== 'inline' && d !== 'inline-block' && d !== 'inline-flex' && d !== 'contents') {
        blockCache.set(el, n);
        return n;
      }
      n = n.parentElement;
    }
    blockCache.set(el, body);
    return body;
  };
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (!node.data) continue;
    const block = blockOf(node.parentElement);
    if (block !== lastBlock) {
      if (blocks.length) blocks[blocks.length - 1].end = full.length;
      blocks.push({ start: full.length });
      lastBlock = block;
      nodes.push({ node, start: full.length });
      nodeMap.set(node, full.length);
      full += node.data;
    } else {
      nodes.push({ node, start: full.length });
      nodeMap.set(node, full.length);
      full += node.data;
    }
  }
  if (blocks.length) blocks[blocks.length - 1].end = full.length;

  const trim = (start, end) => {
    while (start < end && /\s/.test(full[start])) start++;
    while (end > start && /\s/.test(full[end - 1])) end--;
    return { start, end };
  };
  const sentences = [];
  for (const block of blocks) {
    const text = full.slice(block.start, block.end);
    let start = block.start;
    const re = /[.!?…]+["'”’)\]]*\s+/g;
    let match;
    while ((match = re.exec(text))) {
      const end = block.start + match.index + match[0].length;
      const item = trim(start, end);
      if (item.end > item.start) sentences.push(item);
      start = end;
    }
    const tail = trim(start, block.end);
    if (tail.end > tail.start) sentences.push(tail);
  }
  const paragraphs = blocks.map((b) => trim(b.start, b.end)).filter((b) => b.end > b.start);
  TTS.model = { full, nodes, nodeMap, sentences, paragraphs };
  return TTS.model;
}

function ttsFind(list, index) {
  let lo = 0, hi = list.length - 1, at = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].end > index) { at = mid; hi = mid - 1; } else lo = mid + 1;
  }
  return at;
}

function ttsUnits() {
  const model = ttsBuild();
  return TTS.mode === 'paragraph' ? model.paragraphs : model.sentences;
}

function ttsUnitFor(index) { return ttsFind(ttsUnits(), index); }

function ttsSentenceFor(index) {
  const { sentences } = ttsBuild();
  return sentences[ttsFind(sentences, index)];
}

function ttsPoint(index) {
  const { nodes } = ttsBuild();
  if (!nodes.length) return null;
  let lo = 0, hi = nodes.length - 1, at = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (nodes[mid].start <= index) { at = mid; lo = mid + 1; } else hi = mid - 1;
  }
  const item = nodes[at];
  return { node: item.node, offset: clamp(index - item.start, 0, item.node.data.length) };
}

function ttsRange(start, end) {
  const a = ttsPoint(start), b = ttsPoint(end);
  if (!a || !b) return null;
  const range = document.createRange();
  try {
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
  } catch (_) { return null; }
  return range;
}

function ttsIndexAtPoint(x, y) {
  const caret = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
  if (!caret) return null;
  const node = caret.startContainer;
  if (node.nodeType !== 3 || !$('#rBody').contains(node)) return null;
  const start = ttsBuild().nodeMap.get(node);
  return start == null ? null : start + caret.startOffset;
}
