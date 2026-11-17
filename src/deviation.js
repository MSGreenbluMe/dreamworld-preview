// deviation.js — the personal layer.
//
// A player carries a handful of numbers, not a world. The numbers are
// derived by hashing an identity string (later: a Kamosféra identity —
// posts, connections, activity) and they feed coefficients in the air
// layer only: colour, light, fog, wind, cloud, grain.
//
// Nothing in here may reach the ground. The one exception is the *party*
// deviation at the bottom of this file: a mix of everyone present, which
// both clients compute identically, and which is the only thing the shared
// height function is allowed to read.

import { hash1, unitFloat } from './world.js';

function hashString(s) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = hash1((h ^ s.charCodeAt(i)) >>> 0);
  }
  return h >>> 0;
}

// n independent unit floats from one seed.
function stream(seed, n) {
  const out = [];
  let h = seed >>> 0;
  for (let i = 0; i < n; i++) {
    h = hash1((h + 0x9e3779b9) >>> 0);
    out.push(unitFloat(h));
  }
  return out;
}

const lerp = (a, b, t) => a + (b - a) * t;

// How much of the world exists for this person. This is the one number that
// is not hashed from the identity: it stands for a life accumulating in
// Kamosféra, and it is where that connection will feed in. Until then it is
// a value to be set by hand.
export const DEFAULT_GROWTH = 0.85;

// Every field is a coefficient in the air layer. Ranges are deliberately
// narrow: the palette must stay related, the light stays single.
export function deviationFrom(identity, epoch = 0, growth = DEFAULT_GROWTH) {
  const r = stream(hashString(identity + '#' + epoch), 18);
  return {
    identity,
    epoch,
    growth,
    // Which of the made palettes, and how far the world drifts inside it.
    paletteIndex: Math.floor(r[0] * (PALETTES.length - 0.001)),
    paletteShift: lerp(-0.035, 0.035, r[1]),
    paletteLift: lerp(-0.05, 0.05, r[2]),
    lightAngle: r[3] * Math.PI * 2,         // one light, any bearing
    lightHeight: lerp(0.18, 0.55, r[4]),    // low sun, long soft light
    lightWarmth: lerp(-0.10, 0.12, r[5]),   // hue offset of the light only
    fogDensity: lerp(0.85, 1.45, r[6]),     // multiplier on view distance
    // Short on purpose. The fog has to close before the ground reaches the
    // geometric horizon, otherwise the far ground stacks up into a line at
    // eye level and the world grows an edge.
    // Far enough that three or four ridges stand between the walker and
    // the fog. A landscape read as layers needs layers to read.
    viewDistance: lerp(95, 220, r[7]),      // metres before fog closes
    windDir: r[8] * Math.PI * 2,
    windSpeed: lerp(0.4, 1.8, r[9]),
    grainScale: lerp(0.7, 2.2, r[10]),      // density of surface detail
    grainStrength: lerp(0.35, 1.0, r[11]),
    cloudCover: lerp(0.18, 0.42, r[12]),    // how much sky is taken
    // Clouds are deliberately smaller and lower than real ones. The fog
    // closes at a hundred-odd metres, and a cloud of honest size casts a
    // shadow far wider than that — the plain would simply dim as a whole
    // instead of having shade travel across it.
    cloudHeight: lerp(260, 620, r[13]),     // metres to the cloud plane
    cloudScale: lerp(0.0030, 0.0075, r[14]),// noise units per metre
    // Clouds ride far faster than the breeze on the ground. At walking
    // speed the shade would take minutes to cross the visible plain and
    // would read as the light simply changing.
    cloudDrift: lerp(3.5, 9.0, r[15]),      // multiplier on the wind
    shadowStrength: lerp(0.45, 0.85, r[16]),// how dark the shade falls
    sunAngle: lerp(7, 20, r[16]) * Math.PI / 180,  // radius of the disc
    // How far along a view direction the sky asks the ground whether it
    // exists. Not hashed: it is a tuning number, not a trait.
    skyProbe: 45,
  };
}

