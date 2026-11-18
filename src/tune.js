// All game numbers live here. Pure data: no imports, no DOM, no THREE (node tests import it).
// World: metres, seconds. Player stands at the origin looking down -Z; +Y is up.

export const TUNE = {
  // ---- the bamboo ring ----
  ring: {
    inner: 0.17, // radius of the hole: a prize of radius r is ringed when the centre is within inner - r
    outer: 0.2, // radius to the outside of the rim: closer than outer + r hits the rim
    gravity: 9.8,
    drag: 0.12, // linear air drag per second (fraction of velocity)
    rimBounce: 0.35, // speed kept after hitting a prize's rim
    rimLift: 0.9, // m/s pushed upward by a rim hit
    maxBounces: 3, // after this many rim hits the ring just drops
    cooldown: 0.55, // seconds between throws
    settle: 2.5, // seconds a missed ring lies on the ground before it fades
    spin: 16, // rad/s the ring spins flat in its own plane, like a thrown disc
    spinStop: 0.6, // seconds for the spin to die down once the ring is down
  },

  // ---- how a throw is made ----
  throw: {
    origin: [0.18, 1.32, -0.35], // where the ring leaves the hand
    pitchDeg: 34, // launch elevation
    minSpeed: 3.2, // speed at charge 0 (lands about 2.3 m out)
    maxSpeed: 6.6, // speed at charge 1 (lands about 5.8 m out)
    yawMaxDeg: 24, // aim left/right limit
    chargePeriod: 1.3, // seconds for the power meter to go 0 → 1 → 0 while held
    wobble: 0.015, // random speed spread (fraction) so a perfect meter is still not certain
    previewFraction: 1, // how much of the arc the aim preview shows (all of it: Dash 2026-11-18)
  },

  // ---- wind (changes each round; drifts the ring sideways) ----
  wind: { byRound: [0, 0.25, 0.45, 0.6, 0.8] }, // m/s² of sideways push, sign random

  // ---- the prize field (prizes stand on the ground) ----
  field: {
    cols: 5,
    rows: 4,
    spacingX: 0.62,
    nearZ: -2.3,
    spacingZ: 0.85,
    jitter: 0.06, // random offset so the grid does not look printed
  },
  prizes: {
    // r: footprint radius, h: height, score, weight: how often it appears
    cup: { r: 0.06, h: 0.11, score: 10, weight: 5 },
    bottle: { r: 0.045, h: 0.24, score: 20, weight: 4 },
    cat: { r: 0.08, h: 0.16, score: 30, weight: 3 },
    pig: { r: 0.11, h: 0.13, score: 100, weight: 1 },
    // special prizes: their effect is applied by the rules
    firecracker: {
      r: 0.055,
      h: 0.2,
      score: 20,
      weight: 1.2,
      effect: "pushBack",
    },
    gong: { r: 0.1, h: 0.08, score: 20, weight: 1, effect: "freeze" },
  },
  effects: {
    pushBack: 5, // metres every zombie is shoved back
    freeze: 4, // seconds every zombie stands still
  },

  // ---- the dead ----
  zombies: {
    spawnZ: -15,
    grabZ: -1.0, // reaching this line grabs the player
    laneX: 2.6, // spawn x is random in [-laneX, laneX]
    lunge: 1.4, // metres every zombie lurches forward on a miss
    lungeTime: 0.45, // seconds the lurch takes
    flinch: 0.8, // seconds the nearest zombie stops after a ringed prize
    spacing: 1.2, // min distance between two zombies
  },

  // ---- the night: five rounds ("上菜") ----
  rounds: [
    { target: 3, alive: 1, creep: 0.28, spawnEvery: 6 },
    { target: 4, alive: 2, creep: 0.26, spawnEvery: 5 },
    { target: 5, alive: 3, creep: 0.3, spawnEvery: 4.5 },
    { target: 6, alive: 4, creep: 0.34, spawnEvery: 4 },
    { target: 8, alive: 6, creep: 0.4, spawnEvery: 3, horde: true },
  ],
  breather: 4, // seconds between rounds

  // ---- the stall ----
  chances: 3, // grabs before the stall is lost
  grabGrace: 2.2, // seconds after a grab before the dead come again
  combo: { step: 0.5, max: 3 }, // score multiplier: 1 + step * streak, capped
};
