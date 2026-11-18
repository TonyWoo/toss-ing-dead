// Pure ring physics: no THREE, no DOM. Every number comes from the `tune` argument (src/tune.js).
// Units: metres and seconds, y is up. A prize is a cylinder of radius r whose top is at height h.

// Largest integration step. Short enough that a fast ring cannot skip over a prize top.
const SUBSTEP = 1 / 240;
// Cap on the recorded preview flight, so a bad input cannot loop forever.
const MAX_PREVIEW_STEPS = 240 * 10;
// A ringed ring snaps sideways onto the prize in SNAP_TIME and slides down to REST_Y in SLIDE_TIME.
const SNAP_TIME = 0.1;
const SLIDE_TIME = 0.5;
const REST_Y = 0.02;
// A grounded ring lies just above the floor (its thickness is ignored).
const GROUND_Y = 0.01;
// Gap added when a rim hit pushes the ring out, so the next step does not hit the rim again.
const NUDGE = 0.005;
// Flight visuals: spin rate (rad/s) and the sideways lean that follows the velocity.
const SPIN_RATE = 9;
const TILT_GAIN = 0.03;
const TILT_MAX = 0.4;
const WOBBLE = 0.06;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};

// Launch velocity for a throw. charge 0..1 sets the speed; wobble keeps a perfect meter uncertain.
// Yaw 0 throws straight down -Z; positive yaw turns toward +X.
export function launchVelocity(yaw, charge, tune, rand = Math.random) {
  const c = clamp(charge, 0, 1);
  const { minSpeed, maxSpeed, pitchDeg, wobble } = tune.throw;
  const speed =
    (minSpeed + (maxSpeed - minSpeed) * c) * (1 + (rand() * 2 - 1) * wobble);
  const pitch = (pitchDeg * Math.PI) / 180;
  const horiz = speed * Math.cos(pitch);
  return {
    x: horiz * Math.sin(yaw),
    y: speed * Math.sin(pitch),
    z: -horiz * Math.cos(yaw),
  };
}

export function createRing(origin, velocity) {
  return {
    pos: { x: origin[0], y: origin[1], z: origin[2] },
    vel: { x: velocity.x, y: velocity.y, z: velocity.z },
    spin: 0,
    tilt: { x: 0, z: 0 },
    bounces: 0,
    state: "flying",
    prize: null, // the prize it ringed, set when state becomes "ringed"
    from: null, // where the ring was when it ringed, the start of the settle
    settleT: 0,
  };
}

// One semi-implicit Euler step, shared by the ring and the preview so the drawn arc is the real path.
function advance(pos, vel, h, windX, tune) {
  vel.x += windX * h;
  vel.y -= tune.ring.gravity * h;
  // Same as vel -= vel * drag * h, written as a scale so it is exact for any h.
  const k = 1 - tune.ring.drag * h;
  vel.x *= k;
  vel.y *= k;
  vel.z *= k;
  pos.x += vel.x * h;
  pos.y += vel.y * h;
  pos.z += vel.z * h;
}

// Advances one ring by dt seconds and returns the events it produced this step.
export function stepRing(ring, dt, prizes, windX, tune) {
  const events = [];
  if (!(dt > 0)) return events;
  if (ring.state === "ringed") {
    settle(ring, dt);
    return events;
  }
  if (ring.state !== "flying") return events;

  ring.spin += SPIN_RATE * dt;
  ring.tilt.x =
    clamp(-ring.vel.z * TILT_GAIN, -TILT_MAX, TILT_MAX) +
    WOBBLE * Math.sin(ring.spin * 2);
  ring.tilt.z =
    clamp(ring.vel.x * TILT_GAIN, -TILT_MAX, TILT_MAX) +
    WOBBLE * Math.cos(ring.spin * 2);

  // Substeps so no single step is longer than SUBSTEP (the -1e-9 keeps 1/60 at 4 steps, not 5).
  const n = Math.max(1, Math.ceil(dt / SUBSTEP - 1e-9));
  const h = dt / n;
  for (let i = 0; i < n && ring.state === "flying"; i++) {
    const prevY = ring.pos.y;
    advance(ring.pos, ring.vel, h, windX, tune);
    if (prizes) hitPrizes(ring, prevY, prizes, tune, events);
    if (ring.state === "flying" && ring.pos.y <= 0) land(ring, events);
  }
  return events;
}

