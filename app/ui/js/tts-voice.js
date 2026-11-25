/* Yolala's LN Reader - voice library: the picker list, the drawer packs and the
   voice pack modal. Classic script: shared globals. */
'use strict';

/* ----------------------------------------------------------------- menu -- */
/* One themed list for every picker; the system popups ignore the theme. */
const TTS_MENU = { el: null, trigger: null, pick: null, index: -1, open: false };

function ttsMenuNode() {
  if (TTS_MENU.el) return TTS_MENU.el;
  const el = document.createElement('div');
  el.className = 'ln-menu';
  el.id = 'ttsMenu';
  el.setAttribute('role', 'listbox');
  el.hidden = true;
  el.addEventListener('click', (ev) => {
    const item = ev.target.closest('.ln-menu-item');
    if (item && !item.disabled) ttsMenuChoose(item.dataset.value);
  });
  document.body.appendChild(el);
  TTS_MENU.el = el;
  return el;
}

function ttsMenuList() {
  return TTS_MENU.el ? $$('.ln-menu-item:not([disabled])', TTS_MENU.el) : [];
}

function ttsMenuActive(step) {
  const items = ttsMenuList();
  if (!items.length) return;
  const at = items.findIndex((item) => item.classList.contains('is-active'));
  let next = typeof step === 'number' ? at + step : step;
  if (next < 0) next = items.length - 1;
  if (next >= items.length) next = 0;
  items.forEach((item, i) => item.classList.toggle('is-active', i === next));
  items[next].scrollIntoView({ block: 'nearest' });
}

function ttsMenuChoose(value) {
  const pick = TTS_MENU.pick;
  ttsMenuHide(true);
  if (typeof pick === 'function') pick(value);
}

function ttsMenuOutside(ev) {
  const menu = TTS_MENU;
  if (!menu.el || !menu.open) return;
  if (menu.el.contains(ev.target)) return;
  if (menu.trigger && menu.trigger.contains(ev.target)) return;
  ttsMenuHide(false);
}

function ttsMenuCloseEvent() { ttsMenuHide(false); }

/* Scrolling keeps the list anchored; it only closes when its trigger scrolls away. */
function ttsMenuScroll(ev) {
  if (!TTS_MENU.open || !TTS_MENU.el) return;
  if (TTS_MENU.el.contains(ev.target)) return;
  const box = TTS_MENU.trigger && TTS_MENU.trigger.getBoundingClientRect();
  if (!box || box.bottom < 4 || box.top > window.innerHeight - 4) { ttsMenuHide(false); return; }
  ttsMenuPlace();
}

function ttsMenuKey(ev) {
  if (!TTS_MENU.open) return;
  if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); ttsMenuHide(true); return; }
  if (ev.key === 'Tab') { ttsMenuHide(false); return; }
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    ev.stopPropagation();
    ttsMenuActive(ev.key === 'ArrowDown' ? 1 : -1);
    return;
  }
  if (ev.key === 'Home' || ev.key === 'End') {
    ev.preventDefault();
    ttsMenuActive(ev.key === 'Home' ? 0 : ttsMenuList().length - 1);
    return;
  }
  if (ev.key === 'Enter' || ev.key === ' ') {
    ev.preventDefault();
    ev.stopPropagation();
    const item = ttsMenuList().find((row) => row.classList.contains('is-active'));
    if (item) ttsMenuChoose(item.dataset.value);
  }
}

function ttsMenuPlace() {
  const el = TTS_MENU.el;
  const trigger = TTS_MENU.trigger;
  if (!el || !trigger) return;
  const box = trigger.getBoundingClientRect();
  const width = Math.max(224, Math.round(box.width));
  const left = Math.min(Math.max(8, box.left), Math.max(8, window.innerWidth - width - 8));
  const room = Math.max(160, Math.round(window.innerHeight * 0.62));
  el.style.width = width + 'px';
  el.style.maxHeight = Math.min(360, room) + 'px';
  el.style.left = Math.round(left) + 'px';
  const height = el.offsetHeight;
  let top = box.bottom + 6;
  if (top + height > window.innerHeight - 8) top = Math.max(8, box.top - height - 6);
  el.style.top = Math.round(top) + 'px';
}

