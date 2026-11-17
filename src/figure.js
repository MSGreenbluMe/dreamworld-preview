// figure.js — a person, as a hole in this world with their own behind it.
//
// Not a model and not a sprite. A figure is an outline, and inside the
// outline the sky is run again with that person's vector instead of
// yours. Walk round them and the sky inside shifts, because what is drawn
// there is the direction you are actually looking, so coming close shows
// a wider slice of their weather than standing off does. It costs only
// the pixels the figure covers and it needs no assets at all.
//
// The player never sees their own figure. What they see of themselves is
// its shadow on the ground, which is drawn by the ground shader from the
// same outline — one silhouette, used twice, so a person and their shadow
// can never be two different shapes.

import * as THREE from 'three';
import { MAX_BANDS } from './deviation.js';

export const DEFAULT_FIGURE = {
  on: 1,
  height: 1.8,     // metres, head to foot
  shadow: 0.55,    // how dark the outline falls on the ground
};

// The outline, and the only description of a person this world has.
//
// Written as distance to a few segments: negative inside, zero on the
// edge. A silhouette is read by its shape and not by its detail — a
// pointed hat or an owl on a shoulder would read from across a field,
// and so this has to be the kind of shape such things can later be added
// to. Measured in units of the figure's own height, with the feet at zero
// and the top of the head at one.
export const FIGURE_GLSL = /* glsl */`
float dwSeg(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

float dwFigure(vec2 p) {
  float d = length(p - vec2(0.0, 0.936)) - 0.058;               // head
  d = min(d, dwSeg(p, vec2(0.0, 0.880), vec2(0.0, 0.845), 0.022));   // neck
  d = min(d, dwSeg(p, vec2(-0.105, 0.818), vec2(0.105, 0.818), 0.038));
  d = min(d, dwSeg(p, vec2(0.0, 0.806), vec2(0.0, 0.660), 0.080));   // chest
  d = min(d, dwSeg(p, vec2(0.0, 0.660), vec2(0.0, 0.520), 0.066));   // waist
  d = min(d, dwSeg(p, vec2(-0.126, 0.800), vec2(-0.148, 0.560), 0.028));
  d = min(d, dwSeg(p, vec2( 0.126, 0.800), vec2( 0.148, 0.560), 0.028));
  d = min(d, dwSeg(p, vec2(-0.040, 0.525), vec2(-0.058, 0.016), 0.035));
  d = min(d, dwSeg(p, vec2( 0.040, 0.525), vec2( 0.058, 0.016), 0.035));
  return d;
}

// The shadow of a figure standing on a spot, sheared onto the ground by
// the light. A point of the figure at height h lands this far from the
// feet, so the ground reads the figure backwards: how far along the
// shadow a point is says which part of the figure it belongs to.
float dwFigureShadow(vec2 p, vec2 feet, float height, vec3 light) {
  vec2 lit = light.xz;
  float len = length(lit);
  // A light directly overhead casts a shadow under the feet and there is
  // nothing to shear.
  if (len < 0.05) return 0.0;
  float up = max(light.y, 0.05);

  // This runs on every pixel of ground on screen, and on all but a few of
  // them the answer is no. So the cheap refusals come first and in order:
  // how far a shadow of this height can possibly reach under this light,
  // then whether the point is behind the feet, then whether it is wider
  // off the line of the shadow than a person is. What is left is the
  // handful of pixels that are actually in it. Without this it cost most
  // of a millisecond a frame to say no.
  float reach = height * (len / up) + height * 0.3;
  vec2 d = p - feet;
  if (dot(d, d) > reach * reach) return 0.0;
  vec2 along = lit / len;
  float t = dot(d, -along);
  if (t < -0.25 * height) return 0.0;
  float across = dot(d, vec2(-along.y, along.x));
  if (abs(across) > height * 0.26) return 0.0;
  float h = t * up / len;
  float m = dwFigure(vec2(across / height, h / height));
  float soft = 0.02 + 0.05 * (h / height);
  float inside = 1.0 - smoothstep(-soft, soft, m);
  // A shadow is sharpest at the foot and loses itself towards the head.
  return inside * (1.0 - smoothstep(0.15, 1.25, h / height));
}
`;

