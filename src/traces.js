// traces.js — the walked line, and what it wakes.
//
// A trace is a point with an age and a strength. Nothing else is stored:
// no geometry, no heightmap, no terrain. Two fields are derived from the
// same points, both pure functions of the point set and the clock:
//
//   depth  — a narrow depression in the shared ground, for the path itself
//   bloom  — how awake this place is, tens of metres either side
//   wake   — the same thing over hundreds of metres, for the landscape
//
// Bloom is the mechanism behind growth. The world does not exist and then
// get turned up; it comes alive where people have walked and stays alive,
// and everywhere else there is still nothing. Traces and presence are the
// same mechanism, which is why they are computed here from the same points.
//
// Both fields are rasterised into small scrolling textures for display and
// evaluated analytically on the CPU where an exact answer is needed. The
// textures are caches, never the source of truth.
//
// Both belong to the ground layer: shared, and never touched by one
// player's own deviation vector.

import * as THREE from 'three';

const STORAGE_KEY = 'dreamworld.traces.v1';
const MAX_POINTS = 6000;              // ~3 km of walking before thinning

// The shelf: kept copies of walks that were about to be overwritten,
// newest first.
//
// Traces persist and the world does not, which makes the walked line the
// only thing here that cannot be recomputed. The browser's store has one
// key per world and no history of its own, so a single save can end a
// walk and nothing would know. The only place that can prevent it is the
// save itself: before writing, it puts what is already there aside.
//
// A walk grows as it is walked, so growth is ordinary and needs no copy.
// A save that is suddenly much smaller than what is stored is not a walk,
// it is a loss — another tab that loaded before this one, a world cleared
// by hand, a developer testing in the wrong browser. That is what gets
// kept, and the panel offers it back.
const SHELF_KEYS = [
  'dreamworld.traces.v1.kept1',
  'dreamworld.traces.v1.kept2',
  'dreamworld.traces.v1.kept3',
];
const SHRINK = 0.9;         // smaller than this share of the stored walk
const WORTH_KEEPING = 40;   // and the stored walk was at least this long

// How many points a stored payload holds, without parsing it. Everything
// written from now on says so in its first few characters; anything older
// is counted by its brackets, one per point.
function storedCount(raw) {
  const head = raw.slice(0, 64).match(/"n":(\d+)/);
  if (head) return parseInt(head[1], 10);
  let n = 0;
  for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) === 91) n++;
  return Math.max(0, n - 1);
}

function storedAt(raw) {
  const head = raw.slice(0, 64).match(/"at":(\d+)/);
  return head ? parseInt(head[1], 10) : 0;
}

// A way to walk the world without writing to it, for measuring and for
// testing in somebody else's browser. ?nosave on the address still loads
// what is there; it simply never saves over it.
function readOnlyAsked() {
  try {
    return new URLSearchParams(location.search).has('nosave');
  } catch (err) {
    return false;
  }
}

