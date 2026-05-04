/**
 * Keyboard input. Distinguishes "held" state from "pressed-this-frame"
 * edge events — the variable-height jump and the buffered jump both rely
 * on knowing the exact frame Space was pressed, not just that it's down.
 *
 * Call `consumeFrame()` at the end of each fixed update to clear edge
 * events.
 */
export function createInput() {
  const held = new Set();
  const pressedThisFrame = new Set();
  const releasedThisFrame = new Set();

  const KEY_MAP = {
    ArrowLeft: "left",
    KeyA: "left",
    ArrowRight: "right",
    KeyD: "right",
    ArrowUp: "up",
    KeyW: "up",
    ArrowDown: "down",
    KeyS: "down",
    Space: "jump",
    KeyX: "shoot",
    KeyJ: "shoot",
    KeyR: "restart",
  };

  function onDown(e) {
    const action = KEY_MAP[e.code];
    if (!action) return;
    if (!held.has(action)) pressedThisFrame.add(action);
    held.add(action);
    if (action === "jump" || action === "shoot") e.preventDefault();
  }

  function onUp(e) {
    const action = KEY_MAP[e.code];
    if (!action) return;
    if (held.has(action)) releasedThisFrame.add(action);
    held.delete(action);
  }

  window.addEventListener("keydown", onDown);
  window.addEventListener("keyup", onUp);

  return {
    isHeld(action) {
      return held.has(action);
    },
    wasPressed(action) {
      return pressedThisFrame.has(action);
    },
    wasReleased(action) {
      return releasedThisFrame.has(action);
    },
    consumeFrame() {
      pressedThisFrame.clear();
      releasedThisFrame.clear();
    },
    destroy() {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    },
  };
}
