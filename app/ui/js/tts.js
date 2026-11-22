/* Yolala's LN Reader - read aloud: voices, text model, playback and dock.
   Classic script: loaded in order from index.html; shared globals. */
'use strict';

/* --------------------------------------------------------------------- tts -- */
const TTS_PREFS = 'ln.tts';
const TTS_DEFAULT = {
  voice: '', rate: 1, pitch: 1, volume: 1, mode: 'sentence',
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
function ttsLoadVoices() {
  const select = $('#ttsVoice');
  if (!select) return;
  TTS.voices = ttsVoices().sort((a, b) =>
    (a.lang || '').localeCompare(b.lang || '') || (a.name || '').localeCompare(b.name || ''));
  if (!TTS.voices.length) {
    select.innerHTML = '<option value="">System default</option>';
    select.value = '';
    $('#ttsVoiceNote').textContent = TTS.supported
      ? 'Using the system default voice. Named voices may appear after the first read.'
      : 'Speech is not available in this window.';
    return;
  }
  select.innerHTML = '<option value="">System default</option>' + TTS.voices.map((v) =>
    `<option value="${esc(v.voiceURI)}">${esc(v.name)} · ${esc(v.lang)}</option>`).join('');
  if (TTS.voice && !TTS.voices.some((v) => v.voiceURI === TTS.voice)) TTS.voice = '';
  select.value = TTS.voice;
  $('#ttsVoiceNote').textContent =
    `${TTS.voices.length} voice${TTS.voices.length === 1 ? '' : 's'} available on this device`;
  ttsSyncUI();
}

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
    }
    nodes.push({ node, start: full.length });
    nodeMap.set(node, full.length);
    full += node.data;
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

function ttsPaint(unit, sentence, word) {
  if (!window.CSS || !CSS.highlights || typeof window.Highlight !== 'function') return;
  const put = (name, span, on) => {
    const range = on && span && span.end > span.start ? ttsRange(span.start, span.end) : null;
    if (range) CSS.highlights.set(name, new Highlight(range));
    else CSS.highlights.delete(name);
  };
  put('tts-unit', unit, true);
  put('tts-sentence', sentence, TTS.mode === 'paragraph');
  put('tts-word', word, !!(TTS.word && word));
}
function ttsClearPaint() {
  if (window.CSS && CSS.highlights) ['tts-unit', 'tts-sentence', 'tts-word'].forEach((n) => CSS.highlights.delete(n));
}
function ttsScroll(unit) {
  const range = ttsRange(unit.start, unit.end);
  if (!range) return;
  const sc = $('#rScroll');
  const box = sc.getBoundingClientRect();
  const rect = range.getBoundingClientRect();
  if (rect.top < box.top + 84 || rect.bottom > box.bottom - 110) {
    sc.scrollTo({ top: sc.scrollTop + rect.top - box.top - box.height * 0.32, behavior: 'smooth' });
  }
}
function ttsPaintUnit(scroll) {
  const units = ttsUnits();
  const unit = units[TTS.unit];
  if (!unit) return;
  const sentence = TTS.mode === 'paragraph' ? ttsSentenceFor(unit.start) : unit;
  TTS.sentence = sentence;
  ttsPaint(unit, sentence, null);
  if (scroll && TTS.follow) ttsScroll(unit);
  ttsRender();
}

