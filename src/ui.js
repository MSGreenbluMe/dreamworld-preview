// ui.js — the tuning surface.
//
// Every number that shapes the look of the world is reachable here while it
// runs. This is not game UI; it is the instrument panel the world is tuned
// with, and it is deliberately built before anything else needs it.
//
// UI strings are Czech by decision (see NEXT.md). Code, comments and
// documentation stay English.

import { deviationFrom, paletteName, PALETTE_COUNT } from './deviation.js';
import { ELEMENTS_BUILT, presenceFrom, emptyOverrides } from './presence.js';

const SETTINGS_KEY = 'dreamworld.settings.v1';

// What is saved on this machine was written by some older version of the
// code, and it sits in front of every default. That is right for a number
// the owner has moved by hand, and wrong for one he has never touched: a
// default retuned here would never reach him. So each step that retunes a
// default raises this number and lists the keys it retuned; those are taken
// fresh once, and everything else he has set is left alone.
const SETTINGS_VERSION = 2;
const RETUNED = {
  // The wash, retuned once it could be seen at all against the wide wake.
  2: {
    trace: ['wetDry', 'washOn', 'washEdge', 'washRag', 'washRagScale',
      'washRim', 'washFresh', 'washWake'],
  },
};

function takeFresh(saved, from) {
  for (let v = from + 1; v <= SETTINGS_VERSION; v++) {
    const groups = RETUNED[v];
    if (!groups) continue;
    for (const group of Object.keys(groups)) {
      if (!saved[group]) continue;
      for (const key of groups[group]) delete saved[group][key];
    }
  }
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function loadSettings(defaults) {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { version: SETTINGS_VERSION, ...defaults };
    const saved = JSON.parse(raw);
    takeFresh(saved, saved.version || 1);
    return {
      version: SETTINGS_VERSION,
      identity: saved.identity ?? defaults.identity,
      epoch: saved.epoch ?? defaults.epoch,
      dev: { ...defaults.dev, ...(saved.dev || {}) },
      base: { ...defaults.base, ...(saved.base || {}) },
      trace: { ...defaults.trace, ...(saved.trace || {}) },
      region: { ...defaults.region, ...(saved.region || {}) },
      air: { ...defaults.air, ...(saved.air || {}) },
      walker: { ...defaults.walker, ...(saved.walker || {}) },
      presence: { ...defaults.presence, ...(saved.presence || {}) },
      quality: { ...defaults.quality, ...(saved.quality || {}) },
    };
  } catch (err) {
    console.warn('settings: could not load', err);
    return { version: SETTINGS_VERSION, ...defaults };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('settings: could not save', err);
  }
}

const TAU = Math.PI * 2;

// [key, label, min, max, step]
const PRESENCE_LABELS = {
  sky: 'obloha',
  clouds: 'mraky',
  cloudShadows: 'stíny mraků',
  relief: 'reliéf',
  groundCover: 'porost',
  monument: 'ta velká věc',
  brokenLaw: 'porušený zákon',
};

const AIR_FIELDS = [
  ['paletteIndex', 'paleta', 0, PALETTE_COUNT - 1, 1],
  ['paletteShift', 'posun barev', -0.06, 0.06, 0.002],
  ['paletteLift', 'světlost palety', -0.09, 0.09, 0.002],
  ['lightAngle', 'směr světla', 0, TAU, 0.01],
  ['lightHeight', 'výška světla', 0.03, 0.95, 0.01],
  ['lightWarmth', 'teplota světla', -0.2, 0.2, 0.005],
  ['viewDistance', 'dohlednost (m)', 40, 400, 1],
  ['fogDensity', 'hustota mlhy', 0.3, 2.5, 0.01],
  ['windDir', 'směr větru', 0, TAU, 0.01],
  ['windSpeed', 'síla větru', 0, 4, 0.01],
  ['grainScale', 'měřítko zrna', 0.2, 4, 0.01],
  ['grainStrength', 'síla zrna', 0, 1.5, 0.01],
  ['sunAngle', 'velikost slunce', 0.02, 0.6, 0.005],
  ['skyProbe', 'dosah oblohy (m)', 5, 200, 1],
];

const WALKER_FIELDS = [
  ['speed', 'rychlost (m/s)', 0.2, 4, 0.05],
  ['range', 'okruh (m)', 30, 600, 5],
  ['spacing', 'hustota stopy (m)', 0.4, 6, 0.1],
  ['trail', 'délka stopy (bodů)', 0, 3000, 50],
];

