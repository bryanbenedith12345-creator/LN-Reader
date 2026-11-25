/* Yolala's LN Reader - read aloud: Piper voice packs, catalogue and offline audio.
   Classic script: shared globals. */
'use strict';

const TTS_LOCAL = {
  data: null, voices: null, error: '', busy: '', cache: new Map(),
  timer: 0, seen: null, warmKey: '', stamp: '', lang: '', quality: '',
  langs: [],
};

function ttsPiperPacks() { return (TTS_LOCAL.data && TTS_LOCAL.data.installed) || []; }
function ttsPiperPack(id) { return ttsPiperPacks().find((pack) => pack.id === id) || null; }
function ttsPiperActive() { return TTS.engine === 'piper' && !!ttsPiperPack(TTS.pack); }
function ttsPiperSpeed() { return clamp(Number(TTS.rate) || 1, 0.5, 2); }

function ttsPiperSize(bytes) {
  const mb = (Number(bytes) || 0) / 1048576;
  return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.max(1, Math.round(mb)) + ' MB';
}

function ttsPiperJobs() { return (TTS_LOCAL.data && TTS_LOCAL.data.jobs) || []; }
function ttsPiperJob(id) { return ttsPiperJobs().find((job) => job.id === id) || null; }
function ttsPiperPercent(job) {
  return job && job.total ? Math.min(100, Math.round((job.got / job.total) * 100)) : 0;
}
function ttsPiperPctText(job) {
  return job && job.got ? ttsPiperPercent(job) + '%' : 'Starting…';
}

function ttsPiperName(id) {
  const pack = ttsPiperPack(id);
  if (pack) return pack.name;
  const voice = (TTS_LOCAL.voices || []).find((item) => item.id === id);
  return voice ? voice.name : id;
}


/* ---------------------------------------------------------------- audio -- */
function ttsPiperAudio(text, speed) {
  const pack = TTS.pack;
  const body = String(text || '');
  if (!pack) return Promise.reject(new Error('Pick a voice first'));
  if (!body.trim()) return Promise.reject(new Error('Nothing to read'));
  const rate = Number(speed) || 1;
  const key = [pack, rate, body].join('\u0001');
  const hit = TTS_LOCAL.cache.get(key);
  if (hit) {
    TTS_LOCAL.cache.delete(key);
    TTS_LOCAL.cache.set(key, hit);
    return hit;
  }
  const url = api('/api/tts/say', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice: pack, speed: rate, text: body }),
  }).then((res) => res.blob()).then((blob) => URL.createObjectURL(blob));
  TTS_LOCAL.cache.set(key, url);
  url.catch(() => { if (TTS_LOCAL.cache.get(key) === url) TTS_LOCAL.cache.delete(key); });
  while (TTS_LOCAL.cache.size > 20) {
    const oldest = TTS_LOCAL.cache.keys().next().value;
    const gone = TTS_LOCAL.cache.get(oldest);
    TTS_LOCAL.cache.delete(oldest);
    gone.then((href) => URL.revokeObjectURL(href)).catch(() => {});
  }
  return url;
}

function ttsPiperWarm() {
  const pack = ttsPiperPack(TTS.pack);
  if (!pack || !TTS_LOCAL.data || !TTS_LOCAL.data.engine || !TTS_LOCAL.data.engine.installed) return;
  const key = pack.id + '|' + ttsPiperSpeed();
  if (TTS_LOCAL.warmKey === key) return;
  TTS_LOCAL.warmKey = key;
  postJSON('/api/tts/warm', { voice: pack.id, speed: ttsPiperSpeed() }).catch(() => {
    TTS_LOCAL.warmKey = '';
  });
}

/* ---------------------------------------------------------------- state -- */
async function ttsPiperRefresh() {
  let data;
  try {
    data = await getJSON('/api/tts');
  } catch (err) {
    TTS_LOCAL.error = err.message || 'Could not read the voice library';
    ttsPiperRender();
    return;
  }
  TTS_LOCAL.error = '';
  TTS_LOCAL.data = data;
  ttsPiperAnnounce();
  ttsPiperRender();
  ttsPiperWatch();
  if (TTS.engine === 'piper') ttsPiperWarm();
  const stamp = ttsPiperPacks().map((pack) => pack.id).join('|') + '#' +
    (data.engine && data.engine.installed ? 'on' : 'off');
  if (stamp !== TTS_LOCAL.stamp) {
    TTS_LOCAL.stamp = stamp;
    if (typeof ttsLoadVoices === 'function') ttsLoadVoices();
  }
}

function ttsPiperWatch() {
  clearTimeout(TTS_LOCAL.timer);
  const running = ttsPiperJobs().some((job) => job.state === 'running');
  if (!running) return;
  TTS_LOCAL.timer = setTimeout(() => { ttsPiperRefresh(); }, 700);
}