function ttsMenuHide(focus) {
  const menu = TTS_MENU;
  if (!menu.el || !menu.open) {
    if (menu.trigger) menu.trigger.setAttribute('aria-expanded', 'false');
    if (focus && menu.trigger) menu.trigger.focus();
    menu.trigger = null;
    menu.pick = null;
    menu.open = false;
    return;
  }
  const trigger = menu.trigger;
  menu.open = false;
  menu.el.hidden = true;
  menu.el.innerHTML = '';
  menu.index = -1;
  document.removeEventListener('keydown', ttsMenuKey, true);
  document.removeEventListener('pointerdown', ttsMenuOutside, true);
  window.removeEventListener('resize', ttsMenuCloseEvent);
  window.removeEventListener('scroll', ttsMenuScroll, true);
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
  menu.trigger = null;
  menu.pick = null;
  if (focus && trigger) trigger.focus();
}

function ttsMenuShow(trigger, groups, value, pick) {
  const el = ttsMenuNode();
  ttsMenuHide(false);
  const parts = [];
  for (const group of groups || []) {
    const items = (group.items || []).filter(Boolean);
    if (!items.length) continue;
    if (group.label) parts.push('<div class="ln-menu-head">' + esc(group.label) + '</div>');
    for (const item of items) {
      const on = item.value === value;
      parts.push('<button type="button" class="ln-menu-item' + (on ? ' is-on' : '') +
        (item.disabled ? ' is-off' : '') + '" role="option" aria-selected="' + (on ? 'true' : 'false') +
        '" data-value="' + esc(item.value) + '"' + (item.disabled ? ' disabled' : '') + '>' +
        '<span class="ln-menu-text"><span class="ln-menu-label">' + esc(item.label) + '</span>' +
        (item.meta ? '<span class="ln-menu-meta">' + esc(item.meta) + '</span>' : '') +
        '</span>' + (on ? '<span class="ln-menu-dot" aria-hidden="true"></span>' : '') + '</button>');
    }
  }
  if (!parts.length) parts.push('<div class="ln-menu-empty">Nothing to pick here yet</div>');
  el.innerHTML = parts.join('');
  el.hidden = false;
  TTS_MENU.trigger = trigger;
  TTS_MENU.pick = pick;
  TTS_MENU.open = true;
  trigger.setAttribute('aria-expanded', 'true');
  ttsMenuPlace();
  const rows = ttsMenuList();
  const at = rows.findIndex((item) => item.classList.contains('is-on'));
  ttsMenuActive(at >= 0 ? at : 0);
  document.addEventListener('keydown', ttsMenuKey, true);
  document.addEventListener('pointerdown', ttsMenuOutside, true);
  window.addEventListener('resize', ttsMenuCloseEvent);
  window.addEventListener('scroll', ttsMenuScroll, true);
}

function ttsMenuToggle(trigger, groups, value, pick) {
  if (!trigger) return;
  if (TTS_MENU.open && TTS_MENU.trigger === trigger) { ttsMenuHide(true); return; }
  ttsMenuShow(trigger, groups, value, pick);
}

/* ------------------------------------------------------------- progress -- */
function ttsPiperRunning() {
  return ttsPiperJobs().filter((job) => job.state === 'running');
}

function ttsPiperJobName(job) {
  return job.kind === 'engine' ? 'Speech engine' : ttsPiperName(job.id);
}

