// Pointer and keyboard input → yaw and charge for one throw. DOM only, no THREE.
// Mouse and Space: yaw follows the pointer's x; a hold charges on a ping-pong meter; release throws.
// Touch: same hold-to-charge meter; dragging sideways turns the aim from where it was (the thumb
// can rest anywhere), release throws. A flick was tried first: its strength could not be previewed.

const DEG = Math.PI / 180;
// Screen widths of sideways drag that sweep the aim from one limit to the other.
const DRAG_SPAN = 0.8;

export function createAim(element, tune) {
  const T = tune.throw;
  const state = { yaw: 0, charge: 0, holding: false, touch: false };
  let enabled = true;
  let source = null; // "mouse" | "key" | "touch" while a hold is active
  let touchId = null;
  let holdT = 0; // seconds the mouse or Space hold has run
  let dragX = 0; // where the touch started, and the aim it started from
  let dragYaw = 0;

  // Pointer x relative to the centre of the element; ±half width is ±yawMaxDeg.
  function yawFromX(clientX) {
    const r = element.getBoundingClientRect();
    const half = r.width / 2 || 1;
    const u = Math.min(1, Math.max(-1, (clientX - (r.left + half)) / half));
    return u * T.yawMaxDeg * DEG;
  }

  // 0 → 1 → 0 over one chargePeriod.
  let period = T.chargePeriod; // each round sets its own (setPeriod)
  const meterAt = (t) => 1 - Math.abs(2 * ((t / period) % 1) - 1);

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
      holdT = 0;
      dragX = e.clientX;
      dragYaw = state.yaw;
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
      const w = element.getBoundingClientRect().width || 1;
      const max = T.yawMaxDeg * DEG;
      const turn = ((e.clientX - dragX) / (w * DRAG_SPAN)) * 2 * max;
      state.yaw = Math.min(max, Math.max(-max, dragYaw + turn));
    } else if (source !== "touch") {
      // Desktop: the pointer aims even when it is not held.
      state.yaw = yawFromX(e.clientX);
    }
  }

  function onPointerUp(e) {
    if (source === "touch") {
      if (e.pointerId !== touchId) return;
      release(state.charge, true); // the charge on screen, so the throw matches the preview
    } else if (source === "mouse" && e.button === 0) {
      release(state.charge, true); // the charge on screen, so the throw matches the preview
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
    release(state.charge, true); // the charge on screen, so the throw matches the preview
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
    setPeriod(seconds) {
      if (seconds > 0) period = seconds;
    },
    update(dt) {
      if (source) {
        holdT += dt;
        state.charge = meterAt(holdT);
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