export const DEFAULT_TRACE_PARAMS = {
  // The depression is deliberately slight now. growth-and-look.md asks
  // for a path that comes alive rather than one that dents, and a narrow
  // deep groove also steps visibly against the disc's rings. The bloom
  // beside it is what the walked line is really for.
  radius: 1.4,        // metres of influence for the depression
  strength: 0.05,     // metres deep when fresh
  settle: 150.0,      // seconds to settle towards the permanent imprint
  permanence: 0.55,   // fraction of the depth that never recovers
  spacing: 0.55,      // metres between deposited points
  bloomRadius: 26.0,  // metres the world wakes either side of the line
  // Seconds before a step counts as fully awake. It has to be short
  // against radius over walking speed, or the waking ground never catches
  // up with the walker and they spend the whole time in a half-lit place.
  bloomRise: 2.0,
  // Relief answers to a far wider field than colour does. Sharing the
  // bloom's radius built an embankment that followed the trail with the
  // path's own groove along its crest — a landscape has to wake around the
  // walker, not under their feet.
  wakeRadius: 260.0,  // metres of landscape woken by being walked near
  wakeRise: 20.0,     // seconds; a hill rises slower than a footprint

  // The wash. A walked line is not a smear with soft edges; it is paint
  // on wet paper. These say how it behaves.
  wetDry: 240.0,      // seconds for fresh paint to dry pale
  washOn: 1.0,        // the whole wash, on or off, for seeing what it does
  washEdge: 0.62,     // how hard the front of the wash stops
  washRag: 0.24,      // how far the front runs ahead or hangs back
  washRagScale: 9.0,  // metres per wander of the front
  washRim: 0.36,      // how dark the pigment gathers at the front
  washFresh: 0.24,    // how much darker the whole wash is while wet
  washInk: 1.35,      // how readily the colour climbs a blade of cover
  // How much the landscape's wide wake alone lights the ground, with no
  // paint on it. The wake reaches hundreds of metres, so this is a plateau
  // of half-woken ground under everything; turned up it swallows the
  // wash's edge, turned down the walked line is all there is.
  washWake: 0.20,
};

// ------------------------------------------------------------------ store

export class TraceStore {
  constructor(params) {
    this.params = params || { ...DEFAULT_TRACE_PARAMS };
    this.points = [];        // { x, z, t0, s }
    this.fine = new Map();   // spatial hash at trace width
    this.coarse = new Map(); // spatial hash at bloom width
    this.broad = new Map();  // spatial hash at landscape width
    this.revision = 1;       // bumped on any change; fields watch it
    this.lastDeposit = null;
    this._saveAt = 0;
    this.readOnly = readOnlyAsked();
    // The panel asks what is on the shelf several times a second, and each
    // kept walk is a hundred kilobytes of text. Reading them that often
    // would cost more than drawing the world does, so the answer is
    // remembered and taken again only when it could have changed.
    this._kept = null;
    this._keptAt = 0;
    this.load();
  }