// Checks every live prize for a downward crossing of its top during this substep.
function hitPrizes(ring, prevY, prizes, tune, events) {
  const { inner, outer, maxBounces } = tune.ring;
  for (const prize of prizes) {
    if (!prize.alive) continue;
    // Only a downward crossing of the top counts; a ring passing a prize's side does nothing.
    if (!(prevY > prize.h && ring.pos.y <= prize.h)) continue;
    const d = Math.hypot(ring.pos.x - prize.x, ring.pos.z - prize.z);
    if (d <= inner - prize.r) {
      ring.state = "ringed";
      ring.prize = prize;
      ring.from = { x: ring.pos.x, y: ring.pos.y, z: ring.pos.z };
      ring.settleT = 0;
      ring.vel.x = 0;
      ring.vel.y = 0;
      ring.vel.z = 0;
      ring.tilt.x = 0;
      ring.tilt.z = 0;
      events.push({ type: "ringed", prize });
      return;
    }
    // after maxBounces rim hits the ring stops catching rims and just drops
    if (ring.bounces >= maxBounces) continue;
    if (d < outer + prize.r) {
      rimHit(ring, prize, tune);
      events.push({ type: "rim", prize });
    }
  }
}

// The ring landed on the rim: reflect the part of its velocity that points at the centre,
// damp it, lift it, and push it just outside the rim.
function rimHit(ring, prize, tune) {
  const { outer, rimBounce, rimLift } = tune.ring;
  const dx = ring.pos.x - prize.x;
  const dz = ring.pos.z - prize.z;
  const d = Math.hypot(dx, dz);
  // Outward unit normal from the prize centre. Dead centre (only if r >= inner) has no
  // direction, so fall back to the opposite of the travel direction.
  let nx = 1;
  let nz = 0;
  if (d > 1e-9) {
    nx = dx / d;
    nz = dz / d;
  } else {
    const s = Math.hypot(ring.vel.x, ring.vel.z);
    if (s > 1e-9) {
      nx = -ring.vel.x / s;
      nz = -ring.vel.z / s;
    }
  }
  // vIn > 0 when the ring moves toward the centre; reflecting that part sends it back out.
  const vIn = -(ring.vel.x * nx + ring.vel.z * nz);
  if (vIn > 0) {
    ring.vel.x += 2 * vIn * nx;
    ring.vel.z += 2 * vIn * nz;
  }
  ring.vel.x *= rimBounce;
  ring.vel.z *= rimBounce;
  ring.vel.y = rimLift;
  ring.bounces++;
  const reach = outer + prize.r + NUDGE;
  ring.pos.x = prize.x + nx * reach;
  ring.pos.z = prize.z + nz * reach;
}

function land(ring, events) {
  ring.pos.y = GROUND_Y;
  ring.vel.x = 0;
  ring.vel.y = 0;
  ring.vel.z = 0;
  ring.tilt.x = 0;
  ring.tilt.z = 0;
  ring.state = "grounded";
  events.push({ type: "miss", x: ring.pos.x, z: ring.pos.z });
}

// A ringed ring centres itself on the prize, then slides down to rest around it.
function settle(ring, dt) {
  if (!ring.prize || !ring.from) return;
  ring.settleT += dt;
  const a = smooth(ring.settleT / SNAP_TIME);
  const b = smooth(ring.settleT / SLIDE_TIME);
  ring.pos.x = lerp(ring.from.x, ring.prize.x, a);
  ring.pos.z = lerp(ring.from.z, ring.prize.z, a);
  ring.pos.y = lerp(ring.from.y, REST_Y, b);
}

// Flight path (no collisions) as `samples` points over the first `fraction` of the flight time.
// The first point is the origin; the last is at fraction * flight time.
export function previewArc(
  origin,
  velocity,
  windX,
  tune,
  fraction,
  samples = 24,
) {
  const count = Math.max(0, Math.floor(samples));
  if (count === 0) return [];
  const start = { x: origin[0], y: origin[1], z: origin[2] };
  const pos = { ...start };
  const vel = { x: velocity.x, y: velocity.y, z: velocity.z };
  const path = [{ t: 0, ...start }];
  let t = 0;
  while (pos.y > 0 && path.length < MAX_PREVIEW_STEPS) {
    const prev = { ...pos };
    advance(pos, vel, SUBSTEP, windX, tune);
    t += SUBSTEP;
    if (pos.y <= 0) {
      // Stop exactly on the ground by interpolating within the last step.
      const f = prev.y / (prev.y - pos.y);
      path.push({
        t: t - SUBSTEP + f * SUBSTEP,
        x: prev.x + (pos.x - prev.x) * f,
        y: 0,
        z: prev.z + (pos.z - prev.z) * f,
      });
    } else {
      path.push({ t, x: pos.x, y: pos.y, z: pos.z });
    }
  }

  const total = path[path.length - 1].t;
  const f = clamp(fraction, 0, 1);
  const out = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const tt = count === 1 ? 0 : (f * total * i) / (count - 1);
    while (j < path.length - 2 && path[j + 1].t < tt) j++;
    const a = path[j];
    const b = path[j + 1] ?? a;
    const span = b.t - a.t;
    const u = span > 0 ? clamp((tt - a.t) / span, 0, 1) : 0;
    out.push({
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
      z: a.z + (b.z - a.z) * u,
    });
  }
  return out;
}
