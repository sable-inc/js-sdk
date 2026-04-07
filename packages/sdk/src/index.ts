export const VERSION = "0.0.1";

declare global {
  interface Window {
    Sable?: { version: string };
  }
}

// Side effects only run when this module is loaded into a browser
// (e.g. via the IIFE bundle injected by @sable-ai/extension). When
// imported in a Node/Bun test environment there is no `window`, so
// the assignment is guarded.
if (typeof window !== "undefined") {
  console.log("Sable SDK injected", VERSION);
  window.Sable = { version: VERSION };
}