  _key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }

  _put(map, cell, p) {
    const k = this._key(Math.floor(p.x / cell), Math.floor(p.z / cell));
    let bucket = map.get(k);
    if (!bucket) { bucket = []; map.set(k, bucket); }
    bucket.push(p);
  }

  reindex() {
    this.fine.clear();
    this.coarse.clear();
    this.broad.clear();
    for (const p of this.points) this._index(p);
    this.revision++;
  }

  _index(p) {
    this._put(this.fine, this.params.radius * 2, p);
    this._put(this.coarse, this.params.bloomRadius * 2, p);
    this._put(this.broad, this.params.wakeRadius * 2, p);
  }

  add(x, z, t0, s) {
    const p = { x, z, t0, s };
    this.points.push(p);
    if (this.points.length > MAX_POINTS) {
      this.points.splice(0, Math.floor(MAX_POINTS * 0.1));
      this.reindex();
    } else {
      this._index(p);
    }
    this.revision++;
    return p;
  }

  // Walking deposits a point every `spacing` metres. Standing still adds
  // nothing, so a player cannot dig a hole, or wake a place, by waiting.
  deposit(x, z, now) {
    const sp = this.params.spacing;
    const last = this.lastDeposit;
    if (last) {
      const dx = x - last.x, dz = z - last.z;
      if (dx * dx + dz * dz < sp * sp) return false;
    }
    this.lastDeposit = this.add(x, z, now, 1.0);
    return true;
  }

  // Largest of the overlapping points rather than their sum, for both
  // fields. Points sit closer together than they are wide, and summing
  // them would turn a footpath into a trench and a walk into a floodlight.
  _peak(map, cell, radius, x, z, weight) {
    const r2 = radius * radius;
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    let peak = 0;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const bucket = map.get(this._key(cx + i, cz + j));
        if (!bucket) continue;
        for (const p of bucket) {
          const dx = x - p.x, dz = z - p.z;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r2) continue;
          const f = 1.0 - d2 / r2;
          const v = weight(p) * f * f;
          if (v > peak) peak = v;
        }
      }
    }
    return peak;
  }

  // Depth of the depression in metres. GPU twin: the splat pass below.
  depthAt(x, z, now) {
    const { radius, strength, settle, permanence } = this.params;
    return this._peak(this.fine, radius * 2, radius, x, z, (p) => {
      const age = Math.max(0, (now - p.t0) * 0.001);
      const decay = permanence + (1 - permanence) * Math.exp(-age / settle);
      return p.s * strength * decay;
    });
  }

  // How awake this place is, 0 to 1. A step does not wake the ground the
  // instant it lands, and what has woken never goes back to sleep.
  bloomAt(x, z, now) {
    const { bloomRadius, bloomRise } = this.params;
    return this._peak(this.coarse, bloomRadius * 2, bloomRadius, x, z, (p) => {
      const age = Math.max(0, (now - p.t0) * 0.001);
      return p.s * Math.min(1, age / Math.max(0.001, bloomRise));
    });
  }

  // How wet this place still is, 0 to 1: 1 the moment it was walked,
  // fading as it dries. GPU twin: the green channel of the bloom field.
  wetAt(x, z, now) {
    const { bloomRadius, wetDry } = this.params;
    return this._peak(this.coarse, bloomRadius * 2, bloomRadius, x, z, (p) => {
      const age = Math.max(0, (now - p.t0) * 0.001);
      return p.s * Math.exp(-age / Math.max(1, wetDry));
    });
  }

  // How far the landscape has woken here, 0 to 1. Wide and slow, and never
  // the same radius as the path that caused it.
  wakeAt(x, z, now) {
    const { wakeRadius, wakeRise } = this.params;
    return this._peak(this.broad, wakeRadius * 2, wakeRadius, x, z, (p) => {
      const age = Math.max(0, (now - p.t0) * 0.001);
      return p.s * Math.min(1, age / Math.max(0.001, wakeRise));
    });
  }

  clear() {
    this.points.length = 0;
    this.fine.clear();
    this.coarse.clear();
    this.broad.clear();
    this.lastDeposit = null;
    this.revision++;
    this.save(true);
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || data.v !== 1 || !Array.isArray(data.p)) return;
      for (const rec of data.p) this.add(rec[0], rec[1], rec[2], rec[3]);
      this.lastDeposit = null;
    } catch (err) {
      console.warn('traces: could not load, starting empty', err);
    }
  }

  save(force) {
    const now = Date.now();
    if (!force && now - this._saveAt < 3000) return;
    this._saveAt = now;
    if (this.readOnly) return;
    try {
      const p = this.points.map((q) => [
        Math.round(q.x * 100) / 100,
        Math.round(q.z * 100) / 100,
        q.t0,
        Math.round(q.s * 100) / 100,
      ]);
      // The count and the time go in the first few characters, so the next
      // save can tell what it is about to overwrite without reading it all.
      const payload = JSON.stringify({ v: 1, n: p.length, at: now, p });
      this._keepOld(p.length);
      localStorage.setItem(STORAGE_KEY, payload);
    } catch (err) {
      console.warn('traces: could not save', err);
    }
  }

  // Puts the stored walk on the shelf if this save would shorten it. Its
  // own failures are swallowed: a full store must not stop the real save.
  _keepOld(incoming) {
    try {
      const old = localStorage.getItem(STORAGE_KEY);
      if (!old) return;
      const had = storedCount(old);
      if (had < WORTH_KEEPING || incoming >= had * SHRINK) return;
      for (let i = SHELF_KEYS.length - 1; i > 0; i--) {
        const prev = localStorage.getItem(SHELF_KEYS[i - 1]);
        if (prev === null) localStorage.removeItem(SHELF_KEYS[i]);
        else localStorage.setItem(SHELF_KEYS[i], prev);
      }
      localStorage.setItem(SHELF_KEYS[0], old);
      this._kept = null;
    } catch (err) {
      console.warn('traces: could not keep the old walk', err);
    }
  }

  // What is on the shelf, newest first: how long each walk was and when it
  // was put aside. This is what the panel shows.
  kept() {
    const now = Date.now();
    if (this._kept && now - this._keptAt < 2000) return this._kept;
    const out = [];
    for (const key of SHELF_KEYS) {
      let raw = null;
      try { raw = localStorage.getItem(key); } catch (err) { raw = null; }
      if (!raw) continue;
      out.push({ key, count: storedCount(raw), at: storedAt(raw) });
    }
    this._kept = out;
    this._keptAt = now;
    return out;
  }

  // Brings a kept walk back. The walk it replaces goes through the same
  // save as everything else, so it lands on the shelf in its turn and this
  // is as undoable as the loss it undoes.
  restore(key) {
    let raw = null;
    try {
      raw = localStorage.getItem(key || SHELF_KEYS[0]);
    } catch (err) {
      raw = null;
    }
    if (!raw) return 0;
    let data = null;
    try { data = JSON.parse(raw); } catch (err) { return 0; }
    if (!data || !Array.isArray(data.p)) return 0;

    this.points.length = 0;
    this.fine.clear();
    this.coarse.clear();
    this.broad.clear();
    this.lastDeposit = null;
    for (const rec of data.p) this.add(rec[0], rec[1], rec[2], rec[3]);
    this.revision++;
    this._kept = null;
    // A read-only session can look at a kept walk without adopting it.
    this.save(true);
    return this.points.length;
  }
}

