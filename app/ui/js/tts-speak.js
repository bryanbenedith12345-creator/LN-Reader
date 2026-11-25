/* Yolala's LN Reader - read aloud: the speech engine and playback control. */
'use strict';

function ttsShow() {
  $('#reader').classList.add('tts-on');
  $('#rTts').classList.add('is-on');
  showEl($('#ttsDock'));
}

function ttsStopSpeech() {
  TTS.token++;
  TTS.playing = false;
  TTS.paused = false;
  TTS.pendingEnd = false;
  TTS.utter = null;
  TTS.loading = false;
  clearTimeout(TTS.restartTimer);
  ttsLocalSilence();
  if (TTS.supported) { try { window.speechSynthesis.cancel(); } catch (_) { /* ignore */ } }
}

function ttsLocalSilence() {
  const audio = TTS.audio;
  TTS.audio = null;
  if (!audio) return;
  audio.onended = audio.ontimeupdate = audio.onerror = null;
  try { audio.pause(); audio.src = ''; } catch (_) { /* ignore */ }
}

function ttsHide() {
  ttsStopSpeech();
  ttsClearPaint();
  hideEl($('#ttsDock'), MOTION.fast);
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
  if (ttsPiperActive()) { ttsSpeakLocal(); return; }
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
  if (ttsPiperActive()) { ttsToggleLocal(); return; }
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
  if (isShown($('#ttsDock'))) { ttsToggle(); return; }
  const box = $('#rScroll').getBoundingClientRect();
  const index = ttsIndexAtPoint(innerWidth / 2, box.top + Math.min(170, box.height / 3));
  ttsSelect(index == null ? ttsVisibleStart() : index, true);
}

function ttsSetMode(mode) {
  if (TTS.mode === mode) return;
  const units = ttsUnits();
  const anchor = units[TTS.unit] ? units[TTS.unit].start : 0;
  const wasOpen = isShown($('#ttsDock'));
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
  if (ttsPiperActive()) {
    ttsStopSpeech();
    ttsPiperAudio('This is how I sound.', ttsPiperSpeed()).then((href) => {
      const audio = new Audio(href);
      audio.volume = TTS.volume;
      TTS.audio = audio;
      audio.onended = () => { if (TTS.audio === audio) TTS.audio = null; };
      audio.play().catch(() => toast('Could not start the audio'));
    }).catch((err) => toast(err.message || 'The voice could not speak'));
    return;
  }
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
