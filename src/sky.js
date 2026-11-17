// sky.js — quiet, and only there over places that exist.
//
// One soft gradient and one enormous disc. It had flat bands with hard
// edges and they read as stripes: a sky that competes with the ground for
// attention takes the landscape's job away from it. The only hard edges
// left up here are the ones that belong to an actual silhouette — the disc
// of light, the clouds, and the monument.
//
// The sky is also not everywhere. Each direction asks the bloom field about
// the ground a short way along it, so the sky opens over the walked line
// and stays shut over the Nothing. Straight up it asks about the ground
// underfoot, because that is the ground that direction belongs to.

import * as THREE from 'three';
import { WORLD_GLSL } from './world.js';
import { BLOOM_GLSL } from './traces.js';
import { CLOUD_GLSL } from './clouds.js';
import { MONUMENT_GLSL } from './monument.js';
import { MAX_BANDS } from './deviation.js';
import { HORIZON_GLSL } from './horizon.js';

const VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */`
uniform vec3 uFogColor;
uniform vec3 uZenith;
uniform vec3 uGroundLow;
uniform vec3 uLightColor;
uniform vec3 uLightDir;
uniform float uFogDensity;
uniform float uViewDistance;
uniform float uGrowthCeiling;
uniform vec2 uWinSky;
uniform float uOvrSky;
uniform vec2 uWinClouds;
uniform float uOvrClouds;
uniform float uSkyProbe;    // metres along the view direction to ask about
uniform float uSunSize;     // cosine of the disc's angular radius
uniform float uBandCount;   // 0 for a palette with no made sky
uniform float uBandAt[${MAX_BANDS}];
uniform float uBandSoft[${MAX_BANDS}];
uniform vec3 uBandCol[${MAX_BANDS}];
uniform float uSkyKind;     // 1 towers after rain, 2 a mackerel morning
varying vec3 vDir;

void main() {
  vec3 d = normalize(vDir);

  vec2 flatDir = d.xz;
  float len = max(length(flatDir), 1e-4);
  vec2 probe = cameraPosition.xz + (flatDir / len) * uSkyProbe;
  float overhead = clamp(d.y * 1.8, 0.0, 1.0);
  float woken = mix(dwBloom(probe), dwBloom(cameraPosition.xz), overhead);
  float local = uGrowthCeiling * woken;

  float presSky = uOvrSky >= 0.0 ? uOvrSky
    : smoothstep(uWinSky.x, uWinSky.y, local);
  float presClouds = uOvrClouds >= 0.0 ? uOvrClouds
    : smoothstep(uWinClouds.x, uWinClouds.y, local);

  // With no sky there is only the Nothing, and the Nothing is the same in
  // every direction.
  vec3 col = uFogColor;

  // Most of the made palettes have one ramp, warm at the horizon and quiet
  // above it. The lowest tone is not the fog's white: that left a wide
  // empty gap over the horizon line.
  vec3 sky;
  if (uBandCount < 0.5) {
    float t = smoothstep(0.0, 0.62, d.y);
    vec3 horizonTone = mix(uFogColor, uLightColor, 0.38);
    sky = mix(horizonTone, uZenith, t);
  } else {
    // Or a made sky: the layers that sky actually had, laid from the
    // horizon upward. Each band takes over above the height it begins at,
    // so the stack reads in order and the joins stay as soft as they were
    // in the photograph. Six smoothsteps; nothing here costs anything.
    sky = uBandCol[0];
    for (int i = 1; i < ${MAX_BANDS}; i++) {
      if (float(i) >= uBandCount) break;
      sky = mix(sky, uBandCol[i], smoothstep(
        uBandAt[i] - uBandSoft[i], uBandAt[i] + uBandSoft[i], d.y));
    }
  }

  // One large thing hanging in it. Far too big to be a sun, which is the
  // point — nothing produces awe as cheaply as size.
  float s = dot(d, uLightDir);
  float halo = smoothstep(uSunSize - 0.22, uSunSize, s);
  sky = mix(sky, mix(sky, uLightColor, 0.42), halo);
  float disc = smoothstep(uSunSize - 0.004, uSunSize + 0.001, s);
  sky = mix(sky, uLightColor, disc);

  // The one thing a made sky had that no stack of flat colour can say.
  // Both are a noise around the whole circle of the horizon, mapped so the
  // lattice wraps at the same place the azimuth does: whatever shape is
  // behind the walker meets itself with no seam.
  if (uSkyKind > 0.5) {
    float az = atan(d.z, d.x) * 0.15915494 + 0.5;

    if (uSkyKind < 1.5) {
      // After rain, the cloud that has moved on stands off at the edge of
      // the world, white and lit from the side, with air underneath it.
      float u = az * 26.0;
      float n = 0.68 * dwPerlin2p(vec2(u, 0.5), 26)
              + 0.32 * dwPerlin2p(vec2(u * 3.0, 3.5), 78);
      // Raised to a power so most of the circle sits almost flat and a few
      // places climb: towers with sky between them, not a white ridge.
      float n01 = clamp(0.5 + 0.66 * n, 0.0, 1.0);
      float top = 0.004 + 0.165 * pow(n01, 2.4);
      float e = max(fwidth(d.y), 0.0012);
      float tower = (1.0 - smoothstep(top - e, top + e, d.y))
        * smoothstep(-0.004, 0.012, d.y);
      // Lit along the top, in shadow towards the foot, which is the whole
      // reason a cloud that size reads as a solid thing.
      vec3 lit = mix(vec3(1.0), uLightColor, 0.18);
      vec3 base = mix(lit, uZenith, 0.42);
      sky = mix(sky, mix(base, lit, smoothstep(0.0, max(top, 0.02), d.y)),
                tower * 0.93);

    } else {
      // A mackerel morning: rows of small cloud crowding together as they
      // run away towards the horizon. Dividing by the height is what makes
      // them converge, and it is the only perspective a painted sky needs.
      float band = smoothstep(0.07, 0.20, d.y)
        * (1.0 - smoothstep(0.50, 0.84, d.y));
      if (band > 0.004) {
        float v = 1.0 / max(d.y, 0.06);
        // A slow wander, so the rows bend and break instead of being a
        // machine pattern. Everything that runs around the horizon is
        // either this periodic noise or a sine of a whole number of turns,
        // and both close on themselves.
        float n = dwPerlin2p(vec2(az * 120.0, v * 2.4), 120);
        float phase = v * 13.0;
        float rows = 0.5 + 0.5 * sin(phase + n * 2.0);
        float cell = smoothstep(0.34, 0.74, rows * (0.65 + 0.50 * n));

        // Running away towards the horizon, the rows crowd into less than
        // a pixel each and would stop being rows and start being moire.
        // Where a pixel spans most of a row, there is no row left to draw.
        float fade = 1.0 - smoothstep(0.7, 2.0, fwidth(phase));
        sky = mix(sky, mix(sky, vec3(1.0), 0.72), cell * band * fade * 0.88);
      }
    }
  }

  col = mix(col, sky, presSky);

  // The one enormous thing. Not gated by the bloom: it stands on the far
  // world, and something to walk towards is the whole point of it.
  float rise;
  float mono = dwMonument(d, cameraPosition, rise);
  if (mono > 0.001) {
    vec3 monoCol = mix(uGroundLow, uZenith, 0.30) * 0.62;

    // It breathes the same air as the ridges, and the air is thickest at
    // the bottom: the foot dissolves into the haze and the top stands
    // clear of it. Without this it was a dark rectangle floating over a
    // white gap, the one thing in the scene the distance did not touch.
    float range = length(uMonumentPos - cameraPosition.xz);
    // Half the ground's haze at most: by the ground's own rule anything
    // at this range would be gone, and a landmark that the air erases is
    // not a landmark. Enough to place it in depth, not enough to lose it.
    float density = 3.05 / uViewDistance * uFogDensity;
    float haze = 0.55 * (1.0 - exp(-range * density * 0.55));
    haze *= 1.0 - 0.72 * smoothstep(0.05, 0.70, rise);
    monoCol = mix(monoCol, uFogColor, clamp(haze, 0.0, 1.0));

    col = mix(col, monoCol, mono);
  }

  // Clouds as silhouettes: flat shapes with an edge, not photographed
  // vapour. Same field the ground reads for its shade.
  if (presClouds > 0.002 && d.y > 0.010) {
    float reach = uCloudHeight / d.y;
    vec2 hit = cameraPosition.xz + d.xz * reach;
    float density = dwCloudField(hit);

    // Far down the plane one pixel spans whole clouds, which would shimmer.
    float far = smoothstep(1500.0, 9000.0, reach);
    density = mix(density, uCloudCover, far);

    // Shapes, but soft ones and close to the sky they sit in. Hard-edged
    // cloud up here pulls the eye off the ground.
    float shape = smoothstep(0.34, 0.66, density);
    vec3 cloudCol = mix(uFogColor, uZenith, 0.30);
    float horizon = smoothstep(0.010, 0.12, d.y);
    col = mix(col, cloudCol, shape * presClouds * horizon * 0.7);
  }

  // What stands on the far edge of the world, last of all: these are the
  // nearest things in the sky and everything up there is behind them.
  dwHorizonPaint(d, cameraPosition, mix(uGroundLow, uZenith, 0.22) * 0.52,
                 uFogColor, 3.05 / uViewDistance * uFogDensity, col);

  gl_FragColor = vec4(col, 1.0);
}
`;

