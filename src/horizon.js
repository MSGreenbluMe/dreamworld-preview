// horizon.js — the things standing on the far edge of the world.
//
// The monument is one enormous thing and there is one of it. These are
// the opposite: small, far, and several at once. A row of poplars planted
// along something nobody can see any more. Two striped chimneys, which is
// how many there always are. Old towers with their feet in the mist.
//
// They are what turns a horizon from a line into a place, and they are
// the cheapest landscape there is: no geometry, no second draw, no memory
// that grows as the player walks.
//
// Same rule as the monument and for the same reason. A coarse lattice
// covers the world, a hash per cell decides whether anything stands there
// and what it is, the CPU hands the shader the few that are in range, and
// the shader tests each view ray against them analytically. Nothing is
// placed by hand, nothing is stored, and two people standing in the same
// spot see the same skyline.

import { hash2, unitFloat } from './world.js';

// How many can be in view at once. Four is enough for a skyline and the
// fourth is usually most of the way into the mist.
export const MAX_HORIZON = 4;

const CELL = 1100;         // metres between candidate sites
const OCCUPANCY = 0.50;    // how many cells hold anything
// Near enough and the silhouette stops being a silhouette: it becomes a
// thing with a size, standing on ground the player could walk to and find
// nothing at. Far enough and it is a speck the mist has already taken.
//
// It also has to clear the land. The ground runs out a couple of hundred
// metres off and its last ridge stands a little above eye level, so
// anything out here that is not taller than that ridge is never seen at
// all — which is what the first try got wrong.
const MIN_RANGE = 320;
const MAX_RANGE = 1600;
export const FADE_FROM = 1250;

// Returns the ones in range, nearest first, at most MAX_HORIZON of them.
export function horizonNear(x, z) {
  const found = [];
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  const reach = Math.ceil(MAX_RANGE / CELL);

  for (let i = -reach; i <= reach; i++) {
    for (let j = -reach; j <= reach; j++) {
      const gx = cx + i, gz = cz + j;
      if (unitFloat(hash2(gx, gz)) > OCCUPANCY) continue;

      const jx = unitFloat(hash2(gx + 1619, gz));
      const jz = unitFloat(hash2(gx, gz + 31337));
      const px = (gx + 0.1 + jx * 0.8) * CELL;
      const pz = (gz + 0.1 + jz * 0.8) * CELL;
      const dist = Math.hypot(px - x, pz - z);
      if (dist < MIN_RANGE || dist > MAX_RANGE) continue;

      const kind = hash2(gx + 101, gz - 57) % 3;
      const a = unitFloat(hash2(gx + 7, gz + 23));
      const b = unitFloat(hash2(gx - 41, gz + 5));

      let height, halfWidth, count;
      if (kind === 0) {
        // A row of poplars. Tall for a tree, nothing for a landmark, and
        // the only one of the three that reads as a line rather than a
        // thing: it says somebody once planted along a road here.
        height = 23 + a * 18;
        halfWidth = 30 + b * 46;
        count = 5 + Math.floor(b * 7);
      } else if (kind === 1) {
        // Two chimneys. Always two.
        height = 95 + a * 95;
        halfWidth = 26 + b * 26;
        count = 2;
      } else {
        // Old towers.
        height = 42 + a * 54;
        halfWidth = 20 + b * 28;
        count = 2 + Math.floor(b * 2);
      }

      found.push({ x: px, z: pz, dist, kind, height, halfWidth, count });
    }
  }

  found.sort((p, q) => p.dist - q.dist);
  return found.slice(0, MAX_HORIZON);
}

export function makeHorizonUniforms() {
  return {
    uHorizonCount: { value: 0 },
    uHorizonPos: { value: new Float32Array(MAX_HORIZON * 2) },
    // kind, height, halfWidth, how many
    uHorizonData: { value: new Float32Array(MAX_HORIZON * 4) },
    uPresenceHorizon: { value: 0 },
  };
}

export function updateHorizonUniforms(u, x, z, presence) {
  u.uPresenceHorizon.value = presence;
  if (presence <= 0.002) { u.uHorizonCount.value = 0; return 0; }

  const near = horizonNear(x, z);
  const pos = u.uHorizonPos.value;
  const data = u.uHorizonData.value;
  for (let i = 0; i < near.length; i++) {
    const h = near[i];
    pos[i * 2] = h.x;
    pos[i * 2 + 1] = h.z;
    data[i * 4] = h.kind;
    data[i * 4 + 1] = h.height;
    data[i * 4 + 2] = h.halfWidth;
    data[i * 4 + 3] = h.count;
  }
  u.uHorizonCount.value = near.length;
  return near.length;
}