export const DEFAULT_IDENTITY = 'dreamer';

// --------------------------------------------------------------- palette
//
// Twelve palettes, each one chosen rather than computed. The hue wheel it
// replaces guaranteed variety and could not guarantee taste: some
// identities landed on combinations nobody would pick, and one of them
// the owner called frightening.
//
// Every palette keeps the same structure, which is the part that was
// right. The ground carries the dominant colour. The sky sits beside it,
// lighter and quieter, so the ground stays dominant. One warm light is
// the single thing allowed to contradict them. And the fog is barely a
// colour at all, because the fog is the Nothing and the Nothing has no
// opinion.
//
// Written as hue, saturation, lightness so the vector can shift a whole
// palette a little without ever leaving it.
//
// Two of them are skies before they are grounds. They were taken from the
// owner's own photographs and they carry a band stack: the layers that sky
// actually had, laid from the horizon upward, as flat colour with a soft
// join. The rest keep the single ramp.
//
// This is not a return to the striped sky that was tried and removed. That
// one banded every palette by rule, so the sky competed with the ground in
// worlds that wanted a quiet one. A stack belongs to the sky it was taken
// from and to no other.
//
// Band: [elevation it begins at, how soft the join is, hue, sat, lightness].
// Elevation is the height of the view direction, 0 at the horizon and 1
// straight up, so the first numbers are small: weather lives low.
//
// `kind` is the one thing that sky had which no stack of flat bands can
// say: 1 for the white towers standing on the horizon after rain, 2 for
// the rippled rows of a mackerel morning.

export const MAX_BANDS = 6;

