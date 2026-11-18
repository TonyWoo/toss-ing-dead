// Boot and frame loop: wires the pure rules and ring physics to the scene, the input and the HUD.
import * as THREE from "three";
import "./style.css";
import { TUNE } from "./tune.js";
import { createRun } from "./rules.js";
import {
  launchVelocity,
  createRing,
  stepRing,
  previewArc,
} from "./ring/physics.js";
import { createAim } from "./ring/aim.js";
import { createStage } from "./world/stage.js";
import { createPrizes, layoutField } from "./world/prizes.js";
import { createZombies } from "./world/zombies.js";
import { createStubZombies } from "./world/stubzombies.js";
import { createAudio } from "./audio.js";
import { createHud } from "./ui/hud.js";
import { t } from "./i18n/index.js";

const BASE = import.meta.env.BASE_URL || "/";
const canvas = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const scene = new THREE.Scene();
const stage = createStage(THREE, scene, renderer);
const camera = stage.camera;
const prizes = createPrizes(THREE, scene, TUNE);
const audio = createAudio(BASE);
const hud = createHud(document.getElementById("hud"), t);
const aim = createAim(canvas, TUNE);
const run = createRun(TUNE);
aim.enabled = false;

// Errors stay on screen: the game is tested on phones, where there is no console to read.
const errors = [];
function report(what) {
  const text = String((what && (what.message || what.reason)) || what);
  console.error(what);
  errors.push(text);
  window.__fatal = errors[0];
  hud.showError(errors.slice(-2).join(" | "));
}
window.addEventListener("error", (e) => report(e.error || e.message));
window.addEventListener("unhandledrejection", (e) =>
  report(e.reason || "unhandled rejection"),
);

// Zombies load while the title is up; 开档 waits for them, so no run has undrawn dead.
// If the models cannot load, box stand-ins take their place and the error is shown.
let zombies = null;
hud.setLoading(true);
createZombies(THREE, scene, BASE, {
  maxTexture: stage.quality === "low" ? 1024 : 0,
})
  .then((z) => (zombies = z))
  .catch((e) => {
    report(e);
    zombies = createStubZombies(THREE, scene);
  })
  .finally(() => hud.setLoading(false));

// ---------- rings ----------
const ringGeo = new THREE.TorusGeometry(
  (TUNE.ring.inner + TUNE.ring.outer) / 2,
  (TUNE.ring.outer - TUNE.ring.inner) / 2,
  10,
  40,
);
// bamboo with dark nodes and red tape bands: a plain ring would not show that it spins
function ringTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 16;
  const g = c.getContext("2d");
  g.fillStyle = "#c9a25c";
  g.fillRect(0, 0, 256, 16);
  for (let i = 0; i < 8; i++) {
    const x = i * 32;
    g.fillStyle = i % 2 ? "#5a3a1a" : "#b3261e"; // node, tape, node, tape...
    g.fillRect(x, 0, i % 2 ? 3 : 10, 16);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}
const ringMat = new THREE.MeshStandardMaterial({
  map: ringTexture(),
  roughness: 0.55,
  metalness: 0.0,
});
const TUBE = (TUNE.ring.outer - TUNE.ring.inner) / 2;
const MID = (TUNE.ring.inner + TUNE.ring.outer) / 2;
const flying = []; // { ring, mesh, age, fade, spin, spinRate }
const origin = TUNE.throw.origin;

function makeRingMesh() {
  const m = new THREE.Mesh(ringGeo, ringMat);
  m.castShadow = true;
  scene.add(m);
  return m;
}

// the ring waiting in the hand, in camera space so it moves with the view
const handRing = new THREE.Mesh(ringGeo, ringMat);
handRing.position.set(0.34, -0.34, -0.85);
handRing.rotation.set(0.9, 0.2, 0.35);
handRing.scale.setScalar(0.8);
camera.add(handRing);
scene.add(camera);

// aim preview: a row of small dots along the first part of the arc
const DOTS = 28;
const dotGeo = new THREE.SphereGeometry(0.009, 6, 4);
const dotMat = new THREE.MeshBasicMaterial({
  color: 0xfff1c9,
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
});
const dots = Array.from({ length: DOTS }, () => {
  const d = new THREE.Mesh(dotGeo, dotMat);
  d.visible = false;
  scene.add(d);
  return d;
});

// where the ring will come down (ignoring the small random wobble of a real throw)
const marker = new THREE.Mesh(
  new THREE.RingGeometry(TUNE.ring.inner, TUNE.ring.outer, 40),
  new THREE.MeshBasicMaterial({
    color: 0xffd27a,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    side: THREE.DoubleSide,
  }),
);
marker.rotation.x = -Math.PI / 2;
marker.visible = false;
scene.add(marker);

let cooldown = 0;
aim.onThrow = (yaw, charge) => {
  if (!run.canThrow() || cooldown > 0) return;
  cooldown = TUNE.ring.cooldown;
  const ring = createRing(origin, launchVelocity(yaw, charge, TUNE));
  const spinRate = TUNE.ring.spin * (Math.random() < 0.5 ? -1 : 1);
  flying.push({
    ring,
    mesh: makeRingMesh(),
    age: 0,
    fade: 0,
    spin: 0,
    spinRate,
  });
  audio.play("throw");
};

function aliveField() {
  return field.filter((p) => p.alive);
}

