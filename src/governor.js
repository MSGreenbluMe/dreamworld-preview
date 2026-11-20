// governor.js — how many pixels the card is asked for, decided while running.
//
// The world's cost scales with screen area, so the one dial that always
// works is how many pixels get drawn. This watches how the world is
// actually running and moves that dial to keep the motion whole.
//
// It holds no world state and changes nothing anybody can walk on: the
// same world is drawn, on fewer or more pixels. Two players with different
// cards still see the same ground in the same place.
//
// What it judges by is the interval between frames, and nothing else. An
// earlier version of this judged by what the card's own timer reported and
// held it under a budget in milliseconds, which was wrong in a way that is
// worth writing down: measured here, the card reported 7.4 ms of work
// while the frames were arriving 22.9 ms apart. The card's work was a
// third of the frame. Everything else — the browser's own compositing,
// the wait for the display — is real time the player feels and no budget
// in card-milliseconds can see it. So the frame interval decides, and the
// card's timer is kept for the one thing it is good at: saying how big a
// step to take, and whether there is room for another.
//
//   - It goes down as soon as frames are plainly late, because that is
//     what is felt, and it comes back up only slowly and only after a
//     quiet while.
//   - Every change snaps to a coarse grid, so the picture settles instead
//     of breathing.
//   - After any change it stops looking for half a second, because the
//     measurement it reads is an average and still remembers the old size.
//   - A scale that made frames late is out of reach and stays out of
//     reach. It is handed back only once the picture has become much
//     cheaper than the one that failed, and never because time passed.
//
// On a machine with no card timer at all — and the first one this was
// tested on was exactly that — none of the judging above can run, and an
// earlier version simply walked the picture down to the floor and left it
// there: still late, and now blurred as well. So when there is no timer
// the governor finds out by doing. It takes a step, waits for the reading
// to settle, and asks whether the frames actually came back. If they did
// not, the picture was never what was late, and the step is given back,
// because a blurrier world that runs no better is a loss with nothing
// bought. Two such steps and it leaves the dial alone for a while.

export const GOVERNOR_DEFAULTS = {
  // Below this the picture stops being a picture. The governor would
  // rather keep missing frames than go here.
  min: 0.45,
  // Above one the card draws pixels nobody sees; this world is flat
  // colour and gains nothing from them.
  max: 1.0,
  grid: 0.05,
  // After a change the reading is stale. Wait before believing it, then
  // take this many readings and average them before judging anything.
  settleMs: 500,
  warmFrames: 4,
  // How long frames have to arrive on time before any pixels are taken
  // back.
  patienceMs: 2000,
  // How late the frames have to be running before it counts. The pace
  // below is read off the quickest frames of a stretch, which reads a
  // little under the display's true one, so this has to carry that slack
  // as well as the ordinary unevenness of a browser's clock. Too tight
  // and the governor chases the last millisecond for ever, giving up a
  // quarter of the picture to turn 54 frames a second into 58.
  missRatio: 1.25,
  // What the display's pace is taken to be until something faster is
  // proved, and how long a stretch that proof is gathered over.
  //
  // Two guards, and both are needed. It is learned downward only: a run
  // of slow frames says this machine is struggling, never that the
  // display got slower. And it is not the quickest frame of the stretch
  // but the quickest few — the browser hands out an interval well under
  // the true period now and then, and a single one of those convinced an
  // earlier version that the display ran at 74 Hz, after which every
  // frame was late and the picture went to the floor and stayed there.
  periodMs: 16.7,
  periodFloorMs: 6.0,
  periodWindowMs: 3000,
  periodRank: 24,
  // Never give up more than this much of the picture in one step, however
  // late the frames are: one bad stretch must not empty the screen.
  mostAtOnce: 0.65,
  // How much the card has to be taking before giving up pixels could even
  // help. This dial reaches the card's work and nothing else, so when the
  // card is already doing almost nothing and the frames are still late,
  // whatever is in the way is not the picture.
  //
  // Measured two ways, because one is not enough. Against the display's
  // pace: below this the card cannot be what is costing the frame. And
  // against the frame actually being drawn: a window behind another window
  // gets its frames handed out at fifteen a second while the card is still
  // taking seven milliseconds of each one, and emptying the picture would
  // not have given a single frame back.
  helpRatio: 0.30,
  helpShare: 0.22,
  // A scale that failed is offered again only when the card's work has
  // fallen this far below what it was when it failed, and stayed there.
  forgetUnder: 0.60,
  forgetMs: 10000,
  // With no card timer, how long to watch after a step before believing
  // the answer, how much of the improvement the step promised has to
  // arrive for it to count as one, and how long to leave the dial alone
  // once two steps running have bought nothing.
  proveMs: 700,
  proveShare: 0.20,
  // And how far the frames have to have moved from where the dial proved
  // useless before it is worth trying again. Not a clock: a dial that
  // bought nothing a minute ago buys nothing now unless something about
  // the machine has changed, and offering the picture up again on a timer
  // is what made an earlier version of this breathe.
  provenMoved: 0.25,
};

function snap(v, grid) { return Math.round(v / grid) * grid; }

