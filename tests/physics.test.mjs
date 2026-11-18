import { test } from "node:test";
import assert from "node:assert/strict";
import {
  launchVelocity,
  createRing,
  stepRing,
  previewArc,
} from "../src/ring/physics.js";
import { TUNE } from "../src/tune.js";

const noRand = () => 0.5; // wobble factor 1, so the throw is exact
const ORIGIN = TUNE.throw.origin;
const DT = 1 / 60;

// Steps a ring until it stops flying; returns every event it produced.
function fly(ring, prizes = [], windX = 0) {
  const events = [];
  for (let i = 0; i < 60 * 10 && ring.state === "flying"; i++) {
    events.push(...stepRing(ring, DT, prizes, windX, TUNE));
  }
  return events;
}

const prizeAt = (x, z, extra = {}) => ({
  id: 1,
  x,
  z,
  r: 0.06,
  h: 0.11,
  alive: true,
  ...extra,
});

test("charge 0 and 1 land near the ranges given in tune", () => {
  for (const [charge, z] of [
    [0, -2.3],
    [1, -5.8],
  ]) {
    const ring = createRing(ORIGIN, launchVelocity(0, charge, TUNE, noRand));
    fly(ring);
    assert.equal(ring.state, "grounded");
    assert.ok(
      Math.abs(ring.pos.z - z) <= 0.6,
      `charge ${charge} landed at z=${ring.pos.z.toFixed(2)}, want about ${z}`,
    );
  }
});

test("a ring dropped over a prize centre is ringed, then settles on it", () => {
  const prize = prizeAt(0, -2);
  const ring = createRing([0, 0.6, -2], { x: 0, y: -0.5, z: 0 });
  const events = fly(ring, [prize]);
  assert.deepEqual(
    events.map((e) => e.type),
    ["ringed"],
  );
  assert.equal(events[0].prize, prize);
  assert.equal(ring.state, "ringed");

  // Settling emits nothing more and ends centred, resting just above the ground.
  const later = [];
  for (let i = 0; i < 60; i++)
    later.push(...stepRing(ring, DT, [prize], 0, TUNE));
  assert.equal(later.length, 0);
  assert.ok(Math.abs(ring.pos.x - prize.x) < 1e-9);
  assert.ok(Math.abs(ring.pos.z - prize.z) < 1e-9);
  assert.ok(Math.abs(ring.pos.y - 0.02) < 1e-6);
});

test("a ring dropped 0.18 + r from the centre hits the rim", () => {
  const prize = prizeAt(0, -2);
  const ring = createRing([0.18 + prize.r, 0.6, -2], { x: 0, y: -0.5, z: 0 });
  const events = fly(ring, [prize]);
  assert.equal(events[0].type, "rim");
  assert.equal(events[0].prize, prize);
  assert.equal(ring.bounces, 1);
  // Pushed outside the rim, so the bounce does not ring it; it ends on the ground.
  assert.deepEqual(
    events.map((e) => e.type),
    ["rim", "miss"],
  );
  assert.equal(ring.state, "grounded");
});

test("a ring dropped far from a prize misses", () => {
  const prize = prizeAt(0, -2);
  const ring = createRing([1, 0.6, -2], { x: 0, y: -0.5, z: 0 });
  const events = fly(ring, [prize]);
  assert.deepEqual(
    events.map((e) => e.type),
    ["miss"],
  );
  assert.equal(ring.state, "grounded");
});

test("a positive yaw lands at +X and a negative yaw at -X", () => {
  const right = createRing(ORIGIN, launchVelocity(0.3, 0.5, TUNE, noRand));
  fly(right);
  assert.ok(right.pos.x > 0.5, `x=${right.pos.x.toFixed(2)}`);

  const left = createRing(ORIGIN, launchVelocity(-0.3, 0.5, TUNE, noRand));
  fly(left);
  assert.ok(left.pos.x < -0.5, `x=${left.pos.x.toFixed(2)}`);
});

test("wind pushes the ring sideways", () => {
  const still = createRing(ORIGIN, launchVelocity(0, 0.5, TUNE, noRand));
  fly(still, [], 0);
  const windy = createRing(ORIGIN, launchVelocity(0, 0.5, TUNE, noRand));
  fly(windy, [], 0.5);
  assert.ok(windy.pos.x - still.pos.x > 0.1, "wind toward +X moved the ring");
});

test("previewArc returns the requested count and starts at the origin", () => {
  const v = launchVelocity(0, 0.5, TUNE, noRand);
  const pts = previewArc(ORIGIN, v, 0, TUNE, TUNE.throw.previewFraction);
  assert.equal(pts.length, 24);
  assert.deepEqual(pts[0], { x: ORIGIN[0], y: ORIGIN[1], z: ORIGIN[2] });

  const few = previewArc(ORIGIN, v, 0, TUNE, 0.5, 10);
  assert.equal(few.length, 10);
});

test("the full preview ends where the ring lands", () => {
  const v = launchVelocity(0.2, 0.7, TUNE, noRand);
  const ring = createRing(ORIGIN, v);
  fly(ring, [], 0.3);
  const last = previewArc(ORIGIN, v, 0.3, TUNE, 1).at(-1);
  assert.ok(Math.abs(last.x - ring.pos.x) < 0.02);
  assert.ok(Math.abs(last.z - ring.pos.z) < 0.02);
});