const PALETTES = [
  { name: 'evening meadow',
    fog: [0.17, 0.10, 0.94], zenith: [0.42, 0.17, 0.68],
    groundHigh: [0.19, 0.33, 0.55], groundLow: [0.21, 0.45, 0.29],
    trace: [0.23, 0.42, 0.21], light: [0.09, 0.88, 0.67] },

  { name: 'dry heath',
    fog: [0.10, 0.12, 0.94], zenith: [0.56, 0.20, 0.72],
    groundHigh: [0.11, 0.40, 0.58], groundLow: [0.09, 0.46, 0.33],
    trace: [0.08, 0.44, 0.24], light: [0.05, 0.85, 0.62] },

  { name: 'cold moss',
    fog: [0.48, 0.07, 0.94], zenith: [0.55, 0.18, 0.72],
    groundHigh: [0.33, 0.28, 0.54], groundLow: [0.35, 0.42, 0.30],
    trace: [0.37, 0.40, 0.22], light: [0.12, 0.78, 0.74] },

  { name: 'rust plain',
    fog: [0.05, 0.10, 0.94], zenith: [0.76, 0.14, 0.70],
    groundHigh: [0.05, 0.42, 0.51], groundLow: [0.04, 0.50, 0.29],
    trace: [0.03, 0.48, 0.21], light: [0.08, 0.80, 0.79] },

  { name: 'lavender field',
    fog: [0.83, 0.08, 0.95], zenith: [0.92, 0.16, 0.74],
    groundHigh: [0.74, 0.24, 0.62], groundLow: [0.73, 0.24, 0.37],
    trace: [0.72, 0.26, 0.27], light: [0.11, 0.82, 0.72] },

  { name: 'salt flat',
    fog: [0.13, 0.09, 0.95], zenith: [0.55, 0.16, 0.76],
    groundHigh: [0.13, 0.26, 0.72], groundLow: [0.12, 0.30, 0.45],
    trace: [0.11, 0.32, 0.34], light: [0.11, 0.90, 0.79] },

  { name: 'forest floor',
    fog: [0.25, 0.06, 0.93], zenith: [0.28, 0.10, 0.66],
    groundHigh: [0.27, 0.30, 0.44], groundLow: [0.30, 0.32, 0.22],
    trace: [0.31, 0.30, 0.16], light: [0.10, 0.80, 0.64] },

  { name: 'copper steppe',
    fog: [0.09, 0.11, 0.94], zenith: [0.48, 0.22, 0.66],
    groundHigh: [0.07, 0.42, 0.53], groundLow: [0.06, 0.46, 0.30],
    trace: [0.05, 0.44, 0.22], light: [0.95, 0.72, 0.76] },

  { name: 'blue hour',
    fog: [0.60, 0.09, 0.94], zenith: [0.63, 0.28, 0.64],
    groundHigh: [0.60, 0.14, 0.56], groundLow: [0.61, 0.20, 0.32],
    trace: [0.62, 0.22, 0.24], light: [0.09, 0.62, 0.85] },

  { name: 'autumn bracken',
    fog: [0.11, 0.11, 0.94], zenith: [0.30, 0.14, 0.69],
    groundHigh: [0.08, 0.44, 0.53], groundLow: [0.07, 0.58, 0.29],
    trace: [0.06, 0.54, 0.21], light: [0.13, 0.88, 0.68] },

  { name: 'jade terrace',
    fog: [0.16, 0.10, 0.94], zenith: [0.15, 0.20, 0.73],
    groundHigh: [0.42, 0.24, 0.55], groundLow: [0.44, 0.34, 0.30],
    trace: [0.45, 0.34, 0.22], light: [0.06, 0.82, 0.63] },

  { name: 'ash and ember',
    fog: [0.75, 0.05, 0.94], zenith: [0.76, 0.06, 0.70],
    groundHigh: [0.78, 0.06, 0.55], groundLow: [0.79, 0.08, 0.31],
    trace: [0.80, 0.10, 0.23], light: [0.03, 0.78, 0.61] },

  // The sky an hour after rain, when the sheet breaks up and its underside
  // catches the light: a washed band on the horizon, lit pink above it,
  // then grey-blue shadow, then pink again where the next gap is.
  { name: 'dusk after rain',
    fog: [0.93, 0.06, 0.93], zenith: [0.61, 0.24, 0.44],
    groundHigh: [0.54, 0.20, 0.46], groundLow: [0.56, 0.28, 0.25],
    trace: [0.58, 0.30, 0.20], light: [0.02, 0.76, 0.73],
    sky: {
      kind: 1,
      bands: [
        [0.000, 0.030, 0.085, 0.45, 0.87],
        [0.052, 0.030, 0.960, 0.54, 0.75],
        [0.125, 0.028, 0.615, 0.22, 0.46],
        [0.235, 0.045, 0.945, 0.46, 0.64],
        [0.400, 0.090, 0.620, 0.26, 0.39],
        [0.680, 0.220, 0.630, 0.30, 0.31],
      ],
    } },

  // Morning mist with the sun somewhere behind it, and a mackerel sky
  // above: rows of small cloud running away to the horizon.
  { name: 'misty morning',
    fog: [0.11, 0.05, 0.95], zenith: [0.58, 0.22, 0.68],
    groundHigh: [0.30, 0.20, 0.60], groundLow: [0.28, 0.30, 0.36],
    trace: [0.26, 0.32, 0.28], light: [0.12, 0.86, 0.80],
    sky: {
      kind: 2,
      bands: [
        [0.000, 0.055, 0.100, 0.20, 0.92],
        [0.090, 0.050, 0.120, 0.64, 0.82],
        [0.200, 0.070, 0.090, 0.16, 0.85],
        [0.380, 0.100, 0.560, 0.18, 0.78],
        [0.700, 0.250, 0.580, 0.24, 0.70],
      ],
    } },
];

export const PALETTE_COUNT = PALETTES.length;

function hslToRgb(h, s, l) {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(Math.min(k - 3, 9 - k), 1));
  };
  return [f(0), f(8), f(4)];
}

