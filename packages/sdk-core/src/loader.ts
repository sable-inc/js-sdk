/**
 * @sable-ai/sdk-core — loader stub (IIFE entry for the CDN bundle).
 *
 * This file compiles to `dist/sable.iife.js` (~1 KB gzipped). It is the
 * ONLY script a customer loads on page render; the full SDK (~150 KB
 * gzipped including livekit-client) is lazy-loaded as `sable-core.mjs` on
 * the first call to `Sable.start()`. Pages that never open a session pay
 * just the loader cost.
 *
 * Architecture (Stripe.js pattern):
 *
 *   Page load:    <script src="sdk.withsable.com/v1/sable.js">  →  loader (1 KB)
 *   User click:   Sable.start()  →  dynamic import of sable-core.mjs
 *   Steady state: 1 KB for pages that never start a session
 *
 * The loader pins itself to the same path as sable-core.mjs: both are
 * served from `/v<version>/`, and the loader derives the core URL from
 * its own script src (`document.currentScript.src`). A customer loading
 * `/v0.1.4/sable.js` always pulls `/v0.1.4/sable-core.mjs`; a customer
 * loading `/v1/sable.js` gets `/v1/sable-core.mjs`. Version cohesion is
 * automatic — customers never touch the core URL.
 */

import { VERSION } from "./version";
import type {
  SableAPI,
  SableEvents,
  SableEventHandler,
  StartOptions,
} from "./types";

// ── Script URL capture ────────────────────────────────────────────────────
//
// `document.currentScript` is only defined during SYNCHRONOUS script
// evaluation. We MUST read it at IIFE top-level, before any async boundary,
// or it will be null by the time start() is called.

const scriptSrc: string =
  typeof document !== "undefined" &&
  document.currentScript instanceof HTMLScriptElement
    ? document.currentScript.src
    : "";

// ── Pre-load subscription buffer ──────────────────────────────────────────
//
// Customers may call `Sable.on(...)` before `Sable.start(...)` — e.g. to
// wire up UI observers on page load. We record those subscriptions here
// and forward them to the real session once the core loads. Each entry
// tracks a `cancelled` flag + the real unsub function so the loader's
// returned unsub can reach through to the real subscription after load.

interface PendingSub {
  event: keyof SableEvents;
  handler: SableEventHandler<keyof SableEvents>;
  realUnsub?: () => void;
  cancelled?: boolean;
}
const pendingSubs: PendingSub[] = [];

// ── Core loader (memoised) ────────────────────────────────────────────────

let realSable: SableAPI | null = null;
let corePromise: Promise<SableAPI> | null = null;

function loadCore(): Promise<SableAPI> {
  if (realSable) return Promise.resolve(realSable);
  if (corePromise) return corePromise;

  if (!scriptSrc) {
    return Promise.reject(
      new Error(
        "[Sable] cannot locate SDK script URL. The loader must be loaded " +
          'via a <script src="..."> tag (document.currentScript was null).',
      ),
    );
  }

  const coreUrl = new URL("./sable-core.mjs", scriptSrc).href;
  corePromise = (async () => {
    const mod = (await import(/* @vite-ignore */ coreUrl)) as {
      default: SableAPI;
    };
    realSable = mod.default;

    // Flush queued subscriptions.
    for (const sub of pendingSubs) {
      if (sub.cancelled) continue;
      sub.realUnsub = realSable.on(sub.event, sub.handler);
    }

    return realSable;
  })();
  return corePromise;
}

// ── Public API proxy ──────────────────────────────────────────────────────

const Sable: SableAPI = {
  version: VERSION,

  async start(opts: StartOptions): Promise<void> {
    const s = await loadCore();
    return s.start(opts);
  },

  async stop(): Promise<void> {
    // If the user calls stop() before start() resolved, wait for the core
    // to finish loading so we can forward the call — otherwise we'd leave
    // the in-flight start() orphaned.
    if (corePromise && !realSable) await corePromise;
    if (!realSable) return;
    return realSable.stop();
  },

  on<E extends keyof SableEvents>(
    event: E,
    handler: SableEventHandler<E>,
  ): () => void {
    if (realSable) {
      return realSable.on(event, handler);
    }
    const sub: PendingSub = {
      event,
      handler: handler as SableEventHandler<keyof SableEvents>,
    };
    pendingSubs.push(sub);
    return () => {
      sub.cancelled = true;
      if (sub.realUnsub) sub.realUnsub();
    };
  },
};

// ── Install on window ─────────────────────────────────────────────────────
//
// First-write-wins — matches `src/global.ts` semantics for the npm path.
// If the customer already has a Sable (e.g. mixed npm + script tag on the
// same page), we don't swap it out.

if (typeof window !== "undefined" && !window.Sable) {
  window.Sable = Sable;
  console.log("[Sable] loader ready", VERSION);
}