// Their sky, as much of it as a window shows. The gradient or the band
// stack they carry, and their own light in it — not the clouds and not
// what stands on the horizon, which belong to the world and not to them.
const FIGURE_SKY_GLSL = /* glsl */`
uniform vec3 uFigFog;
uniform vec3 uFigZenith;
uniform vec3 uFigLight;
uniform vec3 uFigLightDir;
uniform float uFigSunSize;
uniform float uFigBandCount;
uniform float uFigBandAt[${MAX_BANDS}];
uniform float uFigBandSoft[${MAX_BANDS}];
uniform vec3 uFigBandCol[${MAX_BANDS}];

vec3 dwTheirSky(vec3 d) {
  vec3 sky;
  if (uFigBandCount < 0.5) {
    float t = smoothstep(0.0, 0.62, d.y);
    sky = mix(mix(uFigFog, uFigLight, 0.38), uFigZenith, t);
  } else {
    sky = uFigBandCol[0];
    for (int i = 1; i < ${MAX_BANDS}; i++) {
      if (float(i) >= uFigBandCount) break;
      sky = mix(sky, uFigBandCol[i], smoothstep(
        uFigBandAt[i] - uFigBandSoft[i], uFigBandAt[i] + uFigBandSoft[i],
        d.y));
    }
  }
  float s = dot(d, uFigLightDir);
  sky = mix(sky, mix(sky, uFigLight, 0.42),
    smoothstep(uFigSunSize - 0.22, uFigSunSize, s));
  sky = mix(sky, uFigLight,
    smoothstep(uFigSunSize - 0.004, uFigSunSize + 0.001, s));
  return sky;
}
`;

// Turned to face the camera about its own standing axis, never tipped:
// a person stays upright however you look at them.
const VERT = /* glsl */`
uniform vec3 uFigPos;
uniform float uFigHeight;
varying vec2 vFig;
varying vec3 vWorld;

void main() {
  vec3 toCam = cameraPosition - uFigPos;
  vec2 lie = toCam.xz;
  float len = length(lie);
  vec2 face = len > 0.001 ? lie / len : vec2(0.0, 1.0);
  vec3 right = vec3(-face.y, 0.0, face.x);

  // A little wider than the outline, so the edge has somewhere to fade.
  float wide = uFigHeight * 0.26;
  float up = (position.y + 0.5) * uFigHeight;
  vec3 world = uFigPos + right * (position.x * 2.0 * wide)
    + vec3(0.0, up, 0.0);

  vFig = vec2(position.x * 2.0 * wide / uFigHeight, up / uFigHeight);
  vWorld = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */`
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uViewDistance;
varying vec2 vFig;
varying vec3 vWorld;