function ttsPiperRenderJobs() {
  const box = $('#voiceJobs');
  if (!box) return;
  const engine = TTS_LOCAL.data && TTS_LOCAL.data.engine;
  const parts = [];
  for (const job of ttsPiperRunning()) {
    const pct = ttsPiperPercent(job);
    parts.push('<div class="voice-job"><span class="voice-job-name">' + esc(ttsPiperJobName(job)) +
      (job.note ? '<span class="voice-job-note">' + esc(job.note) + '</span>' : '') + '</span>' +
      '<span class="voice-job-pct">' + ttsPiperPctText(job) + '</span>' +
      '<span class="pack-bar"><i style="width:' + pct + '%"></i></span></div>');
  }
  if (engine && engine.job && engine.job.state === 'failed') {
    parts.push('<div class="voice-job is-bad"><span class="voice-job-name">Speech engine' +
      '<span class="voice-job-note">' + esc(engine.job.error || 'Did not install') + '</span></span>' +
      '<button type="button" class="btn tiny" data-engine="retry">Retry</button></div>');
  }
  box.innerHTML = parts.join('');
  box.hidden = !parts.length;
}

function ttsPiperRenderChip() {
  const chip = $('#ttsChip');
  if (!chip) return;
  const jobs = ttsPiperRunning();
  const modal = $('#voiceLib');
  const covered = modal && !modal.hidden;
  if (!jobs.length || covered) { chip.hidden = true; return; }
  const job = jobs[0];
  const pct = ttsPiperPercent(job);
  chip.hidden = false;
  $('#ttsChipName').textContent = jobs.length > 1 ? jobs.length + ' downloads' : ttsPiperJobName(job);
  $('#ttsChipPct').textContent = ttsPiperPctText(job);
  $('#ttsChipFill').style.width = pct + '%';
}

/* ------------------------------------------------------------- drawer -- */
function ttsPiperRender() {
  const box = $('#ttsPacks');
  if (!box) return;
  const parts = [];
  const busy = ttsPiperRunning();
  if (TTS_LOCAL.error) parts.push(`<p class="set-note">${esc(TTS_LOCAL.error)}</p>`);
  for (const job of busy) {
    const pct = ttsPiperPercent(job);
    parts.push(`<div class="pack-row is-busy"><span class="pack-name">${esc(ttsPiperJobName(job))}</span>` +
      `<span class="pack-meta">${pct}%</span><span class="pack-bar"><i style="width:${pct}%"></i></span></div>`);
  }
  const packs = ttsPiperPacks();
  const on = ttsPiperActive() ? TTS.pack : '';
  for (const pack of packs) {
    parts.push(`<div class="pack-row${pack.id === on ? ' is-on' : ''}" data-pack="${esc(pack.id)}" ` +
      `role="button" tabindex="0" title="Use ${esc(pack.name)}">` +
      `<span class="pack-name">${esc(pack.name)}</span>` +
      `<span class="pack-meta">${esc(pack.langName)} · ${esc(pack.qualityName)}</span>` +
      `<button class="pack-del" data-del="${esc(pack.id)}" title="Remove ${esc(pack.name)}" ` +
      `aria-label="Remove ${esc(pack.name)}"><svg><use href="#i-close"/></svg></button></div>`);
  }
  if (!packs.length && !busy.length) {
    parts.push('<p class="set-note">No voice packs yet. Add one for a natural voice that works offline.</p>');
  }
  box.innerHTML = parts.join('');
  const add = $('#ttsAddPack');
  if (add) add.textContent = packs.length ? 'Add another voice' : 'Add a voice';
  ttsPiperRenderJobs();
  ttsPiperRenderChip();
}

/* --------------------------------------------------------------- modal -- */
function ttsPiperFillLangs() {
  const langs = ((TTS_LOCAL.data && TTS_LOCAL.data.catalog && TTS_LOCAL.data.catalog.languages) || []);
  TTS_LOCAL.langs = langs;
  if (!langs.some((lang) => lang.code === TTS_LOCAL.lang)) TTS_LOCAL.lang = '';
  const label = $('#voiceLangLabel');
  const picked = langs.find((lang) => lang.code === TTS_LOCAL.lang);
  if (label) label.textContent = picked ? picked.name : 'All languages';
  const quality = $('#voiceQualityLabel');
  if (quality) {
    const names = { '': 'Any quality', high: 'Detailed', medium: 'Balanced', low: 'Small', x_low: 'Fastest' };
    quality.textContent = names[TTS_LOCAL.quality] || 'Any quality';
  }
}

