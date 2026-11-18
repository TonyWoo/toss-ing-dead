// One run of the ring-toss stall: rounds, chances, score, combo and the zombies'
// logical positions. Pure: no DOM, no THREE. Every mutating call returns the events it caused.

export function createRun(tune, rand = Math.random) {
  const Z = tune.zombies;
  const rounds = tune.rounds;
  // Lunge is stored as metres still to cover plus a rate, so update() can spread it over lungeTime.
  const lungeRate = Z.lunge / Z.lungeTime;
  let nextId = 1;

  const state = {
    phase: "title",
    round: 0,
    chances: tune.chances,
    score: 0,
    streak: 0,
    ringedThisRound: 0,
    target: rounds[0].target,
    windX: 0,
    zombies: [],
    frozen: 0,
    timer: 0,
    nextSpawn: 0,
    horde: false,
  };

  // A zombie's state is derived from its timers, so the renderer always sees the current action.
  // A grabbed zombie keeps "grab" until the grabbed phase clears it.
  function refreshState(z) {
    if (z.state === "grab") return;
    if (state.frozen > 0) z.state = "frozen";
    else if (z.lunge > 0) z.state = "lunge";
    else if (z.flinch > 0) z.state = "flinch";
    else z.state = "walk";
  }

  function windFor() {
    const v = tune.wind.byRound[state.round];
    // "|| 0" turns -0 into 0 so round 0 (no wind) reads cleanly.
    return (rand() < 0.5 ? -v : v) || 0;
  }

  function beginRound(round, events) {
    state.round = round;
    state.target = rounds[round].target;
    state.horde = !!rounds[round].horde;
    state.ringedThisRound = 0;
    state.windX = windFor();
    state.nextSpawn = 1; // the first zombie of a round comes after 1 s
    state.phase = "playing";
    events.push({ type: "roundStart", round, windX: state.windX });
  }

  // Random x across the lane, retried a few times so two zombies do not start on top of each other.
  function pickLaneX() {
    let x = 0;
    for (let tries = 0; tries < 8; tries++) {
      x = (rand() * 2 - 1) * Z.laneX;
      const crowded = state.zombies.some(
        (o) =>
          Math.abs(o.z - Z.spawnZ) < Z.spacing && Math.abs(o.x - x) < Z.spacing,
      );
      if (!crowded) break;
    }
    return x;
  }

  function spawn(events) {
    const zombie = {
      id: nextId++,
      x: pickLaneX(),
      z: Z.spawnZ,
      state: "walk",
      lunge: 0,
      lungeRate: 0,
      flinch: 0,
    };
    state.zombies.push(zombie);
    events.push({ type: "spawn", zombie });
  }

  function start() {
    state.chances = tune.chances;
    state.score = 0;
    state.streak = 0;
    state.zombies = [];
    state.frozen = 0;
    state.timer = 0;
    nextId = 1;
    const events = [];
    beginRound(0, events);
    return events;
  }

  function throwResult(result) {
    const events = [];
    if (state.phase !== "playing" || !result) return events;

    if (result.type === "ringed") {
      const prize = result.prize;
      const mult = Math.min(1 + tune.combo.step * state.streak, tune.combo.max);
      const gained = Math.round(prize.score * mult);
      state.score += gained;
      state.streak++;
      state.ringedThisRound++;

      // The zombie nearest the stall (largest z) is the one that stops and reacts.
      let nearest = null;
      for (const z of state.zombies)
        if (!nearest || z.z > nearest.z) nearest = z;
      if (nearest) {
        nearest.flinch = Z.flinch;
        refreshState(nearest);
      }
      events.push({
        type: "ringed",
        prize,
        score: gained,
        streak: state.streak,
      });

      if (prize.effect === "pushBack") {
        // Never shove a zombie back past where it spawns.
        for (const z of state.zombies)
          z.z = Math.max(Z.spawnZ, z.z - tune.effects.pushBack);
        events.push({ type: "effect", name: "pushBack" });
      } else if (prize.effect === "freeze") {
        state.frozen = tune.effects.freeze;
        for (const z of state.zombies) refreshState(z);
        events.push({ type: "effect", name: "freeze" });
      }

      if (state.ringedThisRound >= state.target) {
        events.push({ type: "roundClear", round: state.round });
        state.zombies = [];
        state.frozen = 0;
        if (state.round === rounds.length - 1) {
          state.phase = "won";
          events.push({ type: "won", score: state.score });
        } else {
          state.phase = "breather";
          state.timer = tune.breather;
        }
      }
    } else if (result.type === "miss") {
      state.streak = 0;
      events.push({ type: "miss" });
      // Frozen zombies do not lunge at all, so a miss during a freeze changes nothing on the street.
      if (state.frozen <= 0) {
        for (const z of state.zombies) {
          z.lunge = Z.lunge;
          z.lungeRate = lungeRate;
          refreshState(z);
        }
        events.push({ type: "lunge" });
      }
    }
    return events;
  }

  function update(dt) {
    const events = [];

    if (state.phase === "breather") {
      state.timer -= dt;
      if (state.timer <= 0) beginRound(state.round + 1, events);
      return events;
    }
    // While grabbed, nothing on the street moves; the grabbed zombie stays put until the grace ends.
    if (state.phase === "grabbed") {
      state.timer -= dt;
      if (state.timer <= 0) {
        state.zombies = [];
        state.phase = "playing";
        state.nextSpawn = 1;
      }
      return events;
    }
    if (state.phase !== "playing") return events;

    const round = rounds[state.round];

    // Movement: creep unless flinching or frozen; lunge unless frozen.
    for (const z of state.zombies) {
      if (state.frozen > 0 || z.state === "grab") continue;
      let step = 0;
      if (z.flinch <= 0) step += round.creep * dt;
      if (z.lunge > 0) {
        const s = Math.min(z.lunge, z.lungeRate * dt);
        step += s;
        z.lunge -= s;
        if (z.lunge < 1e-9) z.lunge = 0;
      }
      z.z += step;
    }

    state.frozen = Math.max(0, state.frozen - dt);
    for (const z of state.zombies) {
      z.flinch = Math.max(0, z.flinch - dt);
      refreshState(z);
    }

    // Spawning: the timer keeps running while the round is full, so the next zombie comes as soon as there is room.
    state.nextSpawn -= dt;
    if (state.nextSpawn <= 0 && state.zombies.length < round.alive) {
      spawn(events);
      state.nextSpawn = round.spawnEvery;
    }

    // Grab: only one per grabbed phase, so take the zombie closest to the stall.
    let hit = null;
    for (const z of state.zombies)
      if (z.z >= Z.grabZ && (!hit || z.z > hit.z)) hit = z;
    if (hit) {
      state.chances--;
      hit.state = "grab";
      hit.lunge = 0;
      events.push({ type: "grab", zombie: hit, chances: state.chances });
      if (state.chances <= 0) {
        state.phase = "over";
        events.push({ type: "over", score: state.score });
      } else {
        state.phase = "grabbed";
        state.timer = tune.grabGrace;
      }
    }
    return events;
  }

  function canThrow() {
    return state.phase === "playing";
  }

  return { state, start, throwResult, update, canThrow };
}