void main() {
  float d = dwFigure(vFig);
  float e = max(fwidth(d), 0.0006);
  float mask = 1.0 - smoothstep(-e, e, d);
  if (mask <= 0.004) discard;

  // What is seen through the opening is the direction actually being
  // looked along, which is what makes this a window and not a picture of
  // one: stand close and it shows a slice of their sky, stand off and it
  // is one colour.
  vec3 dir = normalize(vWorld - cameraPosition);
  vec3 col = dwTheirSky(dir);

  // An opening has an edge.
  //
  // Without one, somebody standing in the same weather as you is a hole
  // that shows exactly what is behind it, which is to say nothing at all
  // — and the moment you most want to see a person is the moment you have
  // walked into their air. The edge carries their light, so it is still
  // theirs and not a line drawn round them. Far enough off, the fringe is
  // wider than the figure and a person is a smudge of their own colour,
  // which is what a person at that distance should be.
  float wideRim = clamp(e * 2.5, 0.005, 0.060);
  float rim = 1.0 - smoothstep(0.0, wideRim, abs(d));
  col = mix(col, mix(col, uFigLight, 0.62), rim * 0.85);

  // The air in between is still this world's air. Without it a figure at
  // the edge of the fog burns as brightly as one an arm's length away,
  // and stops being anywhere.
  float dist = length(vWorld - cameraPosition);
  float density = 3.05 / uViewDistance * uFogDensity;
  float f = 1.0 - exp(-(dist * density) * (dist * density));
  col = mix(col, uFogColor, clamp(f, 0.0, 1.0));

  gl_FragColor = vec4(col, mask);
}
`;

export function makeFigureUniforms() {
  return {
    uFigPos: { value: new THREE.Vector3(0, 0, 0) },
    uFigHeight: { value: DEFAULT_FIGURE.height },
    uFigOn: { value: 0 },
    uFigShadow: { value: DEFAULT_FIGURE.shadow },
    uFigFog: { value: new THREE.Vector3() },
    uFigZenith: { value: new THREE.Vector3() },
    uFigLight: { value: new THREE.Vector3() },
    uFigLightDir: { value: new THREE.Vector3(0, 1, 0) },
    uFigSunSize: { value: Math.cos(0.2) },
    uFigBandCount: { value: 0 },
    uFigBandAt: { value: new Array(MAX_BANDS).fill(0) },
    uFigBandSoft: { value: new Array(MAX_BANDS).fill(1) },
    uFigBandCol: { value: Array.from({ length: MAX_BANDS },
      () => new THREE.Vector3()) },
  };
}

// Their vector decides what is inside them, and it is read exactly where
// the air of a place is read: from whatever the panel says about them.
export function applyFigurePalette(u, dev, palette, lightDir) {
  const set = (uu, c) => uu.value.set(c[0], c[1], c[2]);
  set(u.uFigFog, palette.fog);
  set(u.uFigZenith, palette.zenith);
  set(u.uFigLight, palette.light);
  u.uFigLightDir.value.set(lightDir[0], lightDir[1], lightDir[2]).normalize();
  u.uFigSunSize.value = Math.cos(dev.sunAngle);
  u.uFigBandCount.value = palette.bands.length;
  for (let i = 0; i < MAX_BANDS; i++) {
    const b = palette.bands[i];
    u.uFigBandAt.value[i] = b ? b.at : 0;
    u.uFigBandSoft.value[i] = b ? Math.max(0.002, b.soft) : 1;
    const c = u.uFigBandCol.value[i];
    if (b) c.set(b.rgb[0], b.rgb[1], b.rgb[2]); else c.set(0, 0, 0);
  }
}

export class Figure {
  constructor(uniformGroups) {
    this.uniforms = Object.assign({}, ...uniformGroups);
    this.mesh = null;
    this.material = null;
    this.geometry = null;
  }

  _construct(scene) {
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FIGURE_GLSL + FIGURE_SKY_GLSL + FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    // After the sky, which writes no depth of its own and would otherwise
    // paint over the one thing in the picture that is somebody.
    this.mesh.renderOrder = 1001;
    scene.add(this.mesh);
  }

  // `where` is the feet, or null when nobody is there.
  update(scene, where, height) {
    if (!where) {
      if (this.mesh) this.mesh.visible = false;
      this.uniforms.uFigOn.value = 0;
      return;
    }
    if (!this.mesh) this._construct(scene);
    this.mesh.visible = true;
    this.uniforms.uFigOn.value = 1;
    this.uniforms.uFigHeight.value = height;
    this.uniforms.uFigPos.value.set(where.x, where.y, where.z);
    // The quad is built in the vertex shader around this point, so the
    // mesh itself never moves and never needs a matrix update.
  }

  dispose() {
    if (this.geometry) this.geometry.dispose();
    if (this.material) this.material.dispose();
  }
}
