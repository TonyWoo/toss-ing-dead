// Zombie models, animation and the on-screen life of each zombie. The rules own the
// logical position (x, z) and the state; this module only draws them. Each zombie gets
// its own mixer and cloned materials, because the fade and the frozen tint are per zombie.
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

const DIR = "assets/zombies/";
// romero.glb (5.7 MB, six 2048 px maps) never finished loading on an iPhone (2026-11-18): only ~2 MB models.
const CHARACTERS = ["girl.glb", "cop.glb", "soldier.glb"];
const CLIPS = {
  walk: "clip_walk.glb",
  idle: "clip_idle.glb",
  attack: "clip_attack.glb",
  scream: "clip_scream.glb",
};
const HEIGHT = 1.75; // metres
const HEIGHT_JITTER = 0.05; // ±5 % so the crowd does not look cloned
const RETRIES = 2; // extra attempts per file, 3 tries in total
const CROSSFADE = 0.2; // seconds between clips
const FADE_IN = 0.6; // seconds from fog to fully opaque
const FADE_OUT = 0.5; // seconds to vanish after leaving the list
const SINK = 0.3; // metres a leaving zombie sinks into the wet street
const POS_RATE = 14; // 1/s: how fast the drawn position catches up with the rules; high enough to read a lurch
const SMOOTH_RATE = 8; // 1/s: how fast animation speed, lean and tint follow their targets
const SPEED_RATE = 6; // 1/s: smoothing for the observed walking speed
const MAX_OBS_SPEED = 3; // m/s: bigger jumps (spawns, resets) are not walking, ignore them
const MIN_TS = 0.6; // walk clip speed range, so feet never look frozen or frantic
const MAX_TS = 1.8;
const LUNGE_TS = 2.2; // walk clip speed while lurching
const LUNGE_LEAN = 0.22; // radians the body tips forward on a lurch (+Z is forward)
const FROZEN_COLOR = 0x3a6fb0; // bluish ice tint
const FROZEN_AMOUNT = 0.5; // how much of it is mixed into emissive when frozen

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Same id always gets the same character; numbers use id % 3 directly.
function charIndex(id) {
  if (typeof id === "number")
    return Math.abs(Math.trunc(id)) % CHARACTERS.length;
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % CHARACTERS.length;
}

// Keep only the rotations and Hips.position. For the walk, remove the root travel so the
// zombie walks in place (the rules move it), and remember how fast it travelled.
function prepareClip(clip, name, travel) {
  clip.name = name;
  clip.tracks = clip.tracks.filter(
    (t) => t.name.endsWith(".quaternion") || t.name === "Hips.position",
  );
  clip.userData = { speed: 0 };
  const hips = clip.tracks.find((t) => t.name === "Hips.position");
  if (hips && travel) {
    const v = hips.values,
      n = hips.times.length,
      t0 = hips.times[0];
    const dur = hips.times[n - 1] - t0 || 1;
    const dx = v[(n - 1) * 3] - v[0],
      dz = v[(n - 1) * 3 + 2] - v[2];
    clip.userData.speed = Math.hypot(dx, dz) / dur; // in model units/s
    for (let i = 0; i < n; i++) {
      const k = (hips.times[i] - t0) / dur;
      v[i * 3] -= dx * k;
      v[i * 3 + 2] -= dz * k;
    }
  }
  clip.resetDuration();
  return clip;
}

// Phones cannot hold the 2048 px maps of several characters; shrink them like the sister game does.
function shrinkTextures(root, maxSize) {
  if (!maxSize) return;
  const done = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material])
      for (const key of [
        "map",
        "normalMap",
        "roughnessMap",
        "metalnessMap",
        "aoMap",
        "emissiveMap",
      ]) {
        const tex = m[key];
        const img = tex && tex.image;
        if (!img || done.has(tex) || !(img.width > maxSize)) continue;
        done.add(tex);
        const k = maxSize / Math.max(img.width, img.height);
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        if (typeof img.close === "function") img.close();
        tex.image = c;
        tex.needsUpdate = true;
      }
  });
}