export const HORIZON_GLSL = /* glsl */`
uniform float uHorizonCount;
uniform vec2 uHorizonPos[${MAX_HORIZON}];
uniform vec4 uHorizonData[${MAX_HORIZON}];   // kind, height, halfW, count
uniform float uPresenceHorizon;

// One number per thing, from the thing's own place in the world, so every
// client grows the same crooked row of trees.
float dwHorizonVary(float k, vec2 pos) {
  return fract(sin(k * 127.1 + pos.x * 0.0131 + pos.y * 0.0177) * 43758.5453);
}

// Paints whatever stands on the far edge of the world over col.
//
// ink is what a silhouette is made of and fogCol is what the distance
// does to it. Each one is a ray against the vertical plane it stands on:
// one divide and two dot products, the same trick the monument uses, and
// then a shape drawn in metres across that plane.
void dwHorizonPaint(vec3 d, vec3 eye, vec3 ink, vec3 fogCol, float density,
                    inout vec3 col) {
  if (uPresenceHorizon <= 0.002) return;
  if (d.y < -0.03) return;

  for (int i = 0; i < ${MAX_HORIZON}; i++) {
    if (float(i) >= uHorizonCount) break;

    vec2 pos = uHorizonPos[i];
    vec4 g = uHorizonData[i];
    float tall = g.y;
    float halfW = g.z;
    float n = max(g.w, 1.0);

    vec2 toIt = pos - eye.xz;
    float range = length(toIt);
    if (range < 1.0) continue;

    // Over the top of it. The ray only rises as it goes, so anything this
    // test rejects was going to miss: it costs one multiply and saves the
    // whole shape for most of the sky.
    if (d.y * range > tall) continue;

    vec2 ahead = toIt / range;
    float forward = dot(d.xz, ahead);
    if (forward <= 0.02) continue;              // behind us, or edge on

    float t = range / forward;
    float sideways = t * dot(d.xz, vec2(-ahead.y, ahead.x));
    if (abs(sideways) > halfW) continue;
    float up = t * d.y;                         // metres above eye
    if (up < -2.0 || up > tall) continue;

    // About a pixel, in the units this is measured in.
    float e = max(fwidth(sideways), range * 0.0012);
    float ev = max(fwidth(up), range * 0.0012);

    int kind = int(g.x + 0.5);
    float inside = 0.0;
    vec3 shade = ink;
    float hgt = tall;

    if (kind == 0) {
      // A row of poplars: narrow flames, each one a little different,
      // planted along something nobody can see any more.
      float slot = (sideways + halfW) / (2.0 * halfW) * n;
      float k = floor(slot);
      float across = (fract(slot) - 0.5) * (2.0 * halfW / n);
      hgt = tall * (0.74 + 0.50 * dwHorizonVary(k, pos));
      float rise = clamp(up / hgt, 0.0, 1.0);
      // Widest low down, drawn to a point at the top, and a stem under it.
      float wid = (halfW / n) * 0.80 * pow(1.0 - rise, 0.45)
        * smoothstep(0.0, 0.10, rise);
      inside = (1.0 - smoothstep(wid - e, wid + e, abs(across)));

    } else if (kind == 1) {
      // Two striped chimneys, which is how many there always are. One is
      // shorter than the other, which is also how it always is.
      float side = sideways < 0.0 ? -1.0 : 1.0;
      hgt = tall * (side < 0.0 ? 0.84 : 1.0);
      float across = abs(sideways - side * halfW * 0.55);
      float rise = clamp(up / hgt, 0.0, 1.0);
      float wid = tall * (0.044 - 0.020 * rise);
      inside = 1.0 - smoothstep(wid - e, wid + e, across);

      // The bands. They are the whole reason a chimney reads as a chimney
      // and not as a post, so they are drawn until a pixel covers more
      // than one of them, and then they stop rather than crawl.
      float bands = rise * 5.0;
      float crisp = 1.0 - smoothstep(0.30, 0.95, fwidth(bands));
      shade = mix(mix(ink, fogCol, 0.52), vec3(0.62, 0.17, 0.12),
                  step(0.5, fract(bands)) * crisp * 0.80);

    } else {
      // Old towers: square-shouldered, different heights, with a narrower
      // storey on top of each.
      float slot = (sideways + halfW) / (2.0 * halfW) * n;
      float k = floor(slot);
      float across = (fract(slot) - 0.5) * (2.0 * halfW / n);
      hgt = tall * (0.55 + 0.60 * dwHorizonVary(k + 17.0, pos));
      float rise = clamp(up / hgt, 0.0, 1.0);
      float wid = (halfW / n) * (0.46 - 0.10 * rise);
      if (rise > 0.80) wid *= 0.62;
      inside = 1.0 - smoothstep(wid - e, wid + e, abs(across));
    }

    inside *= smoothstep(-ev, ev, up)
      * (1.0 - smoothstep(hgt - ev, hgt + ev, up));
    if (inside <= 0.002) continue;

    // The mist takes the feet long before it takes the tops. Half of what
    // the ground's own fog would do at this range: by that rule anything
    // out here would simply be gone, and a skyline the air erases is not
    // a skyline.
    float rise = clamp(up / max(hgt, 1.0), 0.0, 1.0);
    float haze = 0.80 * (1.0 - exp(-range * density * 0.42));
    haze *= 1.0 - 0.60 * smoothstep(0.0, 0.55, rise);
    vec3 c = mix(shade, fogCol, clamp(haze, 0.0, 1.0));

    float far = 1.0 - smoothstep(${FADE_FROM}.0, ${MAX_RANGE}.0, range);
    col = mix(col, c, inside * uPresenceHorizon * far);
  }
}
`;
