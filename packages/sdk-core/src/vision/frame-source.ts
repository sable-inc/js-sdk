/**
 * FrameSource dispatcher.
 *
 * The public API lets customers choose what the agent sees via
 * `vision: { frameSource: { type: "wireframe" | "fn", ... } }`. This module
 * hides the strategy behind one entrypoint — `startFrameSource` — which
 * returns a stop function. The target canvas is passed in so the caller
 * (vision/index.ts) can hand the same canvas to `canvas.captureStream()`.
 *
 * Two built-in sources:
 *
 *   1. `{ type: "wireframe", rate, features: { includeImages } }`
 *      — Runs the Wireframe library against `document.body` at `rate` Hz.
 *        This is the default, tuned for low bandwidth + agent-readable
 *        structure. `includeImages: true` fetches cover photos/avatars/
 *        thumbnails via CORS and draws real pixels; otherwise the agent
 *        gets labelled placeholder boxes.
 *
 *   2. `{ type: "fn", rate, captureFn }`
 *      — The user supplies a function that returns a canvas or ImageBitmap
 *        on each tick. Useful for custom sources the DOM walker can't
 *        introspect: `<video>` elements, WebGL/3D scenes, off-screen canvases.
 *
 * Adding a new source (e.g. `{ type: "video" }`) is a matter of:
 *   - adding a variant in `types.ts`
 *   - adding a case here.
 */

import type { FrameSource } from "../types";
import { getWireframeCtor } from "./wireframe";

const DEFAULT_RATE_HZ = 2;

function intervalMs(rate: number | undefined): number {
  const r = typeof rate === "number" && rate > 0 ? rate : DEFAULT_RATE_HZ;
  return Math.max(1, Math.round(1000 / r));
}

/**
 * Resize `canvas` to match the current viewport if needed. Called on every
 * tick so window resizes are picked up live without a separate listener.
 */
function syncCanvasSize(canvas: HTMLCanvasElement): void {
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

/**
 * Start capturing frames from `source` into `canvas`. Returns a stop function
 * that halts the loop. Errors inside a single tick are logged and skipped —
 * one bad frame shouldn't kill vision for the rest of the session.
 */
export function startFrameSource(
  source: FrameSource,
  canvas: HTMLCanvasElement,
): () => void {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    console.warn("[Sable] frame source: 2d context unavailable");
    return () => {};
  }

  const delayMs = intervalMs(source.rate);

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    if (!inFlight) {
      inFlight = true;
      try {
        syncCanvasSize(canvas);
        if (source.type === "wireframe") {
          const includeImages = source.features?.includeImages === true;
          const Wireframe = getWireframeCtor();
          const wf = new Wireframe(document.body, { images: includeImages });
          const { canvas: src } = await wf.capture();
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
        } else if (source.type === "fn") {
          const frame = source.captureFn();
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          // Both HTMLCanvasElement and ImageBitmap are valid drawImage sources.
          ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
        }
      } catch (e) {
        console.warn("[Sable] frame source tick failed", e);
      } finally {
        inFlight = false;
      }
    }
    if (!stopped) {
      timer = setTimeout(tick, delayMs);
    }
  };

  void tick();

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
