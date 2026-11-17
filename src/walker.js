// walker.js — somebody else, walking.
//
// Not a network and not a mind. The walker's position is a pure function of
// the shared clock, so two machines watching it see it in the same place at
// the same moment without exchanging a word. That is the whole point of
// building it this way: when there is a server, a real person's position
// arrives instead of this function and nothing else here has to change.
//
// It leaves traces exactly as the player does, under a name of its own, so
// everything the ground already knows about authors applies to it without
// being told. Its air is its own, and where its line crosses the player's
// there is air neither of them has alone.
//
// Its path is a closed curve: it goes away and it comes back. A walker that
// wandered off in a straight line would be a walker nobody ever met.

const TAU = Math.PI * 2;

export const DEFAULT_WALKER = {
  on: 1,
  identity: 'poutník',
  speed: 1.15,      // metres a second — a little slower than the player
  range: 130,       // how far from the world's origin it wanders
  spacing: 1.2,     // metres between the points it leaves behind
  // How much of its own trail it keeps. The player's walk is the one thing
  // in this world that persists, and somebody passing through must not be
  // able to thin it away: a walker that never forgot would fill the store
  // in an afternoon and the oldest thing in there is the player's.
  trail: 1200,
};

// The shape of the walk, on a unit scale. Whole harmonics, so the curve
// closes and the walker returns; the second terms are what keeps it from
// being a circle anybody could predict after one lap.
function shape(t) {
  return [
    Math.sin(t) + 0.42 * Math.sin(2 * t + 1.7),
    0.85 * Math.cos(t) + 0.33 * Math.cos(3 * t),
  ];
}

// How long that curve is, in units of `range`. Measured once, by walking
// it, because the answer has to be the same number on every machine and an
// integral of this has no closed form worth writing out.
const LAP = (() => {
  const steps = 512;
  let length = 0;
  let prev = shape(0);
  for (let i = 1; i <= steps; i++) {
    const q = shape((i / steps) * TAU);
    length += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
    prev = q;
  }
  return length;
})();

// Where the walker is at a moment on the shared clock.
//
// Time enters as a plain multiplication, which means moving `speed` or
// `range` by hand does not slow the walker down — it moves them, because
// the clock has been running for tens of millions of seconds and a
// thousandth of it is a long way. That is a tuning dial behaving like one;
// the trail simply has a gap where the walker was somewhere else.
export function walkerAt(seconds, p) {
  const range = Math.max(1, p.range);
  const lap = (LAP * range) / Math.max(0.05, p.speed);
  const q = shape((seconds / lap) * TAU);
  return { x: q[0] * range, z: q[1] * range };
}

export class Walker {
  constructor(params) {
    this.params = params || { ...DEFAULT_WALKER };
    this.x = 0;
    this.z = 0;
    this.last = null;     // where it last left a point
    this.sinceTrim = 0;   // points laid since the trail was last cut back
  }

  // Called once a frame. `seconds` is the shared clock the path is read
  // from; `nowMs` is what a trace point's age is measured against.
  // Returns true on the frames where it left something behind.
  update(seconds, nowMs, store) {
    const p = this.params;
    const at = walkerAt(seconds, p);
    this.x = at.x;
    this.z = at.z;

    if (!p.on) {
      // Picking the walker up and putting it down again should not draw a
      // line between the two places.
      this.last = null;
      return false;
    }

    const spacing = Math.max(0.3, p.spacing);
    if (this.last) {
      const dx = at.x - this.last.x, dz = at.z - this.last.z;
      if (dx * dx + dz * dz < spacing * spacing) return false;
    }

    store.add(at.x, at.z, nowMs, 1.0, store.authorIndex(p.identity));
    this.last = { x: at.x, z: at.z };

    // Cutting the trail back rebuilds the spatial hashes, so it is done in
    // one go now and then rather than a point at a time.
    this.sinceTrim++;
    if (this.sinceTrim >= 64) {
      this.sinceTrim = 0;
      store.trimAuthor(p.identity, Math.max(0, p.trail));
    }
    return true;
  }

  // How far away it is, and where to look. The bearing is relative to the
  // way the player is facing, because that is the question being asked:
  // not which way is north in a world that has no north yet, but whether
  // to turn round.
  bearingFrom(x, z, forwardX, forwardZ) {
    const dx = this.x - x, dz = this.z - z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.001) return { distance, turn: 0 };
    const len = Math.hypot(forwardX, forwardZ) || 1;
    const fx = forwardX / len, fz = forwardZ / len;
    // Positive is to the right: the cross product of the way the player
    // faces with the way the walker lies.
    const ahead = (dx * fx + dz * fz) / distance;
    const side = (dx * fz - dz * fx) / distance;
    return { distance, turn: Math.atan2(side, ahead) };
  }
}
