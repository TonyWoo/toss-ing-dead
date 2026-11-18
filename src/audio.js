// WebAudio only: the rainy-night music loop, zombie voices (samples) and short synthesized
// sounds. Browsers block audio until a user gesture, so nothing sounds before unlock().
// Music and round settings given before unlock are remembered and applied once it starts.

const MASTER_GAIN = 0.9;
const MUSIC_GAIN = 0.45;
const RAIN_GAIN = 0.035; // very quiet: it is texture under the wok, not an effect
const MUSIC_OPEN_HZ = 16000; // lowpass fully open
const MUSIC_HORDE_START_HZ = 3000; // the horde round starts muffled and opens up over 4 s
const MUSIC_HORDE_RATE = 1.06; // a touch faster: subtle urgency

const ZOMBIE_SAMPLES = {
  growl: 4,
  moan: 4,
  grunt: 4,
  scream: 5,
  pain: 4,
  death: 3,
};

// Gong = inharmonic partials; each one decays a little differently, which is what makes it sound like metal.
const GONG_PARTIALS = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 2.76, gain: 0.35, decay: 0.6 },
  { ratio: 5.4, gain: 0.12, decay: 0.35 },
];
const CHIME_UP = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
const CHIME_FESTIVE = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];

const rand = (a, b) => a + Math.random() * (b - a);

