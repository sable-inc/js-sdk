/**
 * Ambient declarations for text-asset imports.
 *
 * `wireframe.js.txt` and `visible-dom.js.txt` are shipped as text assets
 * and eval'd at runtime (see `vision/wireframe.ts` and
 * `browser-bridge/dom-state.ts`). Bun's bundler auto-inlines any `.txt`
 * import as a string at build time; we only need the ambient type so the
 * editor knows the default export is `string`.
 *
 * We deliberately avoid the TC39 `with { type: "text" }` import-attribute
 * form: it requires TypeScript 5.3+ and editors bundling an older `tsc`
 * (e.g. VS Code's built-in 5.1) parse `with` as the legacy statement and
 * report "with statements are not allowed in strict mode" (TS1101).
 */

declare module "*.js.txt" {
  const text: string;
  export default text;
}

declare module "*.txt" {
  const text: string;
  export default text;
}