export async function createZombies(
  THREE,
  scene,
  baseUrl,
  { maxTexture = 0, onWarning = () => {} } = {},
) {
  const loader = new GLTFLoader();
  const assetUrl = (file) => baseUrl + DIR + file;
  const frozenColor = new THREE.Color(FROZEN_COLOR);
  const recs = new Map(); // id -> zombie record

  // Try a file up to RETRIES more times; a flaky network often recovers within a second.
  async function loadGltf(file) {
    let lastError = null;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      try {
        return await loader.loadAsync(assetUrl(file));
      } catch (err) {
        lastError = err;
        if (attempt < RETRIES)
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    throw new Error(
      `Zombie asset failed to load: ${file} (${lastError?.message ?? lastError})`,
    );
  }

  async function loadCharacter(file) {
    const gltf = await loadGltf(file);
    const scene = gltf.scene;
    shrinkTextures(scene, maxTexture);
    scene.updateMatrixWorld(true); // measure the model as it sits in the file
    const box = new THREE.Box3().setFromObject(scene);
    const height = box.max.y - box.min.y || 1;
    // Mixamo rigs can be in centimetres: the clip's Hips travel is in the parent's units,
    // so remember the parent's world scale to convert it to metres later.
    const hips = scene.getObjectByName("Hips");
    const rigScale = hips?.parent
      ? hips.parent.getWorldScale(new THREE.Vector3()).x
      : 1;
    return { scene, height, rigScale };
  }

  async function loadClips() {
    const out = {};
    const entries = Object.entries(CLIPS);
    const gltfs = await Promise.all(entries.map(([, file]) => loadGltf(file)));
    entries.forEach(([name, file], i) => {
      const clip = gltfs[i].animations[0];
      if (!clip) throw new Error(`Zombie asset has no animation: ${file}`);
      out[name] = prepareClip(clip, name, name === "walk");
    });
    return out;
  }

  // One character that fails is skipped (and reported); only losing all of them is fatal.
  const [settled, clips] = await Promise.all([
    Promise.allSettled(CHARACTERS.map(loadCharacter)),
    loadClips(),
  ]);
  const characters = [];
  for (const r of settled)
    if (r.status === "fulfilled") characters.push(r.value);
    else onWarning(r.reason);
  if (!characters.length) throw settled[0].reason;

  // Crossfade to a named clip; the walk action keeps its timeScale across switches.
  function play(rec, name) {
    const next = rec.actions[name];
    if (rec.current === next) return;
    const prev = rec.current;
    next.reset().play();
    if (prev) next.crossFadeFrom(prev, CROSSFADE, false);
    else next.fadeIn(CROSSFADE);
    rec.current = next;
  }

  function spawn(item) {
    const tpl = characters[charIndex(item.id) % characters.length];
    const model = clone(tpl.scene);
    // The pivot carries the lunge lean, so the model keeps its own transform.
    const pivot = new THREE.Group();
    pivot.add(model);
    const root = new THREE.Group();
    root.add(pivot);
    const s =
      (HEIGHT * (1 + (Math.random() * 2 - 1) * HEIGHT_JITTER)) / tpl.height;
    root.scale.setScalar(s);
    root.position.set(item.x, 0, item.z);

    // Clone materials per zombie: opacity and the frozen tint must not leak to the others.
    const mats = [];
    const own = (m) => {
      const c = m.clone();
      c.transparent = true; // needed while fading in and out
      // the street is dark and the dead come from the fog: a faint self-light keeps them readable
      if (c.emissive) {
        if (c.map && !c.emissiveMap) c.emissiveMap = c.map;
        c.emissive.setRGB(0.62, 0.58, 0.72);
      }
      mats.push({ m: c, base: c.emissive ? c.emissive.clone() : null });
      return c;
    };
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      // Skinned bounds are not updated per frame, so culling would make zombies pop out.
      if (o.isSkinnedMesh) o.frustumCulled = false;
      o.material = Array.isArray(o.material)
        ? o.material.map(own)
        : own(o.material);
    });

    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    for (const [name, clip] of Object.entries(clips)) {
      const action = mixer.clipAction(clip, model);
      if (name === "attack") {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true; // hold the last pose until the scream takes over
      }
      actions[name] = action;
    }

    const rec = {
      id: item.id,
      root,
      pivot,
      model,
      mixer,
      actions,
      mats,
      current: null,
      x: item.x,
      z: item.z,
      tx: item.x,
      tz: item.z,
      logicalZ: item.z,
      // m/s the walk clip covers on screen at timeScale 1
      walkSpeed: clips.walk.userData.speed * s * tpl.rigScale,
      speed: 0,
      ts: 1,
      lean: 0,
      tint: 0,
      opacity: 0,
      leaving: false,
      grabbed: false,
      state: item.state || "walk",
    };
    // "attack" plays once, then the zombie screams for as long as it holds the player.
    mixer.addEventListener("finished", (e) => {
      if (e.action === actions.attack && rec.state === "grab")
        play(rec, "scream");
    });
    scene.add(root);
    recs.set(item.id, rec);
    return rec;
  }

  function applyState(rec, step) {
    const k = Math.min(1, step * SMOOTH_RATE);
    let wantTs = 1;
    let wantLean = 0;
    let wantTint = 0;
    switch (rec.state) {
      case "lunge":
        play(rec, "walk");
        wantTs = LUNGE_TS;
        wantLean = LUNGE_LEAN;
        break;
      case "frozen":
        play(rec, "idle");
        wantTint = 1;
        break;
      case "flinch":
        play(rec, "idle");
        break;
      case "grab":
        if (!rec.grabbed) {
          rec.grabbed = true;
          play(rec, "attack");
        }
        break;
      default: // walk
        play(rec, "walk");
        wantTs =
          rec.walkSpeed > 0
            ? clamp(rec.speed / rec.walkSpeed, MIN_TS, MAX_TS)
            : 1;
    }
    rec.ts += (wantTs - rec.ts) * k;
    rec.actions.walk.timeScale = rec.ts;
    rec.lean += (wantLean - rec.lean) * k;
    rec.pivot.rotation.x = rec.lean;
    rec.tint += (wantTint - rec.tint) * k;
    for (const { m, base } of rec.mats) {
      if (base)
        m.emissive.copy(base).lerp(frozenColor, FROZEN_AMOUNT * rec.tint);
    }
  }

  function disposeRec(rec) {
    rec.mixer.stopAllAction();
    rec.mixer.uncacheRoot(rec.model);
    scene.remove(rec.root);
    for (const { m } of rec.mats) m.dispose();
  }

  // list: [{ id, x, z, state }] from the rules; dt: seconds since the last call.
  function sync(list, dt) {
    const step = clamp(dt, 0, 0.25); // a long frame (tab switch) must not jump the animation
    const seen = new Set();
    for (const item of list) {
      seen.add(item.id);
      const rec = recs.get(item.id) ?? spawn(item);
      rec.leaving = false; // a zombie that comes back into the list stops fading out
      if (step > 0) {
        const v = clamp(
          (item.z - rec.logicalZ) / step,
          -MAX_OBS_SPEED,
          MAX_OBS_SPEED,
        );
        rec.speed += (v - rec.speed) * Math.min(1, step * SPEED_RATE);
      }
      rec.logicalZ = item.z;
      rec.tx = item.x;
      rec.tz = item.z;
      rec.state = item.state || "walk";
      applyState(rec, step);
    }
    for (const rec of recs.values()) if (!seen.has(rec.id)) rec.leaving = true;

    const k = 1 - Math.exp(-POS_RATE * step);
    for (const rec of recs.values()) {
      rec.x += (rec.tx - rec.x) * k;
      rec.z += (rec.tz - rec.z) * k;
      rec.opacity = clamp(
        rec.opacity + (rec.leaving ? -step / FADE_OUT : step / FADE_IN),
        0,
        1,
      );
      for (const { m } of rec.mats) m.opacity = rec.opacity;
      rec.root.position.set(
        rec.x,
        rec.leaving ? -SINK * (1 - rec.opacity) : 0,
        rec.z,
      );
      rec.root.lookAt(0, 0, 0); // +Z points at the stall
      rec.mixer.update(step);
    }
    for (const [id, rec] of recs) {
      if (rec.leaving && rec.opacity <= 0) {
        disposeRec(rec);
        recs.delete(id);
      }
    }
  }

  function clear() {
    for (const rec of recs.values()) disposeRec(rec);
    recs.clear();
  }

  return { sync, clear };
}