function updateRings(dt) {
  const list = aliveField();
  for (let i = flying.length - 1; i >= 0; i--) {
    const f = flying[i];
    f.age += dt;
    for (const e of stepRing(f.ring, dt, list, run.state.windX, TUNE)) {
      if (e.type === "ringed") {
        e.prize.alive = false;
        prizes.ringed(e.prize.id);
        audio.play("ringed");
        handle(run.throwResult({ type: "ringed", prize: e.prize }));
      } else if (e.type === "rim") {
        audio.play("rim");
      } else if (e.type === "miss") {
        audio.play("miss");
        handle(run.throwResult({ type: "miss" }));
      }
    }
    const { pos, tilt, state } = f.ring;
    // spins flat while flying; once down the spin dies away
    if (state !== "flying") f.spinRate *= Math.exp(-dt / TUNE.ring.spinStop);
    f.spin += f.spinRate * dt;
    // The torus is built in the XY plane: Z spins it in its own plane, then the small tilts,
    // then X lays it flat. (Spinning about Y instead stood it on edge and into the ground.)
    const tx = tilt?.x || 0;
    const tz = tilt?.z || 0;
    f.mesh.rotation.set(-Math.PI / 2 + tx, tz, f.spin);
    // keep the lowest point of a tilted ring above the ground (and its centre above the prize base)
    const lift = TUBE + MID * Math.sin(Math.min(1, Math.hypot(tx, tz)));
    f.mesh.position.set(pos.x, Math.max(pos.y, 0) + lift + 0.003, pos.z);
    if (state !== "flying") f.fade += dt;
    const gone =
      (state === "grounded" && f.fade > TUNE.ring.settle) ||
      (state === "ringed" && f.fade > 1.2) ||
      f.age > 8;
    if (gone) {
      scene.remove(f.mesh);
      flying.splice(i, 1);
    }
  }
}

function clearRings() {
  for (const f of flying) scene.remove(f.mesh);
  flying.length = 0;
}

function updatePreview() {
  const show = aim.state.holding && run.canThrow();
  if (show) {
    const v = launchVelocity(aim.state.yaw, aim.state.charge, TUNE, () => 0.5);
    const pts = previewArc(
      origin,
      v,
      run.state.windX,
      TUNE,
      TUNE.throw.previewFraction,
      DOTS,
    );
    dots.forEach((d, i) => {
      const p = pts[i];
      // points near the hand rise past the lens and would blot out the view
      d.visible = !!p && Math.hypot(p.x - origin[0], p.z - origin[2]) > 1.3;
      if (p) d.position.set(p.x, p.y, p.z);
    });
    const end = pts[pts.length - 1];
    marker.visible = !!end;
    if (end) marker.position.set(end.x, 0.012, end.z);
  } else {
    dots.forEach((d) => (d.visible = false));
    marker.visible = false;
  }
  handRing.visible = run.canThrow() && cooldown <= 0.15;
}

// ---------- the run ----------
let field = [];

function newField() {
  field = layoutField(TUNE, Math.random);
  prizes.setField(field);
}

function handle(events) {
  for (const e of events) {
    switch (e.type) {
      case "roundStart":
        newField();
        aim.setPeriod(TUNE.rounds[e.round].chargePeriod);
        stage.setWind(e.windX);
        audio.setRound(e.round, !!run.state.horde);
        hud.toast(run.state.horde ? "toast.horde" : "toast.round", {
          n: e.round + 1,
        });
        break;
      case "miss":
        break;
      case "lunge":
        audio.play("lunge");
        break;
      case "ringed":
        if (e.streak >= 2) hud.toast("toast.combo", { n: e.streak });
        break;
      case "effect":
        audio.play("effect");
        hud.toast(`toast.${e.name}`);
        break;
      case "grab":
        audio.play("grab");
        shake = 0.6;
        hud.toast("toast.grab", { n: e.chances });
        break;
      case "roundClear":
        audio.play("roundClear");
        hud.toast("toast.roundClear", { n: e.round + 1 });
        break;
      case "over":
        audio.play("over");
        aim.enabled = false;
        setTimeout(() => hud.showOver(e.score, start), 1400);
        break;
      case "won":
        audio.play("won");
        aim.enabled = false;
        setTimeout(() => hud.showWon(e.score, start), 1200);
        break;
    }
  }
}

function start() {
  audio.unlock();
  audio.music(true);
  hud.hideMenus();
  clearRings();
  if (zombies) zombies.clear();
  handle(run.start());
  // let the click that pressed the button finish before it can count as a throw
  setTimeout(() => (aim.enabled = true), 150);
}

// ---------- frame loop ----------
let shake = 0;
const camBase = camera.position.clone();
// yaw applied on top of the stage's downward look must not roll the horizon
camera.rotation.setFromQuaternion(camera.quaternion, "YXZ");
const camYaw0 = camera.rotation.y;
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const time = clock.elapsedTime;
  cooldown = Math.max(0, cooldown - dt);
  aim.update(dt);
  if (run.state.phase !== "title") handle(run.update(dt));
  updateRings(dt);
  updatePreview();
  prizes.update(dt, time);
  if (zombies) zombies.sync(run.state.zombies, dt);
  stage.update(dt, time);
  // a grab jolts the view; aim drifts the view slightly toward the throw
  shake = Math.max(0, shake - dt);
  camera.position.set(
    camBase.x + (Math.random() - 0.5) * shake * 0.12,
    camBase.y + (Math.random() - 0.5) * shake * 0.12,
    camBase.z,
  );
  camera.rotation.y +=
    (camYaw0 - aim.state.yaw * 0.25 - camera.rotation.y) * 0.1;
  hud.update(run.state, aim.state);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

hud.showTitle(start);
window.__G = {
  run,
  TUNE,
  aim,
  marker,
  THREE,
  field: () => field,
  rings: () => flying,
};
window.__ready = true;
requestAnimationFrame(frame);
