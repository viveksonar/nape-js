/**
 * Tiny DOM-overlay HUD. Renderer-agnostic — reads game state, writes to
 * a fixed set of element IDs in `index.html`. Replace with whatever UI
 * library you like (the rest of the template doesn't depend on this).
 */
export class Hud {
  constructor() {
    this.healthEl = document.getElementById("hud-health");
    this.coinsEl = document.getElementById("hud-coins");
    this.timeEl = document.getElementById("hud-time");
    this.overlayEl = document.getElementById("overlay");
    this.overlayTitle = document.getElementById("overlay-title");
    this.overlayMsg = document.getElementById("overlay-msg");
    this.overlayBtn = document.getElementById("overlay-btn");
  }

  update({ health, maxHealth, coins, totalCoins, elapsedSec }) {
    if (this.healthEl) {
      const filled = "♥ ".repeat(Math.max(0, health));
      const empty = "♡ ".repeat(Math.max(0, maxHealth - health));
      this.healthEl.textContent = (filled + empty).trim();
    }
    if (this.coinsEl) {
      this.coinsEl.textContent = `★ ${coins}/${totalCoins}`;
    }
    if (this.timeEl) {
      this.timeEl.textContent = `${elapsedSec.toFixed(1)}s`;
    }
  }

  showOverlay(title, msg, onRestart) {
    if (!this.overlayEl) return;
    this.overlayTitle.textContent = title;
    this.overlayMsg.textContent = msg;
    this.overlayEl.classList.add("show");
    if (this.overlayBtn) {
      this.overlayBtn.onclick = () => onRestart?.();
    }
  }

  hideOverlay() {
    this.overlayEl?.classList.remove("show");
  }
}