function ttsPiperRow(voice, installed, job) {
  const pct = ttsPiperPercent(job);
  const off = voice.supported === false;
  let side;
  if (installed) {
    side = (TTS.pack === voice.id
      ? '<span class="voice-in-use">In use</span>'
      : `<button class="btn tiny ghost" data-use="${esc(voice.id)}">Use</button>`) +
      `<button class="ic-btn small" data-del="${esc(voice.id)}" title="Remove"><svg><use href="#i-close"/></svg></button>`;
  } else if (job && job.state === 'running') {
    side = `<span class="voice-pct">${pct}%</span>`;
  } else if (off) {
    side = '<span class="voice-off">Not yet</span>';
  } else {
    side = `<button class="btn tiny" data-get="${esc(voice.id)}">Download</button>`;
  }
  const bar = job && job.state === 'running'
    ? `<span class="pack-bar"><i style="width:${pct}%"></i></span>` : '';
  return `<div class="voice-row${installed ? ' is-in' : ''}${off ? ' is-off' : ''}" data-row="${esc(voice.id)}"` +
    ` title="${off ? 'This language needs a model the reader does not carry yet' : esc(voice.name)}">` +
    `<div class="voice-main"><span class="voice-name">${esc(voice.name)}</span>` +
    `<span class="voice-meta">${esc(voice.langName)} · ${esc(voice.qualityName)} · ` +
    `${ttsPiperSize(voice.size)}${voice.speakers > 1 ? ' · ' + voice.speakers + ' speakers' : ''}</span></div>` +
    `<div class="voice-side">${side}</div>${bar}</div>`;
}

function ttsPiperRenderList() {
  const box = $('#voiceList');
  if (!box) return;
  if (!TTS_LOCAL.voices) return;
  const query = ($('#voiceQuery') ? $('#voiceQuery').value : '').trim().toLowerCase();
  const lang = TTS_LOCAL.lang || '';
  const quality = TTS_LOCAL.quality || '';
  const have = new Set(ttsPiperPacks().map((pack) => pack.id));
  const jobs = new Map(ttsPiperJobs().map((job) => [job.id, job]));
  const rows = TTS_LOCAL.voices.filter((voice) => {
    if (lang && voice.lang !== lang) return false;
    if (quality && voice.quality !== quality) return false;
    if (!query) return true;
    return (voice.name + ' ' + voice.langName + ' ' + voice.id).toLowerCase().includes(query);
  });
  const count = $('#voiceCount');
  if (count) {
    const base = rows.length === TTS_LOCAL.voices.length
      ? TTS_LOCAL.voices.length + ' voices'
      : rows.length + ' of ' + TTS_LOCAL.voices.length + ' voices';
    count.textContent = have.size ? base + ' · ' + have.size + ' installed' : base;
  }
  box.innerHTML = rows.length
    ? rows.map((voice) => ttsPiperRow(voice, have.has(voice.id), jobs.get(voice.id))).join('')
    : '<p class="set-note">No voice matches that. Try another language or a shorter search.</p>';
  ttsPiperRenderJobs();
}
/* ------------------------------------------------------------- actions -- */
async function ttsPiperDownload(id) {
  if (TTS_LOCAL.busy) return;
  const voice = (TTS_LOCAL.voices || []).find((item) => item.id === id);
  if (voice && voice.supported === false) {
    toast('This voice needs a language model the reader does not carry yet', { timeout: 3200 });
    return;
  }
  TTS_LOCAL.busy = 'download';
  ttsPiperRenderList();
  try {
    const out = await postJSON('/api/tts/download', { id });
    if (out && out.engine) { const data = { ...out }; delete data.voices; TTS_LOCAL.data = data; }
  } catch (err) {
    toast(err.message || 'That download did not start');
  } finally {
    TTS_LOCAL.busy = '';
  }
  ttsPiperRender();
  ttsPiperRenderList();
  ttsPiperWatch();
}