// Returns sRGB triples. Shaders mix and output in this space directly.
export function paletteFrom(d) {
  const p = PALETTES[Math.max(0, Math.min(PALETTES.length - 1,
    Math.round(d.paletteIndex)))];
  const clamp01 = (v) => Math.max(0.02, Math.min(0.98, v));
  // A narrow drift around the chosen palette, never across the wheel.
  const tint = (c, warm) => hslToRgb(
    c[0] + d.paletteShift + (warm ? d.lightWarmth * 0.4 : 0),
    c[1],
    clamp01(c[2] + d.paletteLift));
  // The stack drifts with the palette it belongs to, exactly as the six
  // plain colours do: the sky stays the sky it was taken from, and the
  // person's own vector still moves it a little.
  const bands = [];
  if (p.sky) {
    for (const b of p.sky.bands) {
      if (bands.length >= MAX_BANDS) break;
      bands.push({ at: b[0], soft: b[1], rgb: tint([b[2], b[3], b[4]]) });
    }
  }
  return {
    fog: tint(p.fog),
    zenith: tint(p.zenith),
    groundHigh: tint(p.groundHigh),
    groundLow: tint(p.groundLow),
    trace: tint(p.trace),
    light: tint(p.light, true),
    bands,
    skyKind: p.sky ? p.sky.kind : 0,
  };
}

export function paletteName(d) {
  const i = Math.max(0, Math.min(PALETTES.length - 1, Math.round(d.paletteIndex)));
  return PALETTES[i].name;
}

export function lightDirection(d) {
  const y = d.lightHeight;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  return [Math.cos(d.lightAngle) * r, y, Math.sin(d.lightAngle) * r];
}

// ----------------------------------------------------------------- party

// The ground answers to everyone standing on it at once, never to one
// person. Averaging is order-independent, so every client that knows who is
// present computes the same number without agreeing on anything else.
// With one player present, the mix is that player.
export function partyFrom(members) {
  if (!members || members.length === 0) return { growth: 0 };
  let growth = 0;
  for (const m of members) growth += m.growth || 0;
  return { growth: growth / members.length };
}

// ------------------------------------------------------- the air of a place
//
// A trace point carries its author, so a place knows everyone who ever
// walked it. The air there is their mix, weighted by how awake each of them
// has made it: your own line is your weather, somebody else's line is
// theirs, and where two lines cross there is a third air that neither of
// them has alone.
//
// The mix is a sum, never a sequence, so the order the authors are found in
// cannot change the answer. Two clients that agree on who walked a place
// get the same air out of this without agreeing on anything else, which is
// the whole reason it lives here as a pure function and not in the
// renderer.

// What may differ from place to place.
//
// Not everything can. Four of a vector's numbers are never read off a
// position at all: they are multiplied by the time since the world's epoch
// to say where a drifting pattern has got to by now. That time is tens of
// millions of seconds, so nudging the wind by a hundredth would carry the
// cloud field a hundred lattices sideways between one frame and the next.
// Anything placed by integrating against absolute time cannot vary by place
// without jumping, so the wind, the cloud drift and the cloud's own scale
// stay with the person looking. What mixes is what can be read straight off
// a position: the light, the fog, the grain, the cover, the shade — and the
// colours.
const MIXED = [
  'lightHeight', 'fogDensity', 'viewDistance',
  'grainScale', 'grainStrength',
  'cloudCover', 'cloudHeight', 'shadowStrength', 'sunAngle',
];

// A bearing has no ordinary mean: halfway between 350 and 10 degrees is 0,
// not 180. Added as unit vectors it comes out right, and still in any order.
const MIXED_ANGLES = ['lightAngle'];

