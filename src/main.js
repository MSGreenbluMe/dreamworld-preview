// main.js — puts the world on screen and keeps it running.
//
// Order of things: the shared ground first, then the traces that mark it,
// then the personal air laid over both. Nothing here holds world state; it
// only wires the pure functions to a renderer, a body and a clock.

import * as THREE from 'three';
import {
  DEFAULT_BASE, BREATH_PERIOD, GUST_PERIOD, baseHeight,
  makeWorldUniforms, applyBaseToUniforms,
} from './world.js';
import {
  DEFAULT_IDENTITY, DEFAULT_GROWTH, deviationFrom, paletteFrom,
  lightDirection, partyFrom, mixAir, MAX_BANDS,
} from './deviation.js';
import { WorldClock, scrollPhase, driftOffset } from './clock.js';
import { presenceFrom, emptyOverrides, windowOf } from './presence.js';
import {
  makeMonumentUniforms, updateMonumentUniforms, MONUMENT_GLSL,
} from './monument.js';
import {
  makeCloudUniforms, updateCloudUniforms, mistOffset,
} from './clouds.js';
import {
  makeHorizonUniforms, updateHorizonUniforms,
} from './horizon.js';
import { TraceStore, TraceField, DEFAULT_TRACE_PARAMS } from './traces.js';
import { Walker, DEFAULT_WALKER } from './walker.js';
import { Terrain } from './terrain.js';
import { Sky } from './sky.js';
import { Cover } from './cover.js';
import {
  DEFAULT_REGION, regionHeight, makeRegionUniforms, applyRegionToUniforms,
} from './region.js';
import { Player } from './player.js';
import { createUI, createHUD, createHint, loadSettings, saveSettings } from './ui.js';
import { GpuTimer } from './gputimer.js';
import { PixelGovernor } from './governor.js';

// The page catches what goes wrong before this module even loads, and it
// owns the box that says so and the button that copies the report. This is
// how the world puts its own refusals in that same box.
function fail(message) {
  if (window.dreamNote) window.dreamNote(message);
  else console.error(message);
}