export class Sky {
  constructor(uniformGroups) {
    this.uniforms = Object.assign({}, ...uniformGroups);
    this.mesh = null;
    this.material = null;
    this.geometry = null;
  }

  // Built the first time anything overhead exists, and not before.
  _construct(scene) {
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader:
        WORLD_GLSL + BLOOM_GLSL + CLOUD_GLSL + MONUMENT_GLSL
        + HORIZON_GLSL + FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      // Depth tested and drawn last, so the sky shader never runs on a
      // pixel the ground is going to cover. On a screen where the ground
      // fills the lower half that is half the sky's cost, for nothing.
      depthTest: true,
    });
    this.geometry = new THREE.SphereGeometry(4000, 48, 24);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1000;
    scene.add(this.mesh);
  }

  // `wanted` is not the presence at the player: the shader decides that per
  // direction. It only says whether there is any woken world at all yet, so
  // that an untouched world still costs a single pass.
  update(scene, camera, wanted) {
    if (wanted <= 0.002) {
      if (this.mesh) this.mesh.visible = false;
      return;
    }
    if (!this.mesh) this._construct(scene);
    this.mesh.visible = true;
    this.mesh.position.copy(camera.position);
  }

  dispose() {
    if (this.geometry) this.geometry.dispose();
    if (this.material) this.material.dispose();
  }
}
