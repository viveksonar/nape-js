import { Vec2 } from "@newkrok/nape-js";

/**
 * Smooth-follow camera with bounds clamp and shake hook. Renderer reads
 * (cx, cy) each frame and offsets the world.
 */
export class Camera {
  constructor({ viewportW, viewportH, worldW, worldH, smoothing = 0.18 }) {
    this.viewportW = viewportW;
    this.viewportH = viewportH;
    this.worldW = worldW;
    this.worldH = worldH;
    this.smoothing = smoothing;
    this.x = 0;
    this.y = 0;
    this._shakeAmp = 0;
    this._shakeDecay = 0;
    this._shakeOffset = new Vec2(0, 0);
  }

  /** Snap camera onto target (used for restart / first frame). */
  snapTo(target) {
    this.x = this._clampX(target.x - this.viewportW / 2);
    this.y = this._clampY(target.y - this.viewportH / 2);
  }

  follow(target, dt) {
    const targetX = target.x - this.viewportW / 2;
    const targetY = target.y - this.viewportH / 2;
    // Lerp with a frame-rate-corrected factor: 1 - (1 - s)^(60·dt)
    const lerp = 1 - Math.pow(1 - this.smoothing, 60 * dt);
    this.x += (targetX - this.x) * lerp;
    this.y += (targetY - this.y) * lerp;
    this.x = this._clampX(this.x);
    this.y = this._clampY(this.y);

    // Shake decay
    if (this._shakeAmp > 0) {
      this._shakeAmp = Math.max(0, this._shakeAmp - this._shakeDecay * dt);
      this._shakeOffset = new Vec2(
        (Math.random() * 2 - 1) * this._shakeAmp,
        (Math.random() * 2 - 1) * this._shakeAmp,
      );
    } else {
      this._shakeOffset = new Vec2(0, 0);
    }
  }

  /** Trigger a screen-shake. amp = peak pixel amplitude, decayPerSec = how fast it fades. */
  shake(amp, decayPerSec = 60) {
    this._shakeAmp = Math.max(this._shakeAmp, amp);
    this._shakeDecay = decayPerSec;
  }

  /** Final screen-space camera position including shake. */
  renderX() {
    return Math.round(this.x + this._shakeOffset.x);
  }
  renderY() {
    return Math.round(this.y + this._shakeOffset.y);
  }

  _clampX(x) {
    return Math.max(0, Math.min(x, Math.max(0, this.worldW - this.viewportW)));
  }
  _clampY(y) {
    return Math.max(0, Math.min(y, Math.max(0, this.worldH - this.viewportH)));
  }
}
