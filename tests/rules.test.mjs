import { test } from "node:test";
import assert from "node:assert/strict";
import { createRun } from "../src/rules.js";
import { TUNE } from "../src/tune.js";

const DT = 0.05;
const CUP = { type: "cup", score: 10, r: 0.06, h: 0.11 };
const GONG = { type: "gong", score: 20, r: 0.1, h: 0.08, effect: "freeze" };
const FIRECRACKER = {
  type: "firecracker",
  score: 20,
  r: 0.055,
  h: 0.2,
  effect: "pushBack",
};

// Small seeded PRNG so every run of these tests plays out the same way.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Advance the clock by `seconds`, collecting every event.
function advance(run, seconds) {
  const events = [];
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) events.push(...run.update(DT));
  return events;
}

// Advance until an event of `type` appears (or give up after `maxSeconds`).
function advanceUntil(run, type, maxSeconds = 200) {
  const events = [];
  for (let i = 0; i < maxSeconds / DT; i++) {
    const batch = run.update(DT);
    events.push(...batch);
    if (batch.some((e) => e.type === type)) return events;
  }
  assert.fail(`no ${type} event within ${maxSeconds} s`);
}

const has = (events, type) => events.some((e) => e.type === type);
const find = (events, type) => events.find((e) => e.type === type);

test("start emits roundStart for round 0 and enters playing", () => {
  const run = createRun(TUNE, mulberry32(1));
  assert.equal(run.state.phase, "title");
  assert.equal(run.canThrow(), false);
  const events = run.start();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "roundStart");
  assert.equal(events[0].round, 0);
  assert.equal(events[0].windX, 0); // round 0 has no wind
  assert.equal(run.state.phase, "playing");
  assert.equal(run.state.chances, TUNE.chances);
  assert.equal(run.state.target, TUNE.rounds[0].target);
  assert.equal(run.canThrow(), true);
});

test("title, over and won ignore time and throws", () => {
  const run = createRun(TUNE, mulberry32(2));
  assert.deepEqual(run.update(1), []);
  assert.deepEqual(run.throwResult({ type: "miss" }), []);
  assert.deepEqual(run.throwResult({ type: "ringed", prize: CUP }), []);
});

test("zombies spawn one second into a round, then walk at creep speed", () => {
  const run = createRun(TUNE, mulberry32(3));
  run.start();
  const early = advance(run, 0.9);
  assert.equal(has(early, "spawn"), false);
  const events = advanceUntil(run, "spawn", 2);
  const spawned = find(events, "spawn").zombie;
  assert.equal(spawned.id, 1);
  assert.equal(spawned.z, TUNE.zombies.spawnZ);
  assert.equal(spawned.state, "walk");
  assert.ok(Math.abs(spawned.x) <= TUNE.zombies.laneX);

  advance(run, 1);
  const creep = TUNE.rounds[0].creep;
  assert.ok(Math.abs(spawned.z - (TUNE.zombies.spawnZ + creep * 1)) < 1e-6);
});

test("the alive limit caps zombies on the street", () => {
  const run = createRun(TUNE, mulberry32(4));
  run.start();
  // Clear round 0 to reach round 1, which allows two zombies at once.
  for (let i = 0; i < TUNE.rounds[0].target; i++)
    run.throwResult({ type: "ringed", prize: CUP });
  advance(run, TUNE.breather + 0.1);
  assert.equal(run.state.round, 1);

  let max = 0;
  for (let i = 0; i < 30 / DT; i++) {
    run.update(DT);
    max = Math.max(max, run.state.zombies.length);
  }
  // 30 s is well short of the walk to the stall, so no grab clears them.
  assert.equal(max, TUNE.rounds[1].alive);
});

test("a miss lunges every zombie forward and resets the combo", () => {
  const run = createRun(TUNE, mulberry32(5));
  run.start();
  advanceUntil(run, "spawn", 2);
  const z = run.state.zombies[0];
  advance(run, 0.5);
  const z0 = z.z;

  const events = run.throwResult({ type: "miss" });
  assert.ok(has(events, "miss"));
  assert.ok(has(events, "lunge"));
  assert.equal(run.state.streak, 0);
  assert.equal(z.state, "lunge");

  // Run until the lurch is over; the distance is the lunge plus creep during that time.
  let t = 0;
  while (z.lunge > 0 && t < 2) {
    run.update(DT);
    t += DT;
  }
  assert.equal(z.lunge, 0);
  assert.equal(z.state, "walk");
  const moved = z.z - z0;
  const expected = TUNE.zombies.lunge + TUNE.rounds[0].creep * t;
  assert.ok(
    Math.abs(moved - expected) < 1e-6,
    `moved ${moved}, expected ${expected}`,
  );
});

test("ringing the target clears the round, then the next round starts after the breather", () => {
  const run = createRun(TUNE, mulberry32(6));
  run.start();
  const target = TUNE.rounds[0].target;
  let events = [];
  for (let i = 0; i < target - 1; i++) {
    const ev = run.throwResult({ type: "ringed", prize: CUP });
    assert.ok(has(ev, "ringed"));
    assert.equal(has(ev, "roundClear"), false);
  }
  events = run.throwResult({ type: "ringed", prize: CUP });
  assert.deepEqual(
    events.map((e) => e.type),
    ["ringed", "roundClear"],
  );
  assert.equal(find(events, "roundClear").round, 0);
  assert.equal(run.state.phase, "breather");
  assert.equal(run.canThrow(), false);
  assert.deepEqual(run.state.zombies, []);

  // Not yet: the breather is still running.
  assert.equal(has(advance(run, TUNE.breather - 0.5), "roundStart"), false);
  events = advance(run, 1);
  const next = find(events, "roundStart");
  assert.ok(next, "round 1 should start");
  assert.equal(next.round, 1);
  assert.equal(run.state.phase, "playing");
  assert.equal(run.state.round, 1);
  assert.equal(run.state.ringedThisRound, 0);
  assert.equal(run.state.target, TUNE.rounds[1].target);
  assert.equal(run.state.horde, false);
});