const CLOUD_FIELDS = [
  ['cloudCover', 'pokrytí', 0, 1, 0.01],
  ['cloudHeight', 'výška (m)', 80, 1500, 10],
  ['cloudScale', 'měřítko', 0.001, 0.012, 0.0002],
  ['cloudDrift', 'unášení', 0, 15, 0.05],
  ['shadowStrength', 'síla stínu', 0, 1, 0.01],
];

const GROUND_FIELDS = [
  ['swellAmp', 'vlna — výška (m)', 0, 8, 0.05],
  ['swellScale', 'vlna — délka (m)', 100, 900, 5],
  ['rollAmp', 'zvlnění — výška (m)', 0, 1.5, 0.01],
  ['rollScale', 'zvlnění — délka (m)', 6, 60, 0.5],
  ['reliefAmp', 'reliéf — výška (m)', 0, 40, 0.5],
  ['reliefScale', 'reliéf — délka (m)', 30, 400, 5],
  ['breathAmp', 'dýchání (m)', 0, 0.4, 0.005],
];

const REGION_FIELDS = [
  ['cell', 'velikost kraje (m)', 120, 2000, 10],
  ['amplitude', 'zdvih obzoru (m)', 0, 90, 1],
];

const TRACE_FIELDS = [
  ['radius', 'šířka stopy (m)', 0.4, 4, 0.05],
  ['strength', 'hloubka stopy (m)', 0, 0.5, 0.005],
  ['permanence', 'trvalost', 0, 1, 0.01],
  ['settle', 'usazování (s)', 10, 600, 5],
  ['spacing', 'rozestup bodů (m)', 0.2, 2, 0.05],
  ['bloomRadius', 'šířka rozkvětu (m)', 2, 60, 0.5],
  ['bloomRise', 'doba probuzení (s)', 0, 60, 0.5],
  ['wakeRadius', 'šířka krajiny (m)', 40, 800, 10],
  ['wakeRise', 'probuzení krajiny (s)', 1, 120, 1],
];

// The walked line as a wash of paint rather than a smear.
const WASH_FIELDS = [
  ['washOn', 'rozpití (0 vyp / 1 zap)', 0, 1, 1],
  ['washEdge', 'ostrost čela', 0, 1, 0.02],
  ['washWake', 'probuzení do dálky', 0, 0.6, 0.01],
  ['washRag', 'roztřepení čela', 0, 0.35, 0.005],
  ['washRagScale', 'šířka třásní (m)', 2, 40, 0.5],
  ['washRim', 'tmavý okraj', 0, 0.6, 0.01],
  ['washFresh', 'tmavost čerstvé', 0, 0.5, 0.01],
  ['washInk', 'obarvení stébel', 0.6, 2.2, 0.05],
  ['wetDry', 'schnutí (s)', 10, 600, 5],
  ['meetGrow', 'křížení — růst', 0, 1.5, 0.01],
  ['meetWet', 'křížení — vlhkost', 0, 1, 0.01],
];

function formatValue(v, step) {
  const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2
    : step >= 0.001 ? 3 : 4;
  return v.toFixed(dec);
}

// How long ago, in words, because a timestamp tells nobody anything.
function ago(at) {
  const s = Math.max(0, (Date.now() - at) * 0.001);
  if (s < 90) return 'před chvílí';
  const m = s / 60;
  if (m < 60) return 'před ' + Math.round(m) + ' min';
  const h = m / 60;
  if (h < 36) return 'před ' + Math.round(h) + ' h';
  const d = Math.round(h / 24);
  return 'před ' + d + (d < 5 ? ' dny' : ' dní');
}

