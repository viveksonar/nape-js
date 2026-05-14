/**
 * Shared rendering helpers for nape-js demo pages.
 *
 * Provides body/constraint/grid drawing and a global error overlay
 * that surfaces uncaught errors on mobile (where devtools aren't handy).
 */
import { BODY_COLORS_CSS, bodyColorCSS } from "./renderers/shared-colors.js";

// =========================================================================
// Color palette (re-exported for backward compatibility)
// =========================================================================

export const COLORS = BODY_COLORS_CSS;

export function bodyColor(body) {
  return bodyColorCSS(body);
}

// =========================================================================
// Drawing helpers
// =========================================================================

/**
 * Draw a single physics body onto a 2D canvas context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {*} body  — nape-js Body instance
 * @param {boolean} [showOutlines=true] — when false, uses solid dark fills only
 */
export function drawBody(ctx, body, showOutlines = true) {
  const px = body.position.x;
  const py = body.position.y;
  const rot = body.rotation;

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(rot);

  const c = bodyColor(body);
  const defaultColor = showOutlines
    ? c
    : { fill: c.fill, stroke: null };

  for (const shape of body.shapes) {
    // Per-shape overrides for fluid and sensor shapes
    let { fill, stroke } = defaultColor;
    if (shape.fluidEnabled) {
      fill = "rgba(30,144,255,0.25)";
      stroke = showOutlines ? "rgba(100,200,255,0.6)" : null;
    } else if (shape.sensorEnabled) {
      fill = showOutlines ? "rgba(88,166,255,0.06)" : "rgba(88,166,255,0.03)";
      stroke = showOutlines ? "rgba(88,166,255,0.3)" : null;
    }

    if (shape.isCircle()) {
      const r = shape.castCircle.radius;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(r, 0);
        ctx.strokeStyle = stroke + "55";
        ctx.stroke();
      }
    } else if (shape.isCapsule()) {
      const cap = shape.castCapsule;
      const hl = cap.halfLength;
      const r = cap.radius;
      ctx.beginPath();
      // Top edge
      ctx.moveTo(-hl, -r);
      ctx.lineTo(hl, -r);
      // Right semicircle
      ctx.arc(hl, 0, r, -Math.PI / 2, Math.PI / 2);
      // Bottom edge
      ctx.lineTo(-hl, r);
      // Left semicircle
      ctx.arc(-hl, 0, r, Math.PI / 2, -Math.PI / 2);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        // Spine indicator
        ctx.beginPath();
        ctx.moveTo(-hl, 0);
        ctx.lineTo(hl, 0);
        ctx.strokeStyle = stroke + "55";
        ctx.stroke();
      }
    } else if (shape.isPolygon()) {
      const verts = shape.castPolygon.localVerts;
      const len = verts.length;
      if (len < 3) continue;

      ctx.beginPath();
      const v0 = verts.at(0);
      ctx.moveTo(v0.x, v0.y);
      for (let i = 1; i < len; i++) {
        const v = verts.at(i);
        ctx.lineTo(v.x, v.y);
      }
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
  }

  ctx.restore();
}

/**
 * Draw constraint lines between connected bodies.
 * @param {CanvasRenderingContext2D} ctx
 * @param {*} space — nape-js Space instance
 */
export function drawConstraints(ctx, space) {
  try {
    const world = space.world;
    const rawConstraints = space.constraints;
    const cLen = rawConstraints.length;
    for (let i = 0; i < cLen; i++) {
      const c = rawConstraints.at(i);
      if (c.body1 != null && c.body2 != null) {
        try {
          const b1 = c.body1;
          const b2 = c.body2;
          // Skip joints anchored to space.world — its position is the
          // world origin (0,0), so the line would run from each body
          // off to a meaningless point in the top-left. Common case:
          // AngleJoint(space.world, body, ...) used to spring a body's
          // orientation toward a fixed world angle.
          if (!b1 || !b2 || b1 === world || b2 === world) continue;
          ctx.beginPath();
          ctx.moveTo(b1.position.x, b1.position.y);
          ctx.lineTo(b2.position.x, b2.position.y);
          ctx.strokeStyle = "#d2992233";
          ctx.lineWidth = 1;
          ctx.stroke();
        } catch (_) {}
      }
    }
  } catch (_) {}
}