export function createAudio(baseUrl) {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let musicFilter = null;
  let musicBuffer = null;
  let musicSource = null;
  let musicOn = false;
  let horde = false;
  let noise = null; // one shared white-noise buffer for whooshes, clacks and rain
  let loading = false;
  const samples = {}; // category -> [AudioBuffer]

  // ---- setup, once the context exists ----

  function makeNoise(seconds) {
    const buf = ctx.createBuffer(
      1,
      Math.floor(ctx.sampleRate * seconds),
      ctx.sampleRate,
    );
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function openFilter() {
    const f = musicFilter.frequency;
    const now = ctx.currentTime;
    f.cancelScheduledValues(now);
    f.setValueAtTime(MUSIC_HORDE_START_HZ, now);
    f.exponentialRampToValueAtTime(MUSIC_OPEN_HZ, now + 4);
  }

  function startRain() {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 200;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1200;
    const g = ctx.createGain();
    g.gain.value = RAIN_GAIN;
    src.connect(hp);
    hp.connect(lp);
    lp.connect(g);
    g.connect(master);
    src.start();
  }

  function build() {
    master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(ctx.destination);

    musicFilter = ctx.createBiquadFilter();
    musicFilter.type = "lowpass";
    musicFilter.frequency.value = horde ? MUSIC_HORDE_START_HZ : MUSIC_OPEN_HZ;
    musicGain = ctx.createGain();
    musicGain.gain.value = 0;
    musicFilter.connect(musicGain);
    musicGain.connect(master);
    if (horde) openFilter();

    noise = makeNoise(2);
    startRain();
  }

  // ---- loading (after unlock, so no network work before the player starts) ----

  // A missing or broken file just leaves that sound silent; it never throws.
  async function fetchBuffer(path) {
    try {
      const res = await fetch(baseUrl + path);
      if (!res.ok) return null;
      return await ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  async function loadSamples() {
    const jobs = [];
    for (const [category, count] of Object.entries(ZOMBIE_SAMPLES)) {
      samples[category] = [];
      for (let i = 1; i <= count; i++) {
        jobs.push(
          fetchBuffer(`assets/audio/zombie/${category}_${i}.wav`).then(
            (buf) => {
              if (buf) samples[category].push(buf);
            },
          ),
        );
      }
    }
    await Promise.all(jobs);
  }

  async function loadMusic() {
    musicBuffer = await fetchBuffer("assets/audio/rainy-wok-v1.mp3");
    refreshMusic();
  }

  // ---- music ----

  function refreshMusic() {
    if (!ctx || !musicBuffer) return;
    const now = ctx.currentTime;
    // The loop starts the first time music is wanted; later it only changes gain and speed.
    if (!musicSource && musicOn) {
      musicSource = ctx.createBufferSource();
      musicSource.buffer = musicBuffer;
      musicSource.loop = true;
      musicSource.connect(musicFilter);
      musicSource.start();
    }
    musicGain.gain.setTargetAtTime(musicOn ? MUSIC_GAIN : 0, now, 0.3);
    if (musicSource) {
      musicSource.playbackRate.setTargetAtTime(
        horde ? MUSIC_HORDE_RATE : 1,
        now,
        0.8,
      );
    }
  }

  // ---- synthesized voices ----

  // A tone with an exponential envelope: the pitch can glide from freq to glideTo over dur.
  function tone({
    freq,
    glideTo = 0,
    at = 0,
    dur = 0.5,
    gain = 0.2,
    type = "sine",
    decay = dur,
  }) {
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); // exponential ramps cannot start from zero
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + Math.max(dur, decay) + 0.05);
  }

  // A burst of the shared noise through one filter; used for air, clacks and crackles.
  function burst({
    at = 0,
    dur = 0.1,
    gain = 0.2,
    type = "bandpass",
    freq = 1000,
    sweepTo = 0,
    q = 1,
    attack = 0.005,
  }) {
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    // a random offset into the noise so repeats do not sound identical
    src.start(t, Math.random() * (noise.duration - dur), dur + 0.02);
  }

  function gong(base, gain, decay) {
    for (const p of GONG_PARTIALS) {
      tone({
        freq: base * p.ratio,
        dur: decay * p.decay,
        decay: decay * p.decay,
        gain: gain * p.gain,
      });
    }
  }

  // A recorded voice, picked at random from the given categories, pitch nudged for variety.
  function sample(categories, gain, rate) {
    const pool = categories.flatMap((c) => samples[c] || []);
    if (!pool.length) return;
    const src = ctx.createBufferSource();
    src.buffer = pool[Math.floor(Math.random() * pool.length)];
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(master);
    src.start();
  }

  const SOUNDS = {
    // soft whoosh: noise swept upward through a bandpass, like a ring cutting the air
    throw() {
      burst({
        dur: 0.35,
        gain: 0.18,
        freq: 500,
        sweepTo: 2200,
        q: 0.9,
        attack: 0.08,
      });
    },
    // bright bell: two partials a fifth apart, about 0.6 s of decay
    ringed() {
      tone({ freq: 1318.5, dur: 0.6, decay: 0.6, gain: 0.2 });
      tone({ freq: 1975.5, dur: 0.5, decay: 0.45, gain: 0.07 });
    },
    // woody clack: a quick pitch drop plus a tick of narrow noise
    rim() {
      tone({
        freq: 1400,
        glideTo: 600,
        dur: 0.05,
        decay: 0.07,
        gain: 0.22,
        type: "triangle",
      });
      burst({ dur: 0.02, gain: 0.2, freq: 2200, q: 3 });
    },
    // dull thud, then a few bamboo knocks rattling after it
    miss() {
      tone({ freq: 120, glideTo: 50, dur: 0.2, decay: 0.3, gain: 0.35 });
      for (let i = 0; i < 4; i++) {
        burst({
          at: 0.05 + i * 0.05 + rand(0, 0.02),
          dur: 0.03,
          gain: 0.07,
          freq: rand(1500, 2300),
          q: 4,
        });
      }
    },
    lunge() {
      sample(["growl", "moan"], 0.5, rand(0.9, 1.1));
    },
    // scream plus a low impact under it
    grab() {
      sample(["scream"], 0.7, rand(0.95, 1.05));
      tone({ freq: 70, glideTo: 35, dur: 0.4, decay: 0.45, gain: 0.45 });
      burst({ dur: 0.12, gain: 0.3, type: "lowpass", freq: 400, q: 0.7 });
    },
    roundClear() {
      gong(196, 0.12, 2);
      CHIME_UP.forEach((f, i) =>
        tone({
          freq: f,
          at: 0.25 + i * 0.11,
          dur: 0.9,
          decay: 0.9,
          gain: 0.12,
          type: "triangle",
        }),
      );
    },
    // firecracker: many short noise pops scattered over half a second
    effect() {
      for (let i = 0; i < 14; i++) {
        burst({
          at: rand(0, 0.6),
          dur: rand(0.02, 0.05),
          gain: rand(0.15, 0.35),
          type: "highpass",
          freq: rand(2000, 5000),
          q: 0.7,
        });
      }
    },
    // descending gong: the pitch sinks as it dies away
    over() {
      gong(261.6, 0.25, 2.5);
      tone({
        freq: 261.6,
        glideTo: 130,
        dur: 1.5,
        decay: 1.6,
        gain: 0.1,
        type: "triangle",
      });
    },
    won() {
      CHIME_FESTIVE.forEach((f, i) =>
        tone({
          freq: f,
          at: i * 0.09,
          dur: 1.0,
          decay: 1.0,
          gain: 0.13,
          type: "triangle",
        }),
      );
    },
  };

  return {
    // call from a click or key press; creates the context and starts loading
    unlock() {
      if (!ctx) {
        const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Ctor) return;
        try {
          ctx = new Ctor();
        } catch {
          return;
        }
        build();
      }
      ctx.resume?.().catch(() => {});
      if (!loading) {
        loading = true;
        loadSamples();
        loadMusic();
      }
    },

    play(name) {
      if (!ctx || ctx.state !== "running") return;
      SOUNDS[name]?.();
    },

    music(on) {
      musicOn = !!on;
      refreshMusic();
    },

    // round is accepted for per-round mixing later; today only the horde flag changes the music
    setRound(round, isHorde) {
      void round;
      const entering = !!isHorde && !horde;
      horde = !!isHorde;
      if (!ctx) return;
      if (entering) openFilter();
      else if (!horde)
        musicFilter.frequency.setTargetAtTime(
          MUSIC_OPEN_HZ,
          ctx.currentTime,
          0.5,
        );
      refreshMusic();
    },
  };
}
