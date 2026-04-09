/**
 * `window.Sable` installer.
 *
 * The SDK ships in two distribution formats that MUST present the same
 * runtime singleton:
 *
 *   1. IIFE bundle (`<script src="https://sdk.withsable.com/v1/sable.js">`)
 *      — auto-installs `window.Sable` on load.
 *
 *   2. npm ESM (`import Sable from "@sable-ai/sdk-core"`) — the `index.ts`
 *      barrel calls `installGlobal()` in addition to exporting `Sable` as
 *      its default export. If the customer also loaded the IIFE in the
 *      same page, the second install is a no-op (first-write-wins), so
 *      framework apps and script-tag users see the exact same session
 *      object. This is the Stripe/Intercom pattern: one global, multiple
 *      ways to reach it.
 */

import { Session } from "./session";
import type { SableAPI } from "./types";

/** The process-wide Sable singleton. Used by both `index.ts` and `installGlobal`. */
export const Sable: SableAPI = new Session();

/**
 * Attach `Sable` to `window.Sable`, unless something already claimed that
 * slot. First-write-wins so mixed script-tag + npm usage doesn't swap the
 * singleton mid-session.
 */
export function installGlobal(): void {
  if (typeof window === "undefined") return;
  if (window.Sable) return;
  window.Sable = Sable;
  console.log("[Sable] SDK loaded", Sable.version);
}