function ttsPiperAnnounce() {
  const jobs = ttsPiperJobs();
  if (!TTS_LOCAL.seen) {
    TTS_LOCAL.seen = new Set(jobs.map((job) => job.id + ':' + job.state));
    return;
  }
  for (const job of jobs) {
    const key = job.id + ':' + job.state;
    if (TTS_LOCAL.seen.has(key)) continue;
    TTS_LOCAL.seen.add(key);
    if (job.state === 'failed') {
      toast(job.error || 'That download did not finish');
    } else if (job.state === 'done' && job.kind === 'engine') {
      toast('Speech engine ready', { timeout: 2400 });
    } else if (job.state === 'done') {
      const pack = ttsPiperPack(job.id);
      toast((pack ? pack.name : job.id) + ' is ready', { timeout: 2600 });
      if (!ttsPiperPack(TTS.pack) && ttsPiperPack(job.id)) ttsPiperUse(job.id, true);
      ttsPiperRenderList();
    }
  }
}
/* ------------------------------------------------------------ playback -- */
function ttsLocalWords(sentence) {
  const text = TTS.model.full.slice(sentence.start, sentence.end);
  const out = [];
  const re = /[\w'\u2019-]+/g;
  let match;
  while ((match = re.exec(text))) {
    out.push({ start: sentence.start + match.index, end: sentence.start + match.index + match[0].length });
  }
  return out;
}

function ttsLocalParts(unit) {
  if (!unit) return [];
  const parts = ttsBuild().sentences.filter((item) => item.end > unit.start && item.start < unit.end);
  return parts.length ? parts : [{ start: unit.start, end: unit.end }];
}

function ttsLocalPrefetch(part) {
  const units = ttsUnits();
  const parts = ttsLocalParts(units[TTS.unit]);
  const at = parts.findIndex((item) => item.start === part.start);
  let next = parts[at + 1];
  if (!next && units[TTS.unit + 1]) next = ttsLocalParts(units[TTS.unit + 1])[0];
  if (!next) return;
  const text = ttsSpoken(TTS.model.full.slice(next.start, next.end));
  if (!text.trim()) return;
  ttsPiperAudio(text, ttsPiperSpeed()).catch(() => {});
}

function ttsLocalSay(part) {
  const token = TTS.token;
  const unit = ttsUnits()[TTS.unit];
  if (!unit || !part) return;
  const text = ttsSpoken(TTS.model.full.slice(part.start, part.end));
  TTS.sentence = part;
  TTS.loading = true;
  ttsPaint(unit, part, null);
  ttsRender();
  const words = TTS.word ? ttsLocalWords(part) : [];
  ttsPiperAudio(text, ttsPiperSpeed()).then((href) => {
    if (token !== TTS.token) return;
    const audio = new Audio(href);
    audio.volume = clamp(Number(TTS.volume) || 0, 0, 1);
    audio.preload = 'auto';
    TTS.audio = audio;
    TTS.loading = false;
    TTS.playing = true;
    TTS.paused = false;
    let wordAt = -1;
    audio.ontimeupdate = () => {
      if (token !== TTS.token || !words.length || TTS.paused) return;
      const span = Number(audio.duration) || 0;
      if (!span) return;
      const at = part.start + Math.min(0.999, audio.currentTime / span) * (part.end - part.start);
      let index = words.findIndex((word) => word.end > at);
      if (index < 0) index = words.length - 1;
      if (index !== wordAt) {
        wordAt = index;
        ttsPaint(unit, part, words[index]);
      }
    };
    audio.onended = () => {
      if (token !== TTS.token) return;
      TTS.audio = null;
      ttsLocalAdvance(part);
    };
    audio.onerror = () => {
      if (token !== TTS.token) return;
      TTS.audio = null;
      TTS.playing = false;
      TTS.loading = false;
      ttsRender();
      toast('The voice could not read that');
    };
    audio.play().then(() => {
      if (token !== TTS.token) return;
      ttsRender();
      ttsLocalPrefetch(part);
    }).catch(() => {
      if (token !== TTS.token) return;
      TTS.playing = false;
      TTS.loading = false;
      TTS.audio = null;
      ttsRender();
      toast('Could not start the audio');
    });
  }).catch((err) => {
    if (token !== TTS.token) return;
    TTS.loading = false;
    TTS.playing = false;
    ttsRender();
    toast(err.message || 'The voice could not speak');
  });
}

function ttsLocalAdvance(part) {
  const units = ttsUnits();
  const parts = ttsLocalParts(units[TTS.unit]);
  const at = parts.findIndex((item) => item.start === part.start);
  if (at >= 0 && at + 1 < parts.length) {
    TTS.playing = true;
    ttsLocalSay(parts[at + 1]);
    return;
  }
  if (TTS.unit + 1 < units.length) {
    TTS.unit += 1;
    TTS.sentence = null;
    ttsPaintUnit(true);
    ttsLocalSay(ttsLocalParts(units[TTS.unit])[0]);
    return;
  }
  TTS.playing = false;
  TTS.paused = false;
  TTS.loading = false;
  TTS.sentence = null;
  ttsRender();
  toast('End of chapter', { timeout: 2600 });
}

function ttsSpeakLocal() {
  const units = ttsUnits();
  if (!units.length || TTS.unit < 0) return;
  const unit = units[TTS.unit];
  ttsStopSpeech();
  TTS.playing = true;
  TTS.paused = false;
  ttsPaintUnit(false);
  ttsRender();
  ttsLocalSay(ttsLocalParts(unit)[0]);
}

function ttsToggleLocal() {
  const audio = TTS.audio;
  if (audio && TTS.playing) {
    audio.pause();
    TTS.playing = false;
    TTS.paused = true;
    ttsRender();
    return;
  }
  if (audio && TTS.paused) {
    audio.play().then(() => {
      TTS.paused = false;
      TTS.playing = true;
      ttsRender();
    }).catch(() => toast('Could not start the audio'));
    return;
  }
  ttsSpeakLocal();
}