export function createUI(opts) {
  const {
    settings, onChange, onTraceParams, onClearTraces, onReset, onQuality,
    localBloom = () => 1, quality = () => null,
    onRestoreTraces = () => 0, traceStatus = () => null,
    airStatus = () => [], onVisitor = () => '',
    walkerStatus = () => null, onClearWalker = () => 0,
  } = opts;

  const root = el('div', 'panel');
  const head = el('div', 'panel-head');
  head.appendChild(el('span', 'panel-title', 'Dream World'));
  head.appendChild(el('span', 'panel-hint', 'H skryje panel'));
  root.appendChild(head);

  const body = el('div', 'panel-body');
  root.appendChild(body);

  const refreshers = [];
  // Lines that move on their own, whether or not anything was
  // touched: what the governor is doing, how long the walk is, what
  // has gone wrong. The frame loop ticks these a few times a second.
  const live = [];

  function addGroup(title, note) {
    const g = el('div', 'group');
    g.appendChild(el('div', 'group-title', title));
    if (note) g.appendChild(el('div', 'group-note', note));
    body.appendChild(g);
    return g;
  }

  // One row, driven by a getter and a setter rather than by an object and a
  // key, so a slider can stand for a computed value as easily as a stored one.
  function addSlider(parent, label, min, max, step, get, set, after) {
    const row = el('label', 'row');
    row.appendChild(el('span', 'row-label', label));
    const input = el('input');
    input.type = 'range';
    input.min = min; input.max = max; input.step = step;
    input.value = get();
    const val = el('span', 'row-value', formatValue(get(), step));
    input.addEventListener('input', () => {
      set(parseFloat(input.value));
      val.textContent = formatValue(get(), step);
      if (after) after();
      onChange();
    });
    row.appendChild(input);
    row.appendChild(val);
    parent.appendChild(row);
    const sync = () => {
      input.value = get();
      val.textContent = formatValue(get(), step);
    };
    refreshers.push(sync);
    return sync;
  }

  function addFields(parent, fields, target, after) {
    for (const [key, label, min, max, step] of fields) {
      addSlider(parent, label, min, max, step,
        () => target[key], (v) => { target[key] = v; }, after);
    }
  }

  // ---------------------------------------------------------------- growth
  const ggrow = addGroup('Růst',
    'růst je strop, který dá život člověka; svět se probouzí tam, '
    + 'kudy jsi šel, a jinde zůstává nic');

  addSlider(ggrow, 'růst', 0, 1, 0.005,
    () => settings.dev.growth,
    (v) => {
      settings.dev.growth = v;
      // Moving growth puts every element back under its control.
      settings.presence = emptyOverrides();
    },
    () => refresh());

  // These read the presence where the player is standing. Dragging one
  // pins that element everywhere instead, which is how it gets tuned.
  for (const key of ELEMENTS_BUILT) {
    addSlider(ggrow, PRESENCE_LABELS[key], 0, 1, 0.01,
      () => presenceFrom(settings.dev.growth * localBloom(), settings.presence)[key],
      (v) => { settings.presence[key] = v; });
  }

  // -------------------------------------------------------------- identity
  const gid = addGroup('Odchylka', 'osobní vrstva — mění jen vzduch, nikdy zem');
  const paletteLabel = el('div', 'group-note', '');
  const idRow = el('div', 'row');
  const idInput = el('input', 'text');
  idInput.type = 'text';
  idInput.value = settings.identity;
  idInput.spellcheck = false;

  // The deviation object is written into, never replaced: the sliders hold
  // a reference to it and would otherwise end up editing a discarded copy.
  // Growth survives a reroll — it is a life, not a dice throw.
  function reroll() {
    const growth = settings.dev.growth;
    Object.assign(settings.dev,
      deviationFrom(settings.identity, settings.epoch, growth));
    refresh();
    onChange();
  }

  idInput.addEventListener('change', () => {
    settings.identity = idInput.value;
    reroll();
  });
  const rerollBtn = el('button', 'btn', 'jiný den');
  rerollBtn.title = 'Tatáž identita v jiném čase dá jiný svět';
  rerollBtn.addEventListener('click', () => {
    settings.epoch = (settings.epoch + 1) | 0;
    reroll();
  });
  idRow.appendChild(el('span', 'row-label', 'identita'));
  idRow.appendChild(idInput);
  idRow.appendChild(rerollBtn);
  gid.appendChild(idRow);

  const showPaletteName = () => {
    paletteLabel.textContent = 'paleta: ' + paletteName(settings.dev);
  };
  addFields(gid, AIR_FIELDS, settings.dev, showPaletteName);
  gid.appendChild(paletteLabel);
  refreshers.push(showPaletteName);

  // ------------------------------------------------------------------- air
  const gair = addGroup('Vzduch místa',
    'stopa si pamatuje, kdo ji udělal — vzduch místa je směs jeho autorů '
    + 'podle toho, kolik z něj kdo probudil; kde nešel nikdo, je tvůj');

  addSlider(gair, 'míchání', 1, 4, 0.05,
    () => settings.air.mix, (v) => { settings.air.mix = v; });

  const airNote = el('div', 'group-note', '');
  gair.appendChild(airNote);

  // There is no second walker yet, and the air of somebody else is
  // invisible without one. This lays a stretch of trace across the way
  // ahead under another name, so there is something to walk into.
  const visitRow = el('div', 'row buttons');
  const visitName = el('input', 'text');
  visitName.type = 'text';
  visitName.value = 'poutník';
  visitName.placeholder = 'jméno';
  visitName.spellcheck = false;
  const visitBtn = el('button', 'btn', 'prošel tu');
  visitBtn.title = 'Položí přes cestu před tebou stopu pod cizím jménem, '
    + 'aby bylo do čeho vejít. Smazat stopy to vezme zpátky.';
  visitBtn.addEventListener('click', () => {
    const who = onVisitor(visitName.value);
    visitBtn.textContent = who + ' tu prošel';
    refreshTraces();
  });
  visitRow.appendChild(visitName);
  visitRow.appendChild(visitBtn);
  gair.appendChild(visitRow);

  // ---------------------------------------------------------- the walker
  const gwalk = addGroup('Druhý chodec',
    'nikdo na druhém konci drátu — jeho cesta je funkce času, takže dva '
    + 'stroje ho vidí na stejném místě; chodí po uzavřené dráze, takže se '
    + 'vrací, a nechává za sebou stopu pod svým jménem');

  addSlider(gwalk, 'zapnutý', 0, 1, 1,
    () => settings.walker.on, (v) => { settings.walker.on = v; });

  const walkRow = el('div', 'row');
  const walkName = el('input', 'text');
  walkName.type = 'text';
  walkName.value = settings.walker.identity;
  walkName.spellcheck = false;
  walkName.addEventListener('change', () => {
    settings.walker.identity = walkName.value;
    onChange();
  });
  walkRow.appendChild(el('span', 'row-label', 'jméno'));
  walkRow.appendChild(walkName);
  walkRow.appendChild(el('span', 'row-value', ''));
  gwalk.appendChild(walkRow);
  refreshers.push(() => { walkName.value = settings.walker.identity; });

  addFields(gwalk, WALKER_FIELDS, settings.walker);

  const walkNote = el('div', 'group-note', '');
  gwalk.appendChild(walkNote);

  const walkClear = el('button', 'btn', 'smazat jeho stopy');
  walkClear.title = 'Vezme zpátky jen jeho body. Tvoje zůstanou.';
  walkClear.addEventListener('click', () => {
    const n = onClearWalker();
    walkClear.textContent = n > 0 ? 'smazáno: ' + n + ' bodů' : 'nic tu nemá';
    refreshTraces();
  });
  const walkClearRow = el('div', 'row buttons');
  walkClearRow.appendChild(walkClear);
  gwalk.appendChild(walkClearRow);

  // Where he is, in the only terms that help: how far, and whether to turn
  // round. There is no north in this world yet to point at.
  function whichWay(turn) {
    const t = Math.abs(turn);
    const side = turn > 0 ? 'vpravo' : 'vlevo';
    if (t < 0.39) return 'přímo před tebou';
    if (t < 1.18) return 'před tebou ' + side;
    if (t < 1.96) return side;
    if (t < 2.75) return 'za tebou ' + side;
    return 'přímo za tebou';
  }

  function refreshWalker() {
    const w = walkerStatus();
    if (!w) { walkNote.textContent = ''; return; }
    if (!w.on) {
      walkNote.textContent = 'chodec je vypnutý'
        + (w.points ? ' · po jeho stopě zbylo ' + w.points + ' bodů' : '');
      return;
    }
    walkNote.textContent = w.identity + ' je ' + Math.round(w.distance)
      + ' m ' + whichWay(w.turn) + ' · za sebou má ' + w.points + ' bodů';
  }
  live.push(refreshWalker);

  function refreshAir() {
    const parts = airStatus();
    airNote.textContent = 'vzduch zde: ' + (parts.length
      ? parts.map((q) => q.identity + ' ' + Math.round(q.weight * 100) + ' %')
        .join(' · ')
      : 'nikdo tu nebyl');
  }
  live.push(refreshAir);

  // ---------------------------------------------------------------- clouds
  const gcloud = addGroup('Mraky', 'jedno pole — nahoře i jako stín na zemi');
  addFields(gcloud, CLOUD_FIELDS, settings.dev);

  // ---------------------------------------------------------------- region
  const gregion = addGroup('Kraje',
    'v každém kraji přestane platit jeden zákon — zatím obzor, který se '
    + 'zvedá do mísy; sdílená zem, jde přes směs party');
  addFields(gregion, REGION_FIELDS, settings.region);

  // ---------------------------------------------------------------- ground
  const gground = addGroup('Základní svět', 'sdílená zem — stejná pro všechny');
  addFields(gground, GROUND_FIELDS, settings.base);

  // ---------------------------------------------------------------- traces
  const gtrace = addGroup('Stopy', 'jediné orientační body, jaké tu kdy budou');
  addFields(gtrace, TRACE_FIELDS, settings.trace, onTraceParams);

  // ------------------------------------------------------------------ wash
  const gwash = addGroup('Rozpití',
    'chůze je rozlitá barva — čelo se někde rozbíhá dopředu a jinde '
    + 'zaostává, čerstvé je tmavé a nejtmavší na okraji, schnutím bledne');
  addFields(gwash, WASH_FIELDS, settings.trace, onTraceParams);

  const traceButtons = el('div', 'row buttons');
  const clearBtn = el('button', 'btn', 'smazat stopy');
  clearBtn.addEventListener('click', () => { onClearTraces(); refreshTraces(); });
  const resetBtn = el('button', 'btn', 'zpět na výchozí');
  resetBtn.addEventListener('click', () => { onReset(); refresh(); });
  traceButtons.appendChild(clearBtn);
  traceButtons.appendChild(resetBtn);
  gtrace.appendChild(traceButtons);

  // The walked line is the one thing here that cannot be recomputed, so
  // whenever a save was about to shorten it the old one was kept instead.
  // That shelf is no use unless it can be seen and handed back, which is
  // what these two are for.
  const keptNote = el('div', 'group-note', '');
  gtrace.appendChild(keptNote);
  const keptBtn = el('button', 'btn', 'vrátit zálohu');
  keptBtn.addEventListener('click', () => {
    const n = onRestoreTraces();
    keptBtn.textContent = n > 0 ? 'vráceno: ' + n + ' bodů' : 'není co vrátit';
    refreshTraces();
  });
  const keptRow = el('div', 'row buttons');
  keptRow.appendChild(keptBtn);
  gtrace.appendChild(keptRow);

  function refreshTraces() {
    const t = traceStatus();
    if (!t) { keptNote.textContent = ''; keptBtn.disabled = true; return; }
    let text = 'stopy: ' + t.points + ' bodů';
    if (t.readOnly) text += ' · tahle stránka neukládá (?nosave)';
    if (t.kept.length) {
      const k = t.kept[0];
      text += ' · záloha: ' + k.count + ' bodů'
        + (k.at ? ' (' + ago(k.at) + ')' : '');
      if (t.kept.length > 1) text += ' · a další ' + (t.kept.length - 1);
    } else {
      text += ' · žádná záloha';
    }
    keptNote.textContent = text;
    keptBtn.disabled = t.kept.length === 0;
  }
  live.push(refreshTraces);

  // ---------------------------------------------------------------- cost
  const gcost = addGroup('Obraz', 'kolik pixelů karta dostane — nic o světě');
  addSlider(gcost, 'automatika', 0, 1, 1,
    () => settings.quality.auto,
    (v) => { settings.quality.auto = v; }, onQuality);
  // Taking hold of the resolution takes it away from the governor: that is
  // the switch back to manual, and there is nothing else to remember.
  const syncScale = addSlider(gcost, 'rozlišení', 0.4, 1.6, 0.05,
    () => settings.quality.scale,
    (v) => { settings.quality.scale = v; settings.quality.auto = 0; },
    () => { onQuality(); refresh(); });
  addSlider(gcost, 'vyhlazení hran', 0, 1, 1,
    () => settings.quality.msaa,
    (v) => { settings.quality.msaa = v; });
  const qualityNote = el('div', 'group-note', '');
  gcost.appendChild(qualityNote);
  gcost.appendChild(el('div', 'group-note',
    'vyhlazení se projeví až po znovunačtení stránky'));

  // --------------------------------------------------------------- report
  const greport = addGroup('Hlášení',
    'když je něco rozbité nebo divné: tohle zkopíruje všechno, co o tom '
    + 'tenhle stroj ví, a dá se to poslat tak, jak je');
  const reportRow = el('div', 'row buttons');
  const reportBtn = el('button', 'btn', 'zkopírovat hlášení');
  reportBtn.addEventListener('click', () => {
    if (window.dreamCopyReport) window.dreamCopyReport(greport, reportBtn);
  });
  reportRow.appendChild(reportBtn);
  greport.appendChild(reportRow);
  const reportNote = el('div', 'group-note', '');
  greport.appendChild(reportNote);
  live.push(() => {
    const t = (window.dreamTroubles || []).length;
    reportNote.textContent = t
      ? 'zachycené chyby: ' + t + ' — poslední: '
        + window.dreamTroubles[t - 1].what
      : 'žádná zachycená chyba';
  });

  // The governor moves on its own, so its line is refreshed on a timer
  // rather than when something is dragged.
  function refreshQuality() {
    const q = quality();
    if (!q) { qualityNote.textContent = ''; return; }
    // The governor moves this slider; the slider has to show where it is.
    syncScale();
    const px = q.megapixels.toFixed(2) + ' Mpx';
    const sc = q.scale.toFixed(2) + '×';
    if (!q.auto) { qualityNote.textContent = 'ručně: ' + sc + ' · ' + px; return; }
    let t = 'automatika: ' + sc + ' · ' + px;
    if (q.fps > 0) t += ' · ' + Math.round(q.fps) + ' sn/s';
    if (q.helpless) t += ' · zdržuje to něco jiného než obraz';
    else if (q.late) t += ' · snímky se opožďují';
    if (q.atFloor) t += ' · níž už nejde';
    if (!q.trusted) t += ' · bez časovače karty';
    qualityNote.textContent = t;
  }
  live.push(refreshQuality);

  document.body.appendChild(root);
  // Filled in once here, so nothing in the panel is blank until the
  // first tick of the frame loop reaches it.
  refreshLive();

  function refreshLive() {
    for (const fn of live) fn();
  }

  function refresh() {
    idInput.value = settings.identity;
    for (const fn of refreshers) fn();
    refreshLive();
  }

  let visible = true;
  function toggle(force) {
    visible = force === undefined ? !visible : force;
    root.classList.toggle('hidden', !visible);
  }

  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.code === 'KeyH') toggle();
  });

  return { root, refresh, refreshLive, toggle };
}