function ttsPiperUse(id, quiet) {
  const pack = ttsPiperPack(id);
  if (!pack) return;
  TTS.engine = 'piper';
  TTS.pack = id;
  ttsSavePrefs();
  TTS_LOCAL.warmKey = '';
  ttsPiperWarm();
  ttsLoadVoices();
  ttsPiperRender();
  if (!quiet) {
    hideEl($('#voiceLib'), MOTION.fast);
    ttsPiperRenderChip();
    toast('Reading with ' + pack.name + ' · ' + pack.langName, { timeout: 2400 });
  }
  if (TTS.playing || TTS.paused) ttsRestart();
}

async function ttsPiperRemove(id) {
  const pack = ttsPiperPack(id);
  try {
    TTS_LOCAL.data = await postJSON('/api/tts/remove', { id });
  } catch (err) {
    toast(err.message || 'Could not remove that voice');
    return;
  }
  if (TTS.pack === id) {
    TTS.engine = 'system';
    TTS.pack = '';
    ttsSavePrefs();
  }
  TTS_LOCAL.warmKey = '';
  ttsLoadVoices();
  ttsPiperRender();
  ttsPiperRenderList();
  toast((pack ? pack.name : 'Voice') + ' removed', { timeout: 2200 });
}

async function ttsPiperOpenLib() {
  const modal = $('#voiceLib');
  if (!modal) return;
  ttsPiperBind();
  showEl(modal);
  ttsPiperRenderChip();
  ttsPiperRenderJobs();
  const list = $('#voiceList');
  if (TTS_LOCAL.voices) {
    ttsPiperFillLangs();
    ttsPiperRenderList();
    return;
  }
  list.innerHTML = '<p class="set-note">Getting the list of voices…</p>';
  try {
    const data = await postJSON('/api/tts/catalog', {});
    TTS_LOCAL.voices = data.voices || [];
    TTS_LOCAL.data = { engine: data.engine, installed: data.installed, jobs: data.jobs, catalog: data.catalog };
    ttsPiperFillLangs();
    ttsPiperRenderList();
    ttsPiperRender();
    ttsPiperWatch();
  } catch (err) {
    list.innerHTML = '<p class="set-note">' + esc(err.message || 'Could not load the voice list') + '</p>';
  }
}

