/**
 * @sable-ai/sdk-core — public entry point.
 *
 * Two ways to use this package, both backed by the same singleton:
 *
 *   1. Script tag (IIFE bundle):
 *      `<script src="https://sdk.withsable.com/v1/sable.js"></script>`
 *      — auto-installs `window.Sable`, good for no-build sites and the
 *        Chrome extension's inject script.
 *
 *   2. npm package (ESM):
 *      `import Sable from "@sable-ai/sdk-core"`
 *      — good for framework apps. Importing also installs `window.Sable`
 *        so mixed usage (one page, two entry points) stays coherent.
 *
 * This file is a barrel: all real code lives in sibling folders. Keep it
 * that way — the build output is what customers see, and a lean entry
 * module minimises tree-shake surprises.
 */

import { Sable, installGlobal } from "./global";

// Auto-install on import. Script-tag consumers get it via the IIFE
// wrapper's initialiser; ESM consumers get it here.
installGlobal();

// Re-exports for framework/ESM consumers who want named access to the
// public type surface (e.g. for building typed wrappers or adapters).
export { VERSION } from "./version";
export type {
  SableAPI,
  SableEvents,
  SableEventHandler,
  StartOptions,
  VisionOptions,
  FrameSource,
  WireframeFrameSource,
  FnFrameSource,
  RuntimeMethod,
  RuntimeMethods,
} from "./types";

export default Sable;