// ------------------------------------------------------------------ field

// Each point carries two numbers, not one: what it is worth to this field,
// and — for the bloom — how wet it still is. They ride in two channels of
// the same texture, so reading both later costs one fetch, not two.
const SPLAT_VERT = /* glsl */`
attribute vec2 aValue;
varying vec2 vValue;
uniform float uTexels;
uniform float uFieldSize;
uniform float uRadius;
void main() {
  vValue = aValue;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = 2.0 * uRadius / uFieldSize * uTexels;
}
`;

const SPLAT_FRAG = /* glsl */`
varying vec2 vValue;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d2 = dot(c, c) * 4.0;
  if (d2 >= 1.0) discard;
  float f = 1.0 - d2;
  gl_FragColor = vec4(vValue * f * f, 0.0, 1.0);
}
`;

// The two fields differ only in how wide they are, how far they reach and
// what each point is worth. Everything else is the same machine.
const DEPTH_CONFIG = {
  prefix: 'uTrace',
  size: 200,     // metres covered
  texels: 1024,  // 0.2 m each: the path is only a metre wide
  radius: (params) => params.radius,
  weight: (params) => (p, age) => {
    const decay = params.permanence
      + (1 - params.permanence) * Math.exp(-age / params.settle);
    return p.s * params.strength * decay;
  },
};

const BLOOM_CONFIG = {
  prefix: 'uBloom',
  size: 512,     // metres covered: bloom has to outreach the fog
  texels: 512,   // 1 m each: it is a wide soft thing, it needs no detail
  radius: (params) => params.bloomRadius,
  weight: (params) => (p, age) =>
    p.s * Math.min(1, age / Math.max(0.001, params.bloomRise)),
  // Second channel: wet paint. Full the moment a step lands, and drying
  // from then on. What has woken never sleeps, but it does dry.
  weight2: (params) => (p, age) =>
    p.s * Math.exp(-age / Math.max(1, params.wetDry)),
};

const WAKE_CONFIG = {
  prefix: 'uWake',
  size: 2400,    // metres: the landscape reaches far past the fog
  texels: 256,   // 9 m each, and it is smoother than that anyway
  radius: (params) => params.wakeRadius,
  weight: (params) => (p, age) =>
    p.s * Math.min(1, age / Math.max(0.001, params.wakeRise)),
};