export class PixelGovernor {
  constructor(scale, opts) {
    this.p = { ...GOVERNOR_DEFAULTS, ...(opts || {}) };
    this.scale = Math.min(this.p.max, Math.max(this.p.min, scale));
    this.cost = NaN;          // smoothed card reading, NaN until one arrives
    this.warmSum = 0;
    this.warmN = 0;
    this.pace = NaN;          // smoothed interval between frames
    this.period = this.p.periodMs;
    // The quickest few intervals of the current stretch, ascending.
    this.lowest = new Float64Array(this.p.periodRank).fill(Infinity);
    this.winLeft = this.p.periodWindowMs;
    this.holdLeft = this.p.settleMs;
    this.roomFor = 0;
    this.ceiling = Infinity;  // a scale that made frames late
    this.failCost = Infinity; // and what the card was taking when it did
    this.cheapFor = 0;
    this.atFloor = false;
    this.late = false;
    this.helpless = false;
    // What a blind step down is waiting to find out, and what it has
    // learned so far.
    this.trying = null;
    this.proveLeft = 0;
    this.pointless = 0;
    this.uselessAt = 0;   // the pace at which the dial proved useless
    this.trusted = false;
    this.changed = false;
  }

  // Called when something other than the governor changed the pixel count
  // (a window resize, a hand on the slider): the reading is now about a
  // different picture.
  hold() {
    this.holdLeft = this.p.settleMs;
    this.cost = NaN;
    this.warmSum = 0;
    this.warmN = 0;
    this.roomFor = 0;
  }

  // Hand the dial back to the governor at wherever it is now, with no
  // memory of what used to be too much.
  resume(scale) {
    this.scale = Math.min(this.p.max,
      Math.max(this.p.min, snap(scale, this.p.grid)));
    this.ceiling = Infinity;
    this.failCost = Infinity;
    this.cheapFor = 0;
    this.trying = null;
    this.proveLeft = 0;
    this.pointless = 0;
    this.uselessAt = 0;   // the pace at which the dial proved useless
    this.hold();
    return this.scale;
  }