function boot() {
  const canvas = document.getElementById('view');

  // Read before anything else: the renderer cannot change its mind about
  // multisampling later.
  let wantMsaa = false;
  try {
    const saved = JSON.parse(localStorage.getItem('dreamworld.settings.v1'));
    wantMsaa = !!(saved && saved.quality && saved.quality.msaa);
  } catch (err) { wantMsaa = false; }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: wantMsaa });
  } catch (err) {
    fail('Tento prohlížeč neumí WebGL 2. Zkus Chrome nebo Edge.');
    return;
  }
  renderer.info.autoReset = false;
  const gpuTimer = new GpuTimer(renderer);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 6000);
  const clock = new WorldClock();

  // ------------------------------------------------------------ settings
  const defaults = {
    identity: DEFAULT_IDENTITY,
    epoch: 0,
    dev: deviationFrom(DEFAULT_IDENTITY, 0, DEFAULT_GROWTH),
    base: { ...DEFAULT_BASE },
    trace: { ...DEFAULT_TRACE_PARAMS },
    presence: emptyOverrides(),
    region: { ...DEFAULT_REGION },
    // How reluctantly two people's air mixes where both have walked. At
    // one it is a plain average; higher, and a place belongs more firmly to
    // whoever woke it most, with the mixed air narrowed to the seam between
    // them.
    air: { mix: 1.8 },
    walker: { ...DEFAULT_WALKER },
    // Not traits of the world: how many pixels the card is asked for, and
    // whether it also has to multisample them. Hardware antialiasing costs
    // 16 ms of an empty frame at this size on integrated graphics, and this
    // world draws its own edges in the shader anyway. With `auto` on, the
    // governor holds the scale under the frame budget by itself.
    quality: { scale: 1.0, msaa: 0, auto: 1 },
  };
  const settings = loadSettings(defaults);

  // The one dial that always works on a world whose cost is screen area.
  const governor = new PixelGovernor(settings.quality.scale);
  let megapixels = 0;
  // Changing the drawing buffer clears it, and the browser shows the canvas
  // once per frame, after this code has run. So a resize done at the end of a
  // frame — right after the render that measured the cost — throws away the
  // picture that was just drawn and the page behind the canvas shows through
  // for one frame. That is a blink. Nothing resizes outside the top of a
  // frame; these two say what is waiting to be done there.
  let wantScale = 0;      // a pixel scale the governor has asked for
  let resizeDue = false;  // the canvas itself, or the dial, has moved

  // -------------------------------------------------------------- pieces
  const worldU = makeWorldUniforms(settings.base);
  const cloudU = makeCloudUniforms();
  const monumentU = makeMonumentUniforms();
  const horizonU = makeHorizonUniforms();
  const regionU = makeRegionUniforms();
  const personalU = {
    uFogColor: { value: new THREE.Vector3() },
    uZenith: { value: new THREE.Vector3() },
    uGroundHigh: { value: new THREE.Vector3() },
    uGroundLow: { value: new THREE.Vector3() },
    uTraceTint: { value: new THREE.Vector3() },
    uLightColor: { value: new THREE.Vector3() },
    uLightDir: { value: new THREE.Vector3(0, 1, 0) },
    uFogDensity: { value: 1 },
    uViewDistance: { value: 120 },
    uGrainScale: { value: 1 },
    uGrainStrength: { value: 1 },
    uMistOffset: { value: [0, 0] },
    uGustOffset: { value: [0, 0] },
    uWindDir: { value: 0 },
    uWindSpeed: { value: 1 },
    uViewDir: { value: new THREE.Vector3(0, 0, -1) },
    // The made skies' band stack. Empty for a palette that has none, and
    // then the sky draws its single ramp as before.
    uBandCount: { value: 0 },
    uBandAt: { value: new Array(MAX_BANDS).fill(0) },
    uBandSoft: { value: new Array(MAX_BANDS).fill(1) },
    uBandCol: { value: Array.from({ length: MAX_BANDS },
      () => new THREE.Vector3()) },
    uSkyKind: { value: 0 },
  };

  // Growth reaches the ground shader as a place, not as a number: the
  // ceiling is what this person's life allows to wake, and the bloom field
  // says where it has actually woken.
  const growthU = {
    uGrowthCeiling: { value: 0 },
    uPartyCeiling: { value: 0 },
    uWinRelief: { value: windowOf('relief') },
    uWinSky: { value: windowOf('sky') },
    uOvrSky: { value: -1 },
    uWinClouds: { value: windowOf('clouds') },
    uOvrClouds: { value: -1 },
    uWinCloudShadows: { value: windowOf('cloudShadows') },
    uOvrCloudShadows: { value: -1 },
    uPresenceCover: { value: 0 },
    // How far along a view direction the sky asks about the ground.
    uSkyProbe: { value: 45 },
    uSunSize: { value: Math.cos(0.2) },
  };

  const traces = new TraceStore(settings.trace, settings.identity);
  const walker = new Walker(settings.walker);
  const field = new TraceField(renderer, traces);
  const terrain = new Terrain(
    [worldU, field.uniforms, personalU, cloudU, growthU, regionU]);
  const sky = new Sky(
    [worldU, personalU, cloudU, growthU, monumentU, horizonU,
      field.uniforms]);
  const cover = new Cover(
    [worldU, personalU, growthU, regionU, field.uniforms]);
  scene.add(terrain.mesh);

  const player = new Player(canvas);
  // Scratch, so asking where the walker is costs no allocation.
  const walkerLook = new THREE.Vector3();
  const hud = createHUD();
  const hint = createHint();
  player.onLockChange = (locked) => hint.show(!locked);

  // Presence is no longer one number for the whole world. This is the
  // presence where the player is standing, which is what the sky and the
  // clouds overhead answer to; the ground works it out per pixel.
  let applyQuality = () => {};
  let presence = presenceFrom(0, settings.presence);
  let bloomHere = 0;
  let breathPhase = 0;
  // The air where the player stands, and the authors it was mixed from.
  // Reused rather than rebuilt, because this is worked out every frame.
  const airEntries = [];
  let air = null;

  // What the ground is allowed to know about the people on it: the mix of
  // everyone present, never one person's own vector. With one player the
  // mix is that player.
  let party = partyFrom([{ growth: 0 }]);
  const RELIEF_WINDOW = windowOf('relief');

  function smoothstep01(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  // The ground, as the player feels it. Exactly the terms the vertex shader
  // uses: shared base shaped by the shared relief, minus the shared traces.
  function groundHeightAt(x, z) {
    const now = clock.nowMs();
    // The wide wake, exactly as the vertex shader reads it. Using the
    // narrow bloom here would put the collision surface on a different
    // hill from the drawn one.
    const relief = smoothstep01(RELIEF_WINDOW[0], RELIEF_WINDOW[1],
      party.growth * traces.wakeAt(x, z, now));
    return baseHeight(x, z, breathPhase, settings.base, relief)
      + regionHeight(x, z, regionU.uLawStrength.value, settings.region)
      - traces.depthAt(x, z, now);
  }

  // Everyone's vector, worked out once and kept. Hashing a name is cheap,
  // but the air is mixed every frame and the palette behind it is a dozen
  // colour conversions.
  //
  // The day belongs to the world and not to a person, so everybody is read
  // at the day the panel is set to. The person looking is the exception:
  // their vector is the one on the panel, hand-tuned fog and all, or moving
  // a slider would be undone the moment they walked on their own line.
  const vectors = new Map();
  let selfVector = { dev: settings.dev, palette: null };
  function vectorOf(identity) {
    if (identity === settings.identity) return selfVector;
    let v = vectors.get(identity);
    if (!v) {
      const dev = deviationFrom(identity, settings.epoch, settings.dev.growth);
      v = { dev, palette: paletteFrom(dev) };
      vectors.set(identity, v);
    }
    return v;
  }

  // Reused: setClearColor is called once a frame and does not need a new
  // colour object each time.
  const clearColor = new THREE.Color();

  // The air, as it is where the player is standing — colour, light, fog,
  // grain, the cloud's shape and the size of the sun. The place decides
  // this, not the panel, so it runs every frame and is allowed to touch
  // nothing but uniforms: it writes no settings and saves nothing.
  function applyAir(d, p) {
    const set = (u, c) => u.value.set(c[0], c[1], c[2]);
    set(personalU.uFogColor, p.fog);
    set(personalU.uZenith, p.zenith);
    set(personalU.uGroundHigh, p.groundHigh);
    set(personalU.uGroundLow, p.groundLow);
    set(personalU.uTraceTint, p.trace);
    set(personalU.uLightColor, p.light);
    personalU.uBandCount.value = p.bands.length;
    personalU.uSkyKind.value = p.skyKind;
    for (let i = 0; i < MAX_BANDS; i++) {
      const b = p.bands[i];
      personalU.uBandAt.value[i] = b ? b.at : 0;
      // Never zero: the shader smoothsteps across it and a zero-width
      // join is undefined.
      personalU.uBandSoft.value[i] = b ? Math.max(0.002, b.soft) : 1;
      const c = personalU.uBandCol.value[i];
      if (b) c.set(b.rgb[0], b.rgb[1], b.rgb[2]); else c.set(0, 0, 0);
    }
    const l = lightDirection(d);
    personalU.uLightDir.value.set(l[0], l[1], l[2]).normalize();
    personalU.uFogDensity.value = d.fogDensity;
    personalU.uViewDistance.value = d.viewDistance;
    personalU.uGrainScale.value = d.grainScale;
    personalU.uGrainStrength.value = d.grainStrength;
    growthU.uSunSize.value = Math.cos(d.sunAngle);
    renderer.setClearColor(
      clearColor.setRGB(p.fog[0], p.fog[1], p.fog[2]), 1);
  }

  // Everything the panel owns: what the person looking has earned, what
  // they have pinned by hand, and the shared ground. Called when something
  // was touched, never per frame.
  function applySettings() {
    const d = settings.dev;
    // A vector that was hashed from a name is only right for the day and
    // the growth it was hashed at, and both are on the panel.
    vectors.clear();
    selfVector = { dev: d, palette: paletteFrom(d) };
    applyAir(d, selfVector.palette);

    // The wind is the one part of the air that cannot vary by place: it is
    // integrated against the world's own clock, and the reason is written
    // down beside the mix in deviation.js.
    personalU.uWindDir.value = d.windDir;
    personalU.uWindSpeed.value = d.windSpeed;

    growthU.uGrowthCeiling.value = d.growth;
    const forced = (key) => {
      const v = settings.presence[key];
      return (v === null || v === undefined) ? -1 : v;
    };
    growthU.uOvrSky.value = forced('sky');
    growthU.uOvrClouds.value = forced('clouds');
    growthU.uOvrCloudShadows.value = forced('cloudShadows');
    // Cover exists for the person; whether it exists *here* is the blade's
    // own business, and it asks the same fields the ground does.
    growthU.uPresenceCover.value =
      presenceFrom(d.growth, settings.presence).groundCover;
    growthU.uSkyProbe.value = d.skyProbe;
    party = partyFrom([{ growth: d.growth }]);
    growthU.uPartyCeiling.value = party.growth;
    // The law shapes the shared ground, so it answers to the party mix.
    applyRegionToUniforms(regionU, settings.region,
      presenceFrom(party.growth, settings.presence).brokenLaw);

    applyBaseToUniforms(worldU, settings.base);
    // Who is walking from now on. Points already laid keep the name they
    // were laid under, which is how changing the identity makes this place
    // have two authors instead of rewriting its one.
    traces.author = settings.identity;
    saveSettings(settings);
  }

  const ui = createUI({
    settings,
    localBloom: () => bloomHere,
    quality: () => ({
      auto: !!settings.quality.auto,
      scale: settings.quality.scale,
      megapixels,
      // What the governor is actually defending, so the panel shows the
      // same thing it is deciding on.
      fps: governor.pace > 0 ? 1000 / governor.pace : 0,
      late: governor.late,
      helpless: governor.helpless,
      atFloor: governor.atFloor,
      trusted: gpuTimer.supported,
    }),
    onChange: applySettings,
    onTraceParams: () => traces.reindex(),
    onQuality: () => {
      // Handing the dial back: the governor starts again from wherever the
      // hand left it, with no memory of what used to be too much.
      if (settings.quality.auto) {
        settings.quality.scale = governor.resume(settings.quality.scale);
      }
      applyQuality();
      saveSettings(settings);
    },
    onClearTraces: () => { traces.clear(); field.draw(clock.nowMs()); },
    // Clearing the traces now keeps the old walk, so there is something to
    // put back and this is the control that puts it back.
    onRestoreTraces: () => {
      const n = traces.restore();
      field.draw(clock.nowMs());
      return n;
    },
    traceStatus: () => ({
      points: traces.points.length,
      kept: traces.kept(),
      readOnly: traces.readOnly,
    }),
    // Who the air here belongs to, for the panel to say out loud.
    airStatus: () => (air ? air.parts : []),
    // Where the other walker is, in the only terms that help somebody
    // trying to find them: how far, and whether to turn round.
    walkerStatus: () => {
      camera.getWorldDirection(walkerLook);
      const b = walker.bearingFrom(player.position.x, player.position.z,
        walkerLook.x, walkerLook.z);
      return {
        on: !!settings.walker.on,
        identity: settings.walker.identity,
        distance: b.distance,
        turn: b.turn,
        points: traces.countOf(settings.walker.identity),
      };
    },
    // Takes back every point the walker laid, and nothing else. The one
    // thing authorship makes easy that was not possible before.
    onClearWalker: () => {
      const n = traces.trimAuthor(settings.walker.identity, 0);
      walker.last = null;
      field.draw(clock.nowMs());
      traces.save(true);
      return n;
    },
    // Somebody else's line, laid across the way ahead.
    //
    // This is not the second walker — that is its own step, with a vector
    // and a will of its own. It is the control that makes the step before
    // it visible: without it, seeing another person's air takes two
    // machines, two people and a quarter of an hour of walking. What it
    // writes is an ordinary walk under another name, indistinguishable
    // from one somebody made, and 'smazat stopy' takes it away again.
    onVisitor: (name) => {
      const who = (name || '').trim() || 'poutník';
      const now = clock.nowMs();
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const len = Math.hypot(dir.x, dir.z) || 1;
      const fx = dir.x / len, fz = dir.z / len;   // the way the player faces
      const ax = -fz, az = fx;                    // and across it
      const cx = player.position.x + fx * 14;
      const cz = player.position.z + fz * 14;
      const a = traces.authorIndex(who);
      // Laid a few seconds ago, so the place is already awake when it
      // appears: a line that woke while being looked at would arrive as a
      // brightening rather than as somewhere somebody has been.
      const t0 = now - 5000;
      const half = 20, step = Math.max(0.2, traces.params.spacing);
      for (let t = -half; t <= half; t += step) {
        traces.add(cx + ax * t, cz + az * t, t0, 1.0, a);
      }
      traces.save(true);
      field.draw(now);
      return who;
    },
    onReset: () => {
      settings.identity = DEFAULT_IDENTITY;
      settings.epoch = 0;
      Object.assign(settings.dev,
        deviationFrom(DEFAULT_IDENTITY, 0, DEFAULT_GROWTH));
      Object.assign(settings.base, DEFAULT_BASE);
      Object.assign(settings.trace, DEFAULT_TRACE_PARAMS);
      settings.presence = emptyOverrides();
      traces.reindex();
      applySettings();
    },
  });
  applySettings();

  // The canvas keeps its own size from the stylesheet; only the drawing
  // buffer is set here. The window can also report nothing at all (a hidden
  // tab, a collapsed pane), and rendering into that leaves a canvas that
  // never comes back — so the size is watched rather than listened for once.
  function resize() {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    // Capped at one. Beyond that the card draws four pixels for every one
    // anybody sees, and this world is flat colour — it gains nothing.
    const dpr = Math.min(window.devicePixelRatio, 1) * settings.quality.scale;
    if (canvas.width === Math.round(w * dpr)
      && canvas.height === Math.round(h * dpr)) return;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    megapixels = (canvas.width * canvas.height) / 1e6;
    // Whatever the governor last measured was a different picture.
    governor.hold();
  }
  const askResize = () => { resizeDue = true; };
  window.addEventListener('resize', askResize);
  if (window.ResizeObserver) new ResizeObserver(askResize).observe(canvas);
  resize();
  applyQuality = askResize;

  // Debug handle. Not used by the world, but it means anything can be
  // inspected or driven from outside without adding buttons for it.
  window.dreamworld = {
    renderer, scene, camera, clock, player, traces, field, terrain, sky, cover,
    settings, applySettings, governor, gpuTimer,
    // Changing the pixel count by hand from outside, the same way the panel
    // does it: ask, and the next frame applies it.
    askResize: () => { resizeDue = true; },
    presence: () => presence, bloomHere: () => bloomHere,
    air: () => air, walker,
    authorsHere: () => traces.authorsAt(
      player.position.x, player.position.z, clock.nowMs()),
  };

  // What the world can say about itself when somebody has to report that
  // it is broken. The page builds the rest of the report around this.
  window.dreamReportExtra = () => {
    const p = player.position;
    const kept = traces.kept()
      .map((k) => k.count).join(', ') || 'žádné';
    return [
      'identita: ' + settings.identity + ' / den ' + settings.epoch
        + ' · paleta ' + settings.dev.paletteIndex,
      'rozlišení: ' + settings.quality.scale.toFixed(2) + '× · '
        + megapixels.toFixed(2) + ' Mpx · '
        + (settings.quality.auto ? 'automatika' : 'ručně')
        + (settings.quality.msaa ? ' · vyhlazení' : ''),
      'snímky: ' + (governor.pace > 0
        ? Math.round(1000 / governor.pace) + ' sn/s'
        : 'neměřeno')
        + ' · perioda ' + governor.period.toFixed(1) + ' ms'
        + (gpuTimer.supported
          ? ' · karta ' + (governor.cost > 0 ? governor.cost.toFixed(1) : '?')
            + ' ms'
          : ' · bez časovače karty')
        + (governor.late ? ' · opožděné' : '')
        + (governor.helpless ? ' · zdržuje to něco jiného' : ''),
      'stopy: ' + traces.points.length + ' bodů · zálohy: ' + kept
        + (traces.readOnly ? ' · jen pro čtení' : ''),
      'druhý chodec: ' + (settings.walker.on
        ? settings.walker.identity + ' · '
          + traces.countOf(settings.walker.identity) + ' bodů · '
          + Math.round(walker.bearingFrom(player.position.x,
            player.position.z, 0, -1).distance) + ' m'
        : 'vypnutý'),
      'vzduch zde: ' + (air && air.parts.length
        ? air.parts.map((q) => q.identity + ' '
          + Math.round(q.weight * 100) + ' %').join(' · ')
        : 'nikdo tu nebyl')
        + ' · míchání ' + settings.air.mix.toFixed(2),
      'kde: ' + p.x.toFixed(1) + ', ' + p.z.toFixed(1)
        + ' · probuzeno ' + bloomHere.toFixed(2),
    ];
  };

  const persist = () => {
    traces.save(true);
    if (qualityDirty) { saveSettings(settings); qualityDirty = false; }
  };
  window.addEventListener('beforeunload', persist);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persist();
  });

  // ---------------------------------------------------------------- loop
  let last = performance.now();
  let qualityDirty = false;
  let qualitySaved = last;
  let panelDue = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    // Everything that changes the pixel count happens here, before this
    // frame is drawn, so the buffer it clears is filled again before anybody
    // sees it.
    if (wantScale) {
      settings.quality.scale = wantScale;
      wantScale = 0;
      resizeDue = true;
    }
    if (resizeDue) { resizeDue = false; resize(); }
    // The clamped step drives the world; the real one is what the governor
    // judges the frame by.
    const frameMs = now - last;
    const dt = Math.min(0.1, frameMs * 0.001);
    last = now;
    const workStart = performance.now();

    // One clock. Everything animated reads it, and it reaches the GPU only
    // as phases that have already been wrapped.
    const seconds = clock.seconds();
    const wallNow = clock.nowMs();
    breathPhase = scrollPhase(seconds, settings.base.breathRate, BREATH_PERIOD);
    worldU.uBreathPhase.value = breathPhase;

    const mist = mistOffset(seconds, settings.dev);
    personalU.uMistOffset.value[0] = mist[0];
    personalU.uMistOffset.value[1] = mist[1];

    // The same wind, one scale finer, for anything with a stalk.
    const gust = driftOffset(seconds, settings.dev.windDir,
      settings.dev.windSpeed * 1.4, 0.006, GUST_PERIOD);
    personalU.uGustOffset.value[0] = gust[0];
    personalU.uGustOffset.value[1] = gust[1];

    player.update(dt, camera, groundHeightAt);

    if (player.speed > 0.3) {
      if (traces.deposit(player.position.x, player.position.z, wallNow)) {
        traces.save(false);
      }
    }

    // Somebody else, walking. Its trail is not worth a save of its own —
    // the store writes itself out when the player walks and when the page
    // goes away, and that is often enough for a trail that forgets its own
    // beginning anyway.
    walker.update(seconds, wallNow, traces);

    // What is overhead belongs to the ground underfoot: the sky opens over
    // woken land and closes again over the Nothing.
    bloomHere = traces.bloomAt(player.position.x, player.position.z, wallNow);
    presence = presenceFrom(settings.dev.growth * bloomHere, settings.presence);

    // Whose air this is. The place answers with everyone who ever walked
    // it, each weighted by how much of its waking is theirs. Where nobody
    // has walked there is nobody to ask, and the air is the person standing
    // here — which is also what the ground answers to, and with one player
    // the two are the same thing.
    airEntries.length = 0;
    const authors = traces.authorsAt(
      player.position.x, player.position.z, wallNow);
    for (const one of authors) {
      const v = vectorOf(one.author);
      airEntries.push({ dev: v.dev, palette: v.palette, weight: one.weight });
    }
    if (airEntries.length === 0) {
      airEntries.push({
        dev: selfVector.dev, palette: selfVector.palette, weight: 1,
      });
    }
    air = mixAir(airEntries, settings.dev, settings.air.mix);
    applyAir(air.dev, air.palette);

    updateCloudUniforms(cloudU, air.dev, presence, seconds);

    // The monument answers to the party ceiling alone. It stands far past
    // anything anyone has walked, so gating it on the bloom would mean
    // never seeing it.
    const farPresence = presenceFrom(party.growth, settings.presence);
    updateMonumentUniforms(monumentU, camera.position.x, camera.position.z,
      farPresence.monument);
    // The skyline stands on the far world too, and for the same reason is
    // not gated by anybody's walked line.
    updateHorizonUniforms(horizonU, camera.position.x, camera.position.z,
      farPresence.horizon);

    field.update(player.position.x, player.position.z, wallNow);
    terrain.update(camera.position.x, camera.position.z,
      personalU.uViewDistance.value);
    sky.update(scene, camera,
      traces.points.length > 0 ? settings.dev.growth : 0);
    camera.getWorldDirection(personalU.uViewDir.value);
    cover.update(scene, camera, growthU.uPresenceCover.value);

    renderer.info.reset();
    gpuTimer.begin();
    renderer.render(scene, camera);
    gpuTimer.end();

    const gpuMs = gpuTimer.poll();
    hud.frame(dt, performance.now() - workStart, gpuMs, gpuTimer.supported);
    hud.set(renderer.info.render.triangles, renderer.info.render.calls,
      traces.points.length, player.position.x, player.position.z,
      settings.dev.growth * bloomHere,
      megapixels, settings.quality.scale, settings.quality.auto);

    // Last thing in the frame: judge the frame that was just drawn, and if
    // the pixel count has to move, move it before the next one starts.
    if (settings.quality.auto) {
      const want = governor.update(frameMs,
        gpuTimer.supported ? gpuMs : frameMs, gpuTimer.supported);
      if (want !== settings.quality.scale) {
        wantScale = want;
        qualityDirty = true;
      }
    }
    // The governor can change its mind every half second; the disk does not
    // need to hear about each one.
    if (qualityDirty && now - qualitySaved > 4000) {
      saveSettings(settings);
      qualityDirty = false;
      qualitySaved = now;
    }
    // The panel's own reading of a dial that nobody is touching.
    panelDue -= dt;
    if (panelDue <= 0) { panelDue = 0.25; ui.refreshLive(); }
  }

  requestAnimationFrame(frame);
}

boot();