// Mixed as resolved colour, not as an index. Palette 2 and palette 9 are
// two chosen things with nothing in between, while their colours do have a
// middle. Mixed in the same space the shaders mix in, which is not linear
// light: agreeing with everything else here is worth more than the half
// stop of accuracy.
function mixPalette(pals, w) {
  const out = {};
  for (const key of ['fog', 'zenith', 'groundHigh', 'groundLow', 'trace',
    'light']) {
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < pals.length; i++) {
      const c = pals[i][key];
      r += c[0] * w[i]; g += c[1] * w[i]; b += c[2] * w[i];
    }
    out[key] = [r, g, b];
  }

  // The band stacks are the one thing that will not mix cleanly. A stack is
  // a geometry of layers, and two photographed skies have different numbers
  // of them at different heights; `skyKind` is worse still, being a handful
  // of features no stack of flat colour can say.
  //
  // So a stack is not blended away: it belongs to the air while the people
  // whose sky has one hold the majority of it, and otherwise the sky is the
  // plain ramp it is for the other twelve palettes. Within a stack the
  // colours are mixed, so two stacked skies meet in colour and the layer
  // heights come from whichever of them is strongest. That leaves one seam,
  // at the half, between a stacked sky and an unstacked one — which takes
  // two people and two particular palettes to see, and is written down here
  // rather than worked around.
  let lead = -1, leadW = 0, stacked = 0;
  for (let i = 0; i < pals.length; i++) {
    if (!pals[i].bands.length) continue;
    stacked += w[i];
    if (w[i] > leadW) { leadW = w[i]; lead = i; }
  }
  out.bands = [];
  out.skyKind = 0;
  if (lead >= 0 && stacked >= 0.5) {
    const geom = pals[lead].bands;
    for (let s = 0; s < geom.length; s++) {
      let r = 0, g = 0, b = 0, sw = 0;
      for (let i = 0; i < pals.length; i++) {
        const band = pals[i].bands[s];
        if (!band) continue;
        r += band.rgb[0] * w[i]; g += band.rgb[1] * w[i];
        b += band.rgb[2] * w[i]; sw += w[i];
      }
      const inv = sw > 1e-6 ? 1 / sw : 0;
      out.bands.push({
        at: geom[s].at, soft: geom[s].soft,
        rgb: [r * inv, g * inv, b * inv],
      });
    }
    out.skyKind = pals[lead].skyKind;
  }
  return out;
}

// `entries` is [{ dev, palette, weight }] — one per author of this place,
// with weights that need not sum to one. `base` is the vector of the person
// looking: it carries the fields that cannot vary by place, and it is the
// whole answer where nobody has walked. `sharpen` is how reluctantly two
// airs mix — at one they average, and higher up a place belongs more firmly
// to whoever woke it most.
//
// Returns { dev, palette, parts }. The palette fields of `dev` are the
// looker's own and mean nothing for the mix: the returned `palette` is the
// one to draw with.
export function mixAir(entries, base, sharpen = 1) {
  const selfOnly = () => ({
    dev: base, palette: paletteFrom(base),
    parts: [{ identity: base.identity, weight: 1 }],
  });
  if (!entries || entries.length === 0) return selfOnly();

  const k = Math.max(0.25, sharpen);
  const w = [];
  let total = 0;
  for (const e of entries) {
    const v = Math.pow(Math.max(0, e.weight), k);
    w.push(v);
    total += v;
  }
  if (!(total > 0)) return selfOnly();
  for (let i = 0; i < w.length; i++) w[i] /= total;

  const parts = entries
    .map((e, i) => ({ identity: e.dev.identity, weight: w[i] }))
    .sort((a, b) => b.weight - a.weight);

  const dev = { ...base };
  for (const key of MIXED) {
    let v = 0;
    for (let i = 0; i < entries.length; i++) v += entries[i].dev[key] * w[i];
    dev[key] = v;
  }
  for (const key of MIXED_ANGLES) {
    let x = 0, y = 0;
    for (let i = 0; i < entries.length; i++) {
      x += Math.cos(entries[i].dev[key]) * w[i];
      y += Math.sin(entries[i].dev[key]) * w[i];
    }
    // Two opposite bearings cancel. Then there is no mean to speak of and
    // the person looking keeps their own.
    dev[key] = (x * x + y * y > 1e-8) ? Math.atan2(y, x) : base[key];
  }

  // One author is its own mix, and is handed back untouched rather than
  // averaged with nothing: a world with a single walker has to be the world
  // exactly as it was before any of this existed.
  const palette = entries.length === 1
    ? entries[0].palette
    : mixPalette(entries.map((e) => e.palette), w);

  return { dev, palette, parts };
}
