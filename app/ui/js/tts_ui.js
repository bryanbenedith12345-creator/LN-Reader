/* Yolala's LN Reader - read aloud: the dock, the settings drawer and bindings. */
'use strict';

function ttsVoiceValue() {
  if (TTS.engine === 'piper' && TTS.pack && ttsPiperPack(TTS.pack)) return 'p|' + TTS.pack;
  return 's|' + (TTS.voice || '');
}

function ttsVoiceGroups() {
  const items = [{ value: 's|', label: 'System default',
    meta: TTS.supported ? 'The voice this device uses' : 'Not available in this window' }];
  for (const voice of TTS.voices) {
    items.push({ value: 's|' + voice.voiceURI, label: voice.name, meta: voice.lang });
  }
  const groups = [{ label: 'This device', items }];
  const packs = ttsPiperPacks();
  if (packs.length) {
    groups.push({ label: 'On this computer', items: packs.map((pack) => ({
      value: 'p|' + pack.id,
      label: pack.name,
      meta: pack.langName + ' · ' + pack.qualityName,
    })) });
  }
  return groups;
}

function ttsVoicePickLabel() {
  const pack = ttsPiperPack(TTS.pack);
  if (TTS.engine === 'piper' && pack) return pack.name;
  const voice = TTS.voices.find((item) => item.voiceURI === TTS.voice);
  return voice ? voice.name : 'System default';
}

function ttsVoiceApply(value) {
  const raw = String(value || '');
  if (raw.startsWith('p|')) {
    TTS.engine = 'piper';
    TTS.pack = raw.slice(2);
    TTS_LOCAL.warmKey = '';
    ttsPiperWarm();
  } else {
    TTS.engine = 'system';
    TTS.pack = '';
    TTS.voice = raw.slice(2);
  }
  ttsSavePrefs();
  ttsLoadVoices();
  ttsPiperRender();
  ttsRestart();
}

function ttsLoadVoices() {
  if (!$('#ttsVoice')) return;
  TTS.voices = ttsVoices().sort((a, b) =>
    (a.lang || '').localeCompare(b.lang || '') || (a.name || '').localeCompare(b.name || ''));
  const packs = ttsPiperPacks();
  const want = ttsVoiceValue();
  const known = new Set();
  for (const group of ttsVoiceGroups()) for (const item of group.items) known.add(item.value);
  if (!known.has(want)) {
    TTS.engine = 'system';
    TTS.pack = '';
    TTS.voice = TTS.voices.some((v) => v.voiceURI === TTS.voice) ? TTS.voice : '';
  }
  const label = $('#ttsVoiceLabel');
  if (label) label.textContent = ttsVoicePickLabel();
  const note = $('#ttsVoiceNote');
  if (note) {
    const pack = ttsPiperPack(TTS.pack);
    if (TTS.engine === 'piper' && pack) {
      note.textContent = pack.name + ' · ' + pack.langName + ' · ' + pack.qualityName + ', on this computer';
    } else if (packs.length) {
      note.textContent = (TTS.voices.length ? TTS.voices.length + ' system voice' +
        (TTS.voices.length === 1 ? '' : 's') + ' · ' : '') + packs.length + ' voice pack' +
        (packs.length === 1 ? '' : 's') + ' installed';
    } else if (TTS.voices.length) {
      note.textContent = TTS.voices.length + ' voice' + (TTS.voices.length === 1 ? '' : 's') + ' on this device';
    } else {
      note.textContent = TTS.supported
        ? 'Using the system voice. Add a Piper voice pack for a natural voice that works offline.'
        : 'The system voice is not available here. Add a Piper voice pack to read aloud.';
    }
  }
  ttsPiperRender();
  ttsSyncUI();
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
  const label = $('#ttsVoiceLabel');
  if (label) label.textContent = ttsVoicePickLabel();
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
  const local = TTS.engine === 'piper';
  if ($('#ttsPitch')) {
    $('#ttsPitch').disabled = local;
    const row = $('#ttsPitch').closest('.set-row');
    if (row) {
      row.classList.toggle('is-dim', local);
      row.title = local ? 'Piper voices keep their own pitch' : '';
    }
  }
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
  const num = (n) => String(Number(n.toFixed(2)));
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
  ttsPiperBind();
  ttsLoadVoices();
  ttsSyncUI();
  ttsPiperRefresh();
  if (TTS.supported && window.speechSynthesis.addEventListener) {
    window.speechSynthesis.addEventListener('voiceschanged', ttsLoadVoices);
    setTimeout(ttsLoadVoices, 600);
  }
}