  // dtMs     — real time since the last frame: the thing being defended
  // sampleMs — what the card took, when there is a timer to say so
  // trusted  — true when sampleMs is the card's own measurement
  // Returns the scale to draw at.
  update(dtMs, sampleMs, trusted) {
    this.trusted = trusted;
    const p = this.p;
    const before = this.scale;

    // A hitch — a tab coming back, a garbage collection, a window being
    // dragged — says nothing about how the world is running.
    const hitch = !(dtMs > 0) || dtMs > 100;
    if (hitch) { this.hold(); return this.scale; }

    // The display's own pace, learned rather than assumed. The quickest
    // few intervals of a long stretch are kept, and the slowest of those
    // few is taken as a pace this machine actually keeps rather than one
    // it hit once.
    const low = this.lowest;
    if (dtMs < low[low.length - 1]) {
      let k = low.length - 1;
      while (k > 0 && low[k - 1] > dtMs) { low[k] = low[k - 1]; k--; }
      low[k] = dtMs;
    }
    this.winLeft -= dtMs;
    if (this.winLeft <= 0) {
      const kept = low[low.length - 1];
      if (kept > p.periodFloorMs && kept < this.period) {
        this.period += (kept - this.period) * 0.5;
      }
      low.fill(Infinity);
      this.winLeft = p.periodWindowMs;
    }

    // The interval is what the player feels, so it is smoothed gently and
    // never reset: it has to stay true across a change of size, because a
    // change of size is exactly what it has to judge.
    this.pace = Number.isFinite(this.pace)
      ? this.pace + (dtMs - this.pace) * 0.15
      : dtMs;

    if (this.holdLeft > 0) { this.holdLeft -= dtMs; return this.scale; }

    if (trusted && sampleMs > 0) {
      if (Number.isFinite(this.cost)) {
        this.cost += (sampleMs - this.cost) * 0.2;
      } else {
        // The first readings of a new picture are averaged rather than
        // believed one at a time. Seeding from a single frame meant one
        // spike could step the picture down a rung it did not need to
        // lose, and there it stayed.
        this.warmSum += sampleMs;
        this.warmN += 1;
        if (this.warmN < p.warmFrames) return this.scale;
        this.cost = this.warmSum / this.warmN;
      }
    }

    const haveCost = trusted && Number.isFinite(this.cost) && this.cost > 0;
    this.late = this.pace > this.period * p.missRatio;

    // Did the last blind step buy anything? The step removed a known
    // share of the pixels, so it promised a frame that much quicker. Some
    // of the frame is never the picture, so only a fraction of what was
    // promised is expected — but none of it arriving means the picture is
    // not what is late.
    if (this.trying && this.proveLeft > 0) {
      this.proveLeft -= dtMs;
      if (this.proveLeft <= 0) {
        const promised = this.trying.pace * (1 - this.trying.area);
        const gained = this.trying.pace - this.pace;
        if (promised > 0.3 && gained < promised * p.proveShare) {
          // Nothing. Take the picture back and count the attempt.
          this.scale = this.trying.from;
          this.ceiling = Infinity;
          this.failCost = Infinity;
          this.pointless += 1;
          if (this.pointless >= 2) this.uselessAt = this.pace;
          this.hold();
        } else {
          this.pointless = 0;
        }
        this.trying = null;
      }
    }

    // Whether this dial can do anything about it. Giving up pixels only
    // removes the card's work; when that is already a small part of the
    // frame, the frames are late for a reason the dial cannot reach — the
    // browser's own compositing, another window, a tab being throttled —
    // and dropping further would cost the player a sharp picture and buy
    // nothing at all. So it holds where it is and says so on the panel.
    // Without this it went to the floor and sat there.
    const canHelp = !haveCost
      || (this.cost > this.period * p.helpRatio
        && this.cost > this.pace * p.helpShare);
    // Blind, and already proved twice over that the dial reaches nothing
    // at this pace: the same state as a card that is plainly not what is
    // costing the frame. It is offered up again only once the frames have
    // moved a long way from where that was true, never because time
    // passed.
    const resting = !haveCost && this.uselessAt > 0
      && Math.abs(this.pace - this.uselessAt) < this.uselessAt * p.provenMoved;
    // A step taken and not yet answered for. Another on top of it would
    // leave neither of them accountable for what happened next.
    const judging = !haveCost && this.trying !== null;
    this.helpless = this.late && (!canHelp || resting);

    if (this.late && (!canHelp || resting || judging)) {
      // Nothing to do. Not climbing either: adding work to a frame that is
      // already late is the one move that is certainly wrong.
      this.roomFor = 0;
      this.cheapFor = 0;
    } else if (this.late) {
      // How much of the frame has to go. The excess is real time, and the
      // only part of it this dial can reach is the card's work, so that
      // is what the step aims to take out of it. With no timer there is
      // nothing to aim with and it walks down one rung at a time.
      let want;
      if (haveCost) {
        const excess = this.pace - this.period;
        const target = Math.max(this.cost - excess, this.cost * 0.5);
        want = this.scale * Math.sqrt(target / this.cost);
      } else {
        want = this.scale - p.grid;
      }
      want = Math.max(want, this.scale * p.mostAtOnce);
      const next = Math.max(p.min,
        Math.min(this.scale - p.grid, snap(want, p.grid)));
      this.roomFor = 0;
      this.cheapFor = 0;
      if (next < this.scale) {
        // Only a scale actually stepped down from becomes a ceiling.
        // Standing on the floor with frames still late remembers nothing:
        // there is nothing left to give up, and a ceiling at the floor
        // would stop the climb back when the picture gets cheaper again.
        this.ceiling = this.scale;
        this.failCost = haveCost ? this.cost : Infinity;
        if (!haveCost) {
          // Blind: this step is now on trial, and what it promised is
          // worked out from the area it gave up.
          this.trying = {
            from: this.scale,
            pace: this.pace,
            area: (next * next) / (this.scale * this.scale),
          };
          this.proveLeft = p.settleMs + p.proveMs;
        }
        this.scale = next;
        this.hold();
      }
      this.atFloor = this.scale <= p.min + 1e-6;
    } else {
      const next = snap(Math.min(p.max, this.scale + p.grid), p.grid);
      const reachable = next > this.scale
        && next <= this.ceiling - p.grid * 0.5;

      if (!reachable) {
        this.roomFor = 0;
        // A scale that was too much is offered again only when this is
        // plainly a cheaper picture than the one that failed — not
        // because a clock ran out. Offering it again on a timer is what
        // made the picture change size a dozen times a minute while the
        // player stood still.
        if (haveCost && this.failCost < Infinity
          && this.cost < this.failCost * p.forgetUnder) {
          this.cheapFor += dtMs;
          if (this.cheapFor >= p.forgetMs) {
            this.ceiling = Infinity;
            this.failCost = Infinity;
            this.cheapFor = 0;
          }
        } else {
          this.cheapFor = 0;
        }
      } else {
        this.cheapFor = 0;
        // Whether there is room for another rung cannot be read off the
        // frame interval: the display holds every finished frame until
        // its moment, so a world with plenty to spare and a world with
        // none both report the same pace. The card's timer is the only
        // thing that still shows daylight, so the step is costed with it
        // — area, which is the square of the scale — and measured against
        // the most the card was taking when frames were last on time.
        const step = (next * next) / (this.scale * this.scale);
        const allowed = this.failCost < Infinity
          ? this.failCost * 0.85
          : this.period * 0.80;
        const fits = haveCost ? this.cost * step < allowed : true;
        if (fits) {
          this.roomFor += dtMs;
          if (this.roomFor >= p.patienceMs) {
            this.roomFor = 0;
            this.scale = next;
            this.atFloor = false;
            // Room to climb says the machine is coping now, whatever it
            // was doing when the dial last bought nothing.
            this.pointless = 0;
            this.uselessAt = 0;
            this.hold();
          }
        } else {
          this.roomFor = 0;
        }
      }
    }

    this.changed = this.scale !== before;
    return this.scale;
  }
}