class PointField {
  constructor(renderer, store, config) {
    this.renderer = renderer;
    this.store = store;
    this.config = config;
    this.center = new THREE.Vector2(0, 0);
    this.lastDraw = -1e9;
    this.drawnRevision = -1;

    this.target = new THREE.WebGLRenderTarget(config.texels, config.texels, {
      format: THREE.RGBAFormat,
      // Half float: a groove is a few centimetres deep and the bloom is a
      // long smooth ramp; eight bits would terrace both.
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });
    this.target.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.target.texture.wrapT = THREE.ClampToEdgeWrapping;

    const half = config.size / 2;
    this.camera = new THREE.OrthographicCamera(-half, half, half, -half, -1, 1);

    // Allocated once, at the largest the point set is allowed to get, and
    // rewritten in place. Handing the renderer a fresh buffer on every
    // redraw would leak one GPU allocation per redraw, for ever.
    this.posArray = new Float32Array(MAX_POINTS * 3);
    this.valArray = new Float32Array(MAX_POINTS * 2);
    this.posAttr = new THREE.BufferAttribute(this.posArray, 3);
    this.valAttr = new THREE.BufferAttribute(this.valArray, 2);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.valAttr.setUsage(THREE.DynamicDrawUsage);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('aValue', this.valAttr);
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTexels: { value: config.texels },
        uFieldSize: { value: config.size },
        uRadius: { value: config.radius(store.params) },
      },
      vertexShader: SPLAT_VERT,
      fragmentShader: SPLAT_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });

    this.mesh = new THREE.Points(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);

    this.uniforms = {
      [config.prefix + 'Map']: { value: this.target.texture },
      [config.prefix + 'Center']: { value: this.center },
      [config.prefix + 'FieldSize']: { value: config.size },
    };
  }

  update(playerX, playerZ, now) {
    const moved = Math.hypot(playerX - this.center.x, playerZ - this.center.y);
    const stale = now - this.lastDraw;
    if (moved > this.config.size * 0.2) {
      this.center.set(playerX, playerZ);
      this.draw(now);
    } else if (this.drawnRevision !== this.store.revision && stale > 100) {
      this.draw(now);
    } else if (stale > 2000) {
      this.draw(now);   // ages move on, so the cache has to be refreshed
    }
  }

  draw(now) {
    this.lastDraw = now;
    this.drawnRevision = this.store.revision;

    const params = this.store.params;
    const radius = this.config.radius(params);
    const weight = this.config.weight(params);
    const weight2 = this.config.weight2 ? this.config.weight2(params) : null;
    this.material.uniforms.uRadius.value = radius;

    const half = this.config.size / 2 + radius;
    const pos = this.posArray;
    const val = this.valArray;
    let count = 0;
    for (const p of this.store.points) {
      const dx = p.x - this.center.x;
      const dz = p.z - this.center.y;
      if (Math.abs(dx) > half || Math.abs(dz) > half) continue;
      const age = Math.max(0, (now - p.t0) * 0.001);
      pos[count * 3] = dx;
      pos[count * 3 + 1] = dz;
      pos[count * 3 + 2] = 0;
      val[count * 2] = weight(p, age);
      val[count * 2 + 1] = weight2 ? weight2(p, age) : 0;
      count++;
      if (count >= MAX_POINTS) break;
    }

    this.posAttr.needsUpdate = true;
    this.valAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, count);

    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 1);
    r.clear(true, false, false);
    if (count > 0) r.render(this.scene, this.camera);
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevClear, prevAlpha);
  }

  dispose() {
    this.target.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

export class TraceField {
  constructor(renderer, store) {
    this.store = store;
    this.depth = new PointField(renderer, store, DEPTH_CONFIG);
    this.bloom = new PointField(renderer, store, BLOOM_CONFIG);
    this.wake = new PointField(renderer, store, WAKE_CONFIG);
    const P = store.params;
    this.uniforms = Object.assign(
      {
        uTraceRef: { value: P.strength },
        uWash: { value: P.washOn },
        uWashEdge: { value: P.washEdge },
        uWashRag: { value: P.washRag },
        uWashRagScale: { value: P.washRagScale },
        uWashRim: { value: P.washRim },
        uWashFresh: { value: P.washFresh },
        uWashInk: { value: P.washInk },
        uWashWake: { value: P.washWake },
      },
      this.depth.uniforms,
      this.bloom.uniforms,
      this.wake.uniforms,
    );
  }

  update(playerX, playerZ, now) {
    const P = this.store.params;
    this.uniforms.uTraceRef.value = P.strength;
    this.uniforms.uWash.value = P.washOn;
    this.uniforms.uWashEdge.value = P.washEdge;
    this.uniforms.uWashWake.value = P.washWake;
    this.uniforms.uWashRag.value = P.washRag;
    this.uniforms.uWashRagScale.value = P.washRagScale;
    this.uniforms.uWashRim.value = P.washRim;
    this.uniforms.uWashFresh.value = P.washFresh;
    this.uniforms.uWashInk.value = P.washInk;
    this.depth.update(playerX, playerZ, now);
    this.bloom.update(playerX, playerZ, now);
    this.wake.update(playerX, playerZ, now);
  }

  draw(now) {
    this.depth.draw(now);
    this.bloom.draw(now);
    this.wake.draw(now);
  }

  dispose() {
    this.depth.dispose();
    this.bloom.dispose();
    this.wake.dispose();
  }
}

// ------------------------------------------------------------ GLSL twins

export const TRACE_GLSL = /* glsl */`
uniform sampler2D uTraceMap;
uniform vec2 uTraceCenter;
uniform float uTraceFieldSize;
uniform float uTraceRef;   // depth of a fresh trace, for reading strength

// Metres of depression at a world position.
float dwTraceDepth(vec2 p) {
  vec2 uv = (p - uTraceCenter) / uTraceFieldSize + 0.5;
  vec2 edge = smoothstep(0.0, 0.03, uv) * smoothstep(0.0, 0.03, 1.0 - uv);
  float w = edge.x * edge.y;
  if (w <= 0.0) return 0.0;
  return texture2D(uTraceMap, uv).r * w;
}
`;

export const WAKE_GLSL = /* glsl */`
uniform sampler2D uWakeMap;
uniform vec2 uWakeCenter;
uniform float uWakeFieldSize;

// How far the landscape has woken here, 0 to 1.
float dwWake(vec2 p) {
  vec2 uv = (p - uWakeCenter) / uWakeFieldSize + 0.5;
  vec2 edge = smoothstep(0.0, 0.02, uv) * smoothstep(0.0, 0.02, 1.0 - uv);
  float w = edge.x * edge.y;
  if (w <= 0.0) return 0.0;
  return clamp(texture2D(uWakeMap, uv).r, 0.0, 1.0) * w;
}
`;

export const BLOOM_GLSL = /* glsl */`
uniform sampler2D uBloomMap;
uniform vec2 uBloomCenter;
uniform float uBloomFieldSize;

// Both numbers this field holds, in one fetch:
//   x — how awake a place is, 0 to 1. Zero is the Nothing.
//   y — how wet it still is. One the moment it was walked, drying after.
vec2 dwBloomWet(vec2 p) {
  vec2 uv = (p - uBloomCenter) / uBloomFieldSize + 0.5;
  vec2 edge = smoothstep(0.0, 0.02, uv) * smoothstep(0.0, 0.02, 1.0 - uv);
  float w = edge.x * edge.y;
  if (w <= 0.0) return vec2(0.0);
  return clamp(texture2D(uBloomMap, uv).rg, 0.0, 1.0) * w;
}

float dwBloom(vec2 p) { return dwBloomWet(p).x; }
`;

// The wash. Everything that asks "how much world is here" asks this one
// function, so a blade of grass can never be coloured where the ground
// beneath it is not, and two people can never disagree about where the
// paint reaches. It needs WORLD_GLSL, BLOOM_GLSL and WAKE_GLSL before it.
//
// It has no twin on the CPU on purpose. The wash moves paint and nothing
// else: no surface anyone can stand on is shaped by it, so the collision
// side has nothing to agree with. Height still comes from the fields that
// do have twins — depth and wake.
export const WASH_GLSL = /* glsl */`
uniform float uWash;          // the whole wash, on or off
uniform float uWashEdge;      // how hard the front of the wash stops
uniform float uWashRag;       // how far the front runs ahead or hangs back
uniform float uWashRagScale;  // metres per wander of the front
uniform float uWashWake;      // how much the wide wake alone lights ground
uniform float uWashRim;       // how dark the pigment gathers at the front
uniform float uWashFresh;     // how much darker the wash is while wet
uniform float uWashInk;       // how readily the colour climbs a blade

// The detail argument is how much of the front's fringe is worth drawing
// here: one close up, zero where the fog has taken the ground. It buys back
// most of the cost of a ragged edge, because the band the noise is
// evaluated in covers far more of the screen far away than it does nearby,
// and out there not one finger of it survives the fog.
//
// Returns:
//   x — the wash: how much world is here, 0 to 1
//   y — how wet it is now: 1 just walked, 0 long dry
//   z — the rim: pigment gathered at the front of the wash
//   w — the plain bloom underneath, for whatever still asks for it
vec4 dwWash(vec2 p, float ceiling, float detail) {
  vec2 bw = dwBloomWet(p);
  float woken = ceiling * bw.x;
  float broad = ceiling * dwWake(p);

  // Paint does not stop in a circle. The front runs ahead here and hangs
  // back there, and the noise that decides which is read from the world
  // position alone — so the same edge lies in the same place for everyone.
  //
  // It is added to the field before the threshold, not painted on after:
  // a contour pushed by noise grows fingers, a contour drawn with noise is
  // a wobbly line. The band keeps the push to where the front actually is,
  // or a stray crest of noise would light an island in the Nothing where
  // nobody has ever walked. It also means the noise is only evaluated in a
  // thin ring of the picture, which is most of why this is affordable.
  float field = woken;
  float band = smoothstep(0.02, 0.10, field)
    * (1.0 - smoothstep(0.28, 0.46, field)) * detail;
  if (band > 0.002 && uWash * uWashRag > 0.001) {
    // Two scales, from one walk of the noise: the wide wander of the front
    // and a fringe half its size. A third, finer one was worth a millisecond
    // when the front filled the screen and was lost in the fog anyway.
    vec2 q = p / max(uWashRagScale, 0.5);
    field += uWash * uWashRag * band * dwFbm2(q, 2);
  }

  // A wash has an edge. Paint stops where it stops, and how hard it stops
  // is the dial worth having: soft, and the walked line is a haze again;
  // hard, and it is a shape, with fingers and a line around it. Measured
  // against the bloom this is a front about four metres wide soft, and
  // less than one metre wide hard.
  float w = mix(0.085, 0.012, uWash * clamp(uWashEdge, 0.0, 1.0));
  float front = smoothstep(0.20 - w, 0.20 + w, field);

  // Under the paint, the landscape's own wide wake — a slower and much
  // broader thing, which reaches a hundred metres past anything walked.
  // It is a plateau, so every bit of it that is lit here is edge the wash
  // cannot draw.
  float alive = max(front, uWashWake * smoothstep(0.10, 0.40, broad));

  // Where the wash stopped, the pigment piled up. This is the one mark
  // watercolour always leaves, and it stays after the paper dries. It
  // rides the front itself, so it is a line and not a region: it peaks
  // exactly on the contour, is gone on either side of it, and narrows as
  // the edge hardens, the way a drying pool does.
  float rim = uWash * front * (1.0 - front) * 4.0;

  return vec4(alive, uWash * bw.y, rim, woken);
}
`;