test("combo multiplier grows with the streak, caps, and resets on a miss", () => {
  const tune = structuredClone(TUNE);
  tune.rounds[0].target = 20; // keep round 0 open for a long streak
  const run = createRun(tune, mulberry32(7));
  run.start();
  const gained = [];
  for (let i = 0; i < 6; i++) {
    gained.push(
      find(run.throwResult({ type: "ringed", prize: CUP }), "ringed").score,
    );
  }
  // step 0.5, cap 3: 1, 1.5, 2, 2.5, 3, 3 times 10 points.
  assert.deepEqual(gained, [10, 15, 20, 25, 30, 30]);
  assert.equal(run.state.score, 130);
  assert.equal(run.state.streak, 6);

  run.throwResult({ type: "miss" });
  assert.equal(run.state.streak, 0);
  assert.equal(
    find(run.throwResult({ type: "ringed", prize: CUP }), "ringed").score,
    10,
  );
});

test("a zombie reaching the stall costs a chance; three grabs end the run", () => {
  const run = createRun(TUNE, mulberry32(8));
  run.start();
  run.throwResult({ type: "ringed", prize: CUP }); // a score to check later
  const scoreBefore = run.state.score;

  const first = advanceUntil(run, "grab");
  const g1 = find(first, "grab");
  assert.equal(g1.chances, 2);
  assert.equal(g1.zombie.state, "grab");
  assert.equal(run.state.phase, "grabbed");
  assert.equal(run.canThrow(), false);

  // Grace ends: the street is cleared and the dead come again.
  advance(run, TUNE.grabGrace + 0.5);
  assert.equal(run.state.phase, "playing");
  assert.deepEqual(run.state.zombies, []);

  const second = advanceUntil(run, "grab");
  assert.equal(find(second, "grab").chances, 1);
  advance(run, TUNE.grabGrace + 0.5);

  const third = advanceUntil(run, "grab");
  const over = find(third, "over");
  assert.equal(find(third, "grab").chances, 0);
  assert.ok(over, "third grab should end the run");
  assert.equal(over.score, scoreBefore);
  assert.equal(run.state.phase, "over");
  assert.deepEqual(run.update(DT), []);
});

test("pushBack shoves zombies back and never below the spawn line", () => {
  const run = createRun(TUNE, mulberry32(9));
  run.start();
  advanceUntil(run, "spawn");
  advance(run, 40);
  const z = run.state.zombies[0];
  const before = z.z;
  const events = run.throwResult({ type: "ringed", prize: FIRECRACKER });
  assert.deepEqual(find(events, "effect"), {
    type: "effect",
    name: "pushBack",
  });
  assert.ok(Math.abs(z.z - (before - TUNE.effects.pushBack)) < 1e-9);

  // A zombie that has only just spawned cannot be pushed past the spawn line.
  const fresh = createRun(TUNE, mulberry32(10));
  fresh.start();
  advanceUntil(fresh, "spawn");
  fresh.throwResult({ type: "ringed", prize: FIRECRACKER });
  assert.equal(fresh.state.zombies[0].z, TUNE.zombies.spawnZ);
});

test("freeze stops every zombie, a miss does not lunge them, and they move again after the freeze", () => {
  const run = createRun(TUNE, mulberry32(11));
  run.start();
  advanceUntil(run, "spawn");
  advance(run, 10);
  const z = run.state.zombies[0];

  const ev = run.throwResult({ type: "ringed", prize: GONG });
  assert.deepEqual(find(ev, "effect"), { type: "effect", name: "freeze" });
  const frozenAt = z.z;

  advance(run, 2);
  assert.equal(z.z, frozenAt);
  assert.equal(z.state, "frozen");

  // A miss while frozen: no lunge.
  const missEvents = run.throwResult({ type: "miss" });
  assert.ok(has(missEvents, "miss"));
  assert.equal(has(missEvents, "lunge"), false);
  assert.equal(z.lunge, 0);
  advance(run, 0.5);
  assert.equal(z.z, frozenAt);

  // The freeze wears off and the zombie walks on.
  advance(run, TUNE.effects.freeze);
  assert.ok(z.z > frozenAt);
  assert.equal(z.state, "walk");
});

test("clearing all five rounds gives won, with the horde on the last round", () => {
  const run = createRun(TUNE, mulberry32(12));
  let events = run.start();
  const last = TUNE.rounds.length - 1;

  for (let round = 0; round <= last; round++) {
    assert.equal(run.state.round, round);
    assert.equal(run.state.horde, !!TUNE.rounds[round].horde);
    const target = TUNE.rounds[round].target;
    for (let i = 0; i < target; i++) {
      events = run.throwResult({ type: "ringed", prize: CUP });
    }
    if (round < last) {
      assert.ok(has(events, "roundClear"));
      advance(run, TUNE.breather + 0.1);
      assert.equal(run.state.phase, "playing");
    }
  }

  assert.equal(run.state.phase, "won");
  assert.equal(run.canThrow(), false);
  assert.equal(find(events, "won").score, run.state.score);
  assert.ok(run.state.score > 0);
  assert.deepEqual(run.update(DT), []);
});