/* ---------------------------------------------------------------- bind -- */
function ttsPiperBind() {
  const packs = $('#ttsPacks');
  if (packs && !packs.dataset.bound) {
    packs.dataset.bound = '1';
    packs.addEventListener('click', (ev) => {
      const del = ev.target.closest('[data-del]');
      if (del) { ev.stopPropagation(); ttsPiperRemove(del.dataset.del); return; }
      const row = ev.target.closest('[data-pack]');
      if (row) ttsPiperUse(row.dataset.pack);
    });
  }
  const add = $('#ttsAddPack');
  if (add && !add.dataset.bound) {
    add.dataset.bound = '1';
    add.onclick = () => ttsPiperOpenLib();
  }
  const packsWrap = $('#ttsPacks');
  if (packsWrap && !packsWrap.dataset.boundKey) {
    packsWrap.dataset.boundKey = '1';
    packsWrap.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const row = ev.target.closest('[data-pack]');
      if (!row) return;
      ev.preventDefault();
      ttsPiperUse(row.dataset.pack);
    });
  }
  const list = $('#voiceList');
  if (list && !list.dataset.bound) {
    list.dataset.bound = '1';
    list.addEventListener('click', (ev) => {
      const get = ev.target.closest('[data-get]');
      if (get) { ttsPiperDownload(get.dataset.get); return; }
      const use = ev.target.closest('[data-use]');
      if (use) { ttsPiperUse(use.dataset.use); return; }
      const del = ev.target.closest('[data-del]');
      if (del) ttsPiperRemove(del.dataset.del);
    });
  }
  const query = $('#voiceQuery');
  if (query && !query.dataset.bound) {
    query.dataset.bound = '1';
    let wait = 0;
    query.addEventListener('input', () => {
      clearTimeout(wait);
      wait = setTimeout(ttsPiperRenderList, 140);
    });
  }
  const voiceBtn = $('#ttsVoice');
  if (voiceBtn && !voiceBtn.dataset.bound) {
    voiceBtn.dataset.bound = '1';
    const open = () => {
      if (typeof ttsVoiceGroups !== 'function') return;
      ttsMenuToggle(voiceBtn, ttsVoiceGroups(), ttsVoiceValue(), ttsVoiceApply);
    };
    voiceBtn.addEventListener('click', open);
    voiceBtn.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
      ev.preventDefault();
      if (TTS_MENU.open && TTS_MENU.trigger === voiceBtn) return;
      open();
      ttsMenuActive(ev.key === 'ArrowDown' ? 0 : ttsMenuList().length - 1);
    });
  }
  const langBtn = $('#voiceLang');
  if (langBtn && !langBtn.dataset.bound) {
    langBtn.dataset.bound = '1';
    langBtn.addEventListener('click', () => {
      const items = [{ value: '', label: 'All languages', meta: (TTS_LOCAL.voices || []).length + ' voices' }]
        .concat((TTS_LOCAL.langs || []).map((lang) => ({
          value: lang.code, label: lang.name, meta: lang.count + (lang.count === 1 ? ' voice' : ' voices'),
        })));
      ttsMenuToggle(langBtn, [{ items }], TTS_LOCAL.lang, (value) => {
        TTS_LOCAL.lang = value;
        ttsPiperFillLangs();
        ttsPiperRenderList();
      });
    });
  }
  const qualityBtn = $('#voiceQuality');
  if (qualityBtn && !qualityBtn.dataset.bound) {
    qualityBtn.dataset.bound = '1';
    const all = [
      ['', 'Any quality', 'Every size'],
      ['high', 'Detailed', 'Biggest, clearest'],
      ['medium', 'Balanced', 'Good all-round'],
      ['low', 'Small', 'Faster, lighter'],
      ['x_low', 'Fastest', 'Smallest'],
    ];
    qualityBtn.addEventListener('click', () => {
      const items = all.map(([value, label, meta]) => ({ value, label, meta }));
      ttsMenuToggle(qualityBtn, [{ items }], TTS_LOCAL.quality, (value) => {
        TTS_LOCAL.quality = value;
        ttsPiperFillLangs();
        ttsPiperRenderList();
      });
    });
  }
  const jobs = $('#voiceJobs');
  if (jobs && !jobs.dataset.bound) {
    jobs.dataset.bound = '1';
    jobs.addEventListener('click', (ev) => {
      const retry = ev.target.closest('[data-engine]');
      if (!retry) return;
      retry.disabled = true;
      ttsPiperRetryEngine();
    });
  }
  const chip = $('#ttsChip');
  if (chip && !chip.dataset.bound) { chip.dataset.bound = '1'; chip.onclick = () => ttsPiperOpenLib(); }
  const done = $('#voiceLibDone');
  if (done && !done.dataset.bound) {
    done.dataset.bound = '1';
    done.onclick = () => { hideEl($('#voiceLib'), MOTION.fast); ttsPiperRenderChip(); };
  }
  const modal = $('#voiceLib');
  if (modal && !modal.dataset.bound) {
    modal.dataset.bound = '1';
    modal.addEventListener('click', (ev) => {
      if (ev.target !== modal) return;
      hideEl(modal, MOTION.fast);
      ttsPiperRenderChip();
    });
  }
}

async function ttsPiperRetryEngine() {
  try {
    const data = await postJSON('/api/tts/catalog', {});
    if (data.voices) TTS_LOCAL.voices = data.voices;
    TTS_LOCAL.data = { engine: data.engine, installed: data.installed, jobs: data.jobs, catalog: data.catalog };
  } catch (err) {
    toast(err.message || 'Could not start the engine installer');
  }
  ttsPiperRender();
  ttsPiperRenderList();
  ttsPiperWatch();
}