// ------------------------------------------------------------------- HUD

export function createHUD() {
  const root = el('div', 'hud');
  const cost = el('div', 'hud-cost');
  const info = el('div', 'hud-info');
  root.appendChild(cost);
  root.appendChild(info);
  document.body.appendChild(root);

  let acc = 0, frames = 0, work = 0, gpu = 0, fps = 0, haveGpu = false;

  return {
    // The number that matters is what the card took. The time spent in
    // JavaScript is shown next to it, small, because on this world it is
    // nearly always the lesser half and used to be mistaken for the whole.
    frame(dt, workMs, gpuMs, gpuSupported) {
      acc += dt; frames++;
      work += (workMs - work) * 0.1;
      gpu = gpuMs;
      haveGpu = gpuSupported;
      if (acc >= 0.5) { fps = frames / acc; acc = 0; frames = 0; }
    },
    set(tris, calls, traces, x, z, here, megapixels, scale, auto) {
      const px = `${megapixels.toFixed(2)} Mpx`;
      cost.textContent = haveGpu
        ? `${gpu.toFixed(1)} ms karta · ${work.toFixed(1)} ms kód · ${fps.toFixed(0)} fps · ${px}`
        : `${work.toFixed(1)} ms kód · ${fps.toFixed(0)} fps · ${px}`;
      info.textContent =
        `${(tris / 1000).toFixed(0)}k trojúhelníků · ${calls} vykreslení · ` +
        `${traces} stop · ${x.toFixed(0)}, ${z.toFixed(0)} · ` +
        `svět zde ${here.toFixed(2)} · obraz ${scale.toFixed(2)}× ` +
        `${auto ? 'auto' : 'ručně'}`;
    },
  };
}

// ------------------------------------------------------------------ hint

export function createHint() {
  const root = el('div', 'hint');
  root.innerHTML =
    '<strong>klikni pro vstup</strong>' +
    '<span>WASD chůze · Shift běh · myš rozhled · Esc ven · H panel</span>';
  document.body.appendChild(root);
  return {
    show(v) { root.classList.toggle('hidden', !v); },
  };
}