function ttsSpoken(text) {
  let out = text;
  if (TTS.comma) out = out.replace(/[,，、]/g, ' ');
  if (TTS.period) out = out.replace(/[.。]/g, ' ');
  if (TTS.other) out = out.replace(/[!?;:…—–"“”\[\]()]/g, ' ');
  return out;
}
function ttsShow() {
  $('#reader').classList.add('tts-on');
  $('#rTts').classList.add('is-on');
  $('#ttsDock').hidden = false;
}
function ttsStopSpeech() {
  TTS.token++;
  TTS.playing = false;
  TTS.paused = false;
  TTS.pendingEnd = false;
  TTS.utter = null;
  clearTimeout(TTS.restartTimer);
  if (TTS.supported) { try { window.speechSynthesis.cancel(); } catch (_) { /* ignore */ } }
}
function ttsHide() {
  ttsStopSpeech();
  ttsClearPaint();
  $('#ttsDock').hidden = true;
  $('#reader').classList.remove('tts-on');
  $('#rTts').classList.remove('is-on');
  TTS.unit = -1;
  TTS.sentence = null;
}
function ttsReset() {
  ttsHide();
  TTS.model = null;
  clearTimeout(TTS.restartTimer);
}
function ttsSelect(index, autoplay) {
  if (!isOpen || index == null) return;
  hideSelBar();
  const nativeSel = window.getSelection();
  if (nativeSel) nativeSel.removeAllRanges();
  if (TTS.model) TTS.model = null;
  const units = ttsUnits();
  if (!units.length) { toast('No readable text on this page'); return; }
  const wasActive = TTS.playing || TTS.paused;
  ttsStopSpeech();
  TTS.unit = ttsUnitFor(index);
  TTS.sentence = null;
  ttsShow();
  ttsPaintUnit(true);
  if (autoplay || wasActive) ttsSpeak();
  else ttsRender();
}
function ttsSpeak() {
  if (!TTS.supported) { toast('Read aloud is not available in this window'); return; }
  const units = ttsUnits();
  if (!units.length || TTS.unit < 0) return;
  if (!TTS.voices.length) ttsLoadVoices();
  ttsStopSpeech();
  const token = TTS.token;
  const unit = units[TTS.unit];
  const synth = window.speechSynthesis;
  const utter = new SpeechSynthesisUtterance(ttsSpoken(TTS.model.full.slice(unit.start, unit.end)));
  const voice = TTS.voices.find((v) => v.voiceURI === TTS.voice);
  if (voice) { utter.voice = voice; utter.lang = voice.lang; } else utter.lang = navigator.language || 'en-US';
  utter.rate = TTS.rate;
  utter.pitch = TTS.pitch;
  utter.volume = TTS.volume;
  utter.onboundary = (ev) => {
    if (token !== TTS.token || TTS.paused) return;
    const full = TTS.model.full;
    let at = unit.start + (ev.charIndex || 0);
    let len = ev.charLength || 0;
    if (!len) {
      let a = at, b = at;
      while (a > unit.start && /[\w'’-]/.test(full[a - 1])) a--;
      while (b < unit.end && /[\w'’-]/.test(full[b])) b++;
      if (b > a) { at = a; len = b - a; }
    }
    const sentence = TTS.mode === 'paragraph' ? ttsSentenceFor(at) : unit;
    const changed = !TTS.sentence || TTS.sentence.start !== sentence.start;
    TTS.sentence = sentence;
    const word = ev.name !== 'sentence' && len ? { start: at, end: at + len } : null;
    ttsPaint(unit, sentence, word);
    if (changed) ttsRender();
  };
  utter.onend = () => {
    if (token !== TTS.token) return;
    TTS.playing = false;
    if (TTS.paused) { TTS.pendingEnd = true; ttsRender(); return; }
    if (TTS.unit + 1 < units.length) {
      TTS.unit++;
      TTS.sentence = null;
      ttsPaintUnit(true);
      ttsSpeak();
    } else {
      ttsPaint(unit, TTS.sentence, null);
      ttsRender();
      toast('End of chapter', { timeout: 2600 });
    }
  };
  utter.onerror = (ev) => {
    if (token !== TTS.token) return;
    if (ev.error === 'interrupted' || ev.error === 'canceled') return;
    TTS.playing = false;
    ttsRender();
    toast('Read aloud: ' + (ev.error || 'speech failed'));
  };
  TTS.utter = utter;
  TTS.playing = true;
  TTS.paused = false;
  TTS.pendingEnd = false;
  ttsPaintUnit(false);
  ttsRender();
  try { synth.speak(utter); }
  catch (_) {
    TTS.playing = false;
    ttsRender();
    toast('Could not start speech');
  }
  if (!TTS.voices.length) setTimeout(ttsLoadVoices, 900);
}
function ttsToggle() {
  if (!TTS.supported) { toast('Read aloud is not available in this window'); return; }
  const synth = window.speechSynthesis;
  if (TTS.playing) {
    synth.pause();
    TTS.playing = false;
    TTS.paused = true;
    ttsRender();
    return;
  }
  if (TTS.paused) {
    TTS.paused = false;
    if (TTS.pendingEnd) {
      TTS.pendingEnd = false;
      const units = ttsUnits();
      if (TTS.unit + 1 < units.length) {
        TTS.unit++;
        TTS.sentence = null;
        ttsPaintUnit(true);
        ttsSpeak();
      } else {
        ttsRender();
        toast('End of chapter');
      }
      return;
    }
    TTS.playing = true;
    if (synth.paused) synth.resume();
    else if (!synth.speaking) ttsSpeak();
    ttsRender();
    return;
  }
  ttsSpeak();
}
function ttsStep(delta) {
  const units = ttsUnits();
  if (!units.length) return;
  const wasActive = TTS.playing || TTS.paused;
  ttsStopSpeech();
  TTS.unit = clamp((TTS.unit < 0 ? 0 : TTS.unit) + delta, 0, units.length - 1);
  TTS.sentence = null;
  ttsShow();
  ttsPaintUnit(true);
  if (wasActive) ttsSpeak(); else ttsRender();
}
function ttsRestart() {
  if (!TTS.playing && !TTS.paused) return;
  ttsStopSpeech();
  ttsPaintUnit(false);
  ttsSpeak();
}
function ttsVisibleStart() {
  const box = $('#rScroll').getBoundingClientRect();
  for (const unit of ttsUnits()) {
    const rect = ttsRange(unit.start, unit.end)?.getBoundingClientRect();
    if (rect && rect.bottom > box.top + 70 && rect.top < box.bottom - 110) return unit.start;
  }
  return 0;
}
function ttsStartHere() {
  if (!isOpen) return;
  if (!$('#ttsDock').hidden) { ttsToggle(); return; }
  const sc = $('#rScroll');
  const box = sc.getBoundingClientRect();
  const index = ttsIndexAtPoint(innerWidth / 2, box.top + Math.min(170, box.height / 3));
  ttsSelect(index == null ? ttsVisibleStart() : index, true);
}
function ttsSetMode(mode) {
  if (TTS.mode === mode) return;
  const units = ttsUnits();
  const anchor = units[TTS.unit] ? units[TTS.unit].start : 0;
  const wasOpen = !$('#ttsDock').hidden;
  const wasSpeaking = TTS.playing || TTS.paused;
  ttsStopSpeech();
  TTS.mode = mode;
  ttsSavePrefs();
  ttsSyncUI();
  if (!wasOpen) return;
  TTS.unit = ttsUnitFor(anchor);
  TTS.sentence = null;
  ttsPaintUnit(true);
  if (wasSpeaking) ttsSpeak();
}
function ttsTestVoice() {
  if (!TTS.supported) { toast('Read aloud is not available in this window'); return; }
  if (!TTS.voices.length) ttsLoadVoices();
  ttsStopSpeech();
  ttsRender();
  const utter = new SpeechSynthesisUtterance('This is how I sound.');
  const voice = TTS.voices.find((v) => v.voiceURI === TTS.voice);
  if (voice) { utter.voice = voice; utter.lang = voice.lang; } else utter.lang = navigator.language || 'en-US';
  utter.rate = TTS.rate;
  utter.pitch = TTS.pitch;
  utter.volume = TTS.volume;
  try { window.speechSynthesis.speak(utter); } catch (_) { toast('Could not start speech'); }
}

function ttsRender() {
  if ($('#ttsDock').hidden) return;
  const units = ttsUnits();
  const unit = units[TTS.unit];
  if (!unit) return;
  const sentence = TTS.mode === 'paragraph'
    ? (TTS.sentence && TTS.sentence.start >= unit.start && TTS.sentence.end <= unit.end
      ? TTS.sentence : ttsSentenceFor(unit.start))
    : unit;
  const text = TTS.model.full.slice(sentence.start, sentence.end).replace(/\s+/g, ' ').trim();
  const label = text.length > 160 ? text.slice(0, 160) + '…' : text;
  if ($('#ttsLabel').textContent !== label) $('#ttsLabel').textContent = label;
  const meta = `${TTS.mode === 'paragraph' ? 'Paragraph' : 'Sentence'} ${TTS.unit + 1} of ${units.length} · ` +
    `${Math.round(((TTS.unit + 1) / units.length) * 100)}%`;
  if ($('#ttsMeta').textContent !== meta) $('#ttsMeta').textContent = meta;
  $('#ttsProg').style.width = (((TTS.unit + 1) / units.length) * 100).toFixed(2) + '%';
  const icon = TTS.playing ? 'pause' : 'play';
  const play = $('#ttsPlay');
  if (play.dataset.icon !== icon) {
    play.innerHTML = `<svg><use href="#i-${icon}"/></svg>`;
    play.dataset.icon = icon;
  }
  play.title = TTS.playing ? 'Pause' : (TTS.paused ? 'Resume' : 'Play');
  $('#ttsPrev').disabled = TTS.unit <= 0;
  $('#ttsNext').disabled = TTS.unit >= units.length - 1;
}

function ttsSyncUI() {
  if (!$('#dTts')) return;
  const select = $('#ttsVoice');
  if (select && TTS.voice && Array.from(select.options).some((o) => o.value === TTS.voice)) select.value = TTS.voice;
  const range = (id, key, out, fmt) => {
    if (!$(id)) return;
    $(id).value = TTS[key];
    if (out) $(out).textContent = fmt(TTS[key]);
  };
  const num = (n) => String(Number(n.toFixed(2)));
  range('#ttsRate', 'rate', '#ttsRateOut', (n) => num(n) + '×');
  range('#ttsPitch', 'pitch', '#ttsPitchOut', num);
  range('#ttsVolume', 'volume', '#ttsVolumeOut', (n) => Math.round(n * 100) + '%');
  $$('#ttsMode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === TTS.mode));
  $('#ttsComma').checked = !!TTS.comma;
  $('#ttsPeriod').checked = !!TTS.period;
  $('#ttsOther').checked = !!TTS.other;
  $('#ttsWord').checked = !!TTS.word;
  $('#ttsFollow').checked = !!TTS.follow;
}

function ttsBind() {
  if (!$('#ttsDock')) return;
  $('#ttsPlay').onclick = ttsToggle;
  $('#ttsPrev').onclick = () => ttsStep(-1);
  $('#ttsNext').onclick = () => ttsStep(1);
  $('#ttsStop').onclick = ttsHide;
  $('#ttsCfg').onclick = () => togglePanel('dTts');
  $('#rTts').onclick = ttsStartHere;
  $('#selRead').onclick = () => {
    const start = pendingSel ? pendingSel.start : null;
    if (start == null) return;
    hideSelBar();
    ttsSelect(start, true);
  };
  $('#ttsVoice').onchange = (e) => { TTS.voice = e.target.value; ttsSavePrefs(); ttsRestart(); };
  const bindRange = (id, key, out, fmt) => {
    const el = $(id);
    el.addEventListener('input', () => {
      TTS[key] = Number(el.value);
      $(out).textContent = fmt(TTS[key]);
      ttsSavePrefs();
      clearTimeout(TTS.restartTimer);
      if (TTS.playing || TTS.paused) TTS.restartTimer = setTimeout(ttsRestart, 400);
    });
  };
  const num = (n) => String(Number(n.toFixed(2)));
  bindRange('#ttsRate', 'rate', '#ttsRateOut', (n) => num(n) + '×');
  bindRange('#ttsPitch', 'pitch', '#ttsPitchOut', num);
  bindRange('#ttsVolume', 'volume', '#ttsVolumeOut', (n) => Math.round(n * 100) + '%');
  const bindSwitch = (id, key, after) => {
    const el = $(id);
    el.checked = !!TTS[key];
    el.onchange = () => { TTS[key] = el.checked; ttsSavePrefs(); if (after) after(); };
  };
  bindSwitch('#ttsComma', 'comma', ttsRestart);
  bindSwitch('#ttsPeriod', 'period', ttsRestart);
  bindSwitch('#ttsOther', 'other', ttsRestart);
  bindSwitch('#ttsWord', 'word', () => ttsPaintUnit(false));
  bindSwitch('#ttsFollow', 'follow');
  $$('#ttsMode button').forEach((btn) => { btn.onclick = () => ttsSetMode(btn.dataset.mode); });
  $('#ttsTest').onclick = ttsTestVoice;
  ttsLoadVoices();
  ttsSyncUI();
  if (TTS.supported && window.speechSynthesis.addEventListener) {
    window.speechSynthesis.addEventListener('voiceschanged', ttsLoadVoices);
    setTimeout(ttsLoadVoices, 600);
  }
}
