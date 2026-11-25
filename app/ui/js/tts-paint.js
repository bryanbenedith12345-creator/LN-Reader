/* Yolala's LN Reader - read aloud: highlighting what is being spoken. */
'use strict';

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
  if (window.CSS && CSS.highlights) {
    ['tts-unit', 'tts-sentence', 'tts-word'].forEach((n) => CSS.highlights.delete(n));
  }
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