/**
 * Draw a subtle background grid.
 * When camX/camY are provided, tiles the grid to cover the visible viewport
 * so the grid scrolls naturally with the camera.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} W — viewport width
 * @param {number} H — viewport height
 * @param {number} [camX=0] — camera X offset (world coords of viewport top-left)
 * @param {number} [camY=0] — camera Y offset (world coords of viewport top-left)
 */
export function drawGrid(ctx, W, H, camX = 0, camY = 0) {
  const step = 50;
  ctx.strokeStyle = "#1a2030";
  ctx.lineWidth = 0.5;
  // Compute world-space range visible in the viewport
  const startX = Math.floor(camX / step) * step;
  const startY = Math.floor(camY / step) * step;
  const endX = camX + W;
  const endY = camY + H;
  for (let x = startX; x <= endX; x += step) {
    ctx.beginPath(); ctx.moveTo(x, startY); ctx.lineTo(x, endY); ctx.stroke();
  }
  for (let y = startY; y <= endY; y += step) {
    ctx.beginPath(); ctx.moveTo(startX, y); ctx.lineTo(endX, y); ctx.stroke();
  }
}

// =========================================================================
// Error overlay (for mobile debugging)
// =========================================================================

/**
 * Install a global error overlay that captures uncaught errors and
 * unhandled promise rejections, displaying them in a fixed red panel.
 * Also shows the library version in the bottom-left corner.
 * Call once at page load.
 * @param {string} [version] — nape-js version string to display
 */
export function installErrorOverlay(version) {
  // --- Error overlay (hidden until an error occurs) ---
  const el = document.createElement("div");
  el.id = "error-overlay";
  el.style.cssText = [
    "display:none",
    "position:fixed",
    "bottom:0",
    "left:0",
    "right:0",
    "max-height:40vh",
    "overflow-y:auto",
    "background:rgba(30,0,0,0.92)",
    "color:#f85149",
    "font:12px/1.5 monospace",
    "padding:12px 16px",
    "z-index:99999",
    "border-top:2px solid #f85149",
    "white-space:pre-wrap",
    "word-break:break-word",
    "user-select:text",
  ].join(";");
  document.body.appendChild(el);

  // -- Top bar: Copy + Close buttons --
  const topBar = document.createElement("div");
  topBar.style.cssText =
    "display:flex;justify-content:flex-end;gap:8px;margin-bottom:4px";
  el.appendChild(topBar);

  const copyBtn = document.createElement("button");
  copyBtn.textContent = "\u2398 Copy";
  copyBtn.style.cssText =
    "background:none;border:1px solid #f8514966;border-radius:4px;color:#f85149;font:11px monospace;padding:2px 8px;cursor:pointer";
  copyBtn.addEventListener("click", () => {
    const text = log.innerText;
    navigator.clipboard.writeText(text).then(
      () => { copyBtn.textContent = "\u2713 Copied!"; setTimeout(() => { copyBtn.textContent = "\u2398 Copy"; }, 1500); },
      () => {
        // Fallback for browsers without clipboard API
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        copyBtn.textContent = "\u2713 Copied!";
        setTimeout(() => { copyBtn.textContent = "\u2398 Copy"; }, 1500);
      },
    );
  });
  topBar.appendChild(copyBtn);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "\u2715";
  closeBtn.style.cssText =
    "background:none;border:none;color:#f85149;font-size:18px;cursor:pointer;padding:0 2px";
  closeBtn.addEventListener("click", () => { el.style.display = "none"; });
  topBar.appendChild(closeBtn);

  const log = document.createElement("div");
  el.appendChild(log);

  function show(msg) {
    const line = document.createElement("div");
    line.style.borderBottom = "1px solid #f8514933";
    line.style.padding = "4px 0";
    line.textContent = msg;
    log.appendChild(line);
    el.style.display = "block";
    el.scrollTop = el.scrollHeight;
  }

  window.addEventListener("error", (e) => {
    const loc = e.filename ? ` (${e.filename.split("/").pop()}:${e.lineno})` : "";
    show(`[Error]${loc} ${e.message}`);
  });

  window.addEventListener("unhandledrejection", (e) => {
    const msg = e.reason?.stack || e.reason?.message || String(e.reason);
    show(`[Promise] ${msg}`);
  });
}
