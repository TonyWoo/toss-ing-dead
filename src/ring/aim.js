// Pointer and keyboard input → yaw and charge for one throw. DOM only, no THREE.
// Mouse and Space: yaw follows the pointer's x; a hold charges on a ping-pong meter; release throws.
// Touch: drag sets yaw; release throws with the upward flick speed measured over the last ~120 ms.

const DEG = Math.PI / 180;
// Flick speed is measured over this much recent movement.
const FLICK_WINDOW_MS = 120;
// Pointer history kept for the flick; a little longer than the window.
const TRAIL_MS = 250;
// Weaker flicks do not throw, so a slow drag does not waste a ring.
const FLICK_MIN = 0.15;

export function createAim(element, tune) {
  const T = tune.throw;
  const state = { yaw: 0, charge: 0, holding: false, touch: false };
  let enabled = true;
  let source = null; // "mouse" | "key" | "touch" while a hold is active
  let touchId = null;
  let holdT = 0; // seconds the mouse or Space hold has run
  let trail = []; // {t, y} of the touch pointer, for the flick

  const now = () => performance.now();

  // Pointer x relative to the centre of the element; ±half width is ±yawMaxDeg.
  function yawFromX(clientX) {
    const r = element.getBoundingClientRect();
    const half = r.width / 2 || 1;
    const u = Math.min(1, Math.max(-1, (clientX - (r.left + half)) / half));
    return u * T.yawMaxDeg * DEG;
  }

  // 0 → 1 → 0 over one chargePeriod.
  const meterAt = (t) => 1 - Math.abs(2 * ((t / T.chargePeriod) % 1) - 1);

  // Upward speed over the last FLICK_WINDOW_MS, in screen heights per second, divided by flickFull.
  function flickCharge(at) {
    const recent = trail.filter((p) => p.t >= at - FLICK_WINDOW_MS);
    if (recent.length < 2) return 0;
    const a = recent[0];
    const b = recent[recent.length - 1];
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) return 0;
    const screenH = window.innerHeight || 1;
    const perSec = (a.y - b.y) / screenH / dt;
    return Math.max(0, perSec / T.flickFull);
  }

  function cancel() {
    if (touchId !== null) {
      try {
        element.releasePointerCapture(touchId);
      } catch {
        // the pointer may already be gone
      }
    }
    source = null;
    touchId = null;
    trail = [];
    holdT = 0;
    state.holding = false;
    state.touch = false;
    state.charge = 0;
  }

  function release(charge, throws) {
    const yaw = state.yaw;
    cancel();
    if (throws && aim.onThrow) aim.onThrow(yaw, charge);
  }

  function onPointerDown(e) {
    if (!enabled || source) return;
    if (e.pointerType === "touch") {
      // Stop the browser from scrolling or zooming under the finger.
      e.preventDefault();
      source = "touch";
      touchId = e.pointerId;
      try {
        element.setPointerCapture(e.pointerId);
      } catch {
        // capture is a nicety; the window listeners still see the moves
      }
      trail = [{ t: now(), y: e.clientY }];
      state.yaw = yawFromX(e.clientX);
      state.holding = true;
      state.touch = true;
    } else if (e.button === 0) {
      source = "mouse";
      holdT = 0;
      state.yaw = yawFromX(e.clientX);
      state.holding = true;
      state.touch = false;
    }
  }

  function onPointerMove(e) {
    if (!enabled) return;
    if (e.pointerType === "touch") {
      if (source !== "touch" || e.pointerId !== touchId) return;
      e.preventDefault();
      state.yaw = yawFromX(e.clientX);
      const t = now();
      trail.push({ t, y: e.clientY });
      trail = trail.filter((p) => p.t >= t - TRAIL_MS);
    } else if (source !== "touch") {
      // Desktop: the pointer aims even when it is not held.
      state.yaw = yawFromX(e.clientX);
    }
  }

  function onPointerUp(e) {
    if (source === "touch") {
      if (e.pointerId !== touchId) return;
      const t = now();
      trail.push({ t, y: e.clientY });
      const raw = flickCharge(t);
      release(Math.min(1, raw), raw >= FLICK_MIN);
    } else if (source === "mouse" && e.button === 0) {
      release(meterAt(holdT), true);
    }
  }

  function onPointerCancel(e) {
    if (source === "touch" && e.pointerId !== touchId) return;
    if (source) cancel();
  }

  function onKeyDown(e) {
    if (e.code !== "Space" || !enabled) return;
    e.preventDefault(); // Space would scroll the page
    if (e.repeat || source) return;
    source = "key";
    holdT = 0;
    state.holding = true;
    state.touch = false;
  }

  function onKeyUp(e) {
    if (e.code !== "Space" || source !== "key") return;
    e.preventDefault();
    release(meterAt(holdT), true);
  }

  // A hold that loses the window (alt-tab) is dropped rather than thrown.
  function onBlur() {
    if (source) cancel();
  }

  const aim = {
    state,
    onThrow: null,
    get enabled() {
      return enabled;
    },
    set enabled(v) {
      enabled = !!v;
      if (!enabled) cancel();
    },
    update(dt) {
      if (source === "mouse" || source === "key") {
        holdT += dt;
        state.charge = meterAt(holdT);
      } else if (source === "touch") {
        // Live: the bar shows the flick strength as the finger moves.
        state.charge = Math.min(1, flickCharge(now()));
      }
    },
    destroy() {
      element.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      cancel();
    },
  };

  if (element.style) element.style.touchAction = "none";
  element.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerCancel);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  return aim;
}
