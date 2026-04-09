/**
 * DOM-state capture for `browser.get_dom_state`.
 *
 * The agent calls `browser.get_dom_state` when it needs a fresh snapshot of
 * the page before deciding on the next action. The response carries three
 * things:
 *
 *   - `screenshot_jpeg_b64` — a wireframe-rendered image of `document.body`
 *     (the field name is historical; the bytes are PNG — Northstar treats
 *     it as an opaque image and doesn't enforce the codec)
 *   - `elements` — the visible-element list produced by `visible-dom.js`,
 *     an agent-friendly structured summary of the interactive DOM
 *   - `viewport` + `url` — so the agent can reason about pixel coordinates
 *     and the current page identity
 *
 * `visible-dom.js` is shipped as a text asset and eval'd once on first use.
 * `settle()` is also here — it's a mutation-observer quiet-period wait used
 * by the `browser.settle` RPC to let animations/transitions finish before
 * the agent reads DOM state again.
 */

import visibleDomJs from "../assets/visible-dom.js.txt";
import { getWireframeCtor } from "../vision/wireframe";

let visibleDomFn: (() => unknown) | null = null;

function getVisibleDomFn(): () => unknown {
  if (!visibleDomFn) {
    // The text starts with `() => { ... }` — wrap in parens so eval
    // returns the function expression.
    visibleDomFn = (0, eval)(`(${visibleDomJs})`) as () => unknown;
  }
  return visibleDomFn;
}

export interface DomStateResponse {
  screenshot_jpeg_b64: string;
  elements: unknown;
  viewport: { width: number; height: number };
  url: string;
}

export async function captureDomState(): Promise<DomStateResponse> {
  const elements = getVisibleDomFn()();

  const Wireframe = getWireframeCtor();
  const wf = new Wireframe(document.body, {});
  const dataUrl = await wf.toDataURL();
  // Strip the `data:image/png;base64,` prefix.
  const b64 = dataUrl.replace(/^data:[^,]+,/, "");

  return {
    screenshot_jpeg_b64: b64,
    elements,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    url: window.location.href,
  };
}

/**
 * Mutation-observer quiet-period wait. Mirrors `visible_dom.py`'s settle —
 * return as soon as the DOM has been quiet for `QUIET_MS`, or after
 * `MAX_MS`, whichever comes first. Bookended by two double-rAFs so any
 * in-flight layout/paint work gets flushed before and after the wait.
 */
export async function settle(): Promise<void> {
  const raf2 = (): Promise<void> =>
    new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    );
  await raf2();
  await new Promise<void>((resolve) => {
    const QUIET_MS = 30;
    const MAX_MS = 30;
    const start = performance.now();
    let lastMut = performance.now();
    const obs = new MutationObserver(() => {
      lastMut = performance.now();
    });
    obs.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    const tick = (): void => {
      const now = performance.now();
      if (now - lastMut >= QUIET_MS) {
        obs.disconnect();
        resolve();
        return;
      }
      if (now - start >= MAX_MS) {
        obs.disconnect();
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await raf2();
}
