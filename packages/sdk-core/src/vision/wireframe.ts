/**
 * Lazy bootstrap for the Wireframe class.
 *
 * `wireframe.js` is shipped as a text asset (see `assets/wireframe.js.txt`)
 * and eval'd once at first use. Evaluating inside an IIFE with a shadowed
 * `console` keeps the library's per-capture "[wireframe] drew N elements"
 * log out of the host page's devtools — at 1 fps it would flood the console.
 * `.warn`/`.error` still go through so real problems surface.
 *
 * Used by:
 *   - `vision/frame-source.ts` — to render the wireframe canvas at `rate` Hz
 *   - `browser-bridge/dom-state.ts` — to produce the `screenshot_jpeg_b64`
 *     field returned by `browser.get_dom_state`
 */

import wireframeJs from "../assets/wireframe.js.txt";

export type WireframeInstance = {
  toDataURL(): Promise<string>;
  capture: () => Promise<{ canvas: HTMLCanvasElement }>;
};

export type WireframeCtor = new (
  root?: Element,
  opts?: Record<string, unknown>,
) => WireframeInstance;

let wireframeCtor: WireframeCtor | null = null;

export function getWireframeCtor(): WireframeCtor {
  if (!wireframeCtor) {
    wireframeCtor = (0, eval)(
      `(function(){
        var console = Object.assign({}, globalThis.console, {
          log: function(){}, info: function(){}, debug: function(){}
        });
        ${wireframeJs};
        return Wireframe;
      })()`,
    ) as WireframeCtor;
  }
  return wireframeCtor;
}
