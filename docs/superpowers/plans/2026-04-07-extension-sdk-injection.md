# Chrome Extension + SDK Injection (v0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a loadable Chrome MV3 extension that injects a `console.log`-only SDK into the active tab. Establish `@sable-ai/sdk` and `@sable-ai/extension` packages in the monorepo with Bun bundling.

**Architecture:** Two new monorepo packages. `@sable-ai/sdk` is one source file that runs `console.log("Sable SDK injected", VERSION)` and sets `window.Sable = { version }`, bundled to an IIFE. `@sable-ai/extension` is an MV3 extension whose popup button calls `chrome.scripting.executeScript` to drop a `<script src="chrome-extension://<id>/sable.iife.js">` tag into the active tab; the SDK runs in the page's main JS world.

**Tech Stack:** Bun (build + test), TypeScript, Chrome MV3 (`chrome.scripting`, `chrome.runtime.onMessage`, `web_accessible_resources`).

**Spec:** [`docs/superpowers/specs/2026-04-07-extension-sdk-injection-design.md`](../specs/2026-04-07-extension-sdk-injection-design.md)

---

## Task 1: Worktree, branch, and root rename

**Files:**
- Modify: `package.json`

**Status:** Branch `feat/extension-mv3-injection` already exists in worktree `/Users/marcoscandeia/workspace/js-sdk-extension`, branched from `docs/sdk-extension-design`. Spec committed.

- [ ] **Step 1: Verify clean state**

```bash
cd /Users/marcoscandeia/workspace/js-sdk-extension
git status
git log --oneline -5
```

Expected: clean status; the most recent commit is `ee76357 docs: spec for v0 chrome extension + sdk injection`.

- [ ] **Step 2: Rename root package to `@sable-ai/js-sdk`**

Edit `package.json`:

```json
{
  "name": "@sable-ai/js-sdk",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "bun test",
    "build": "bun run --filter '*' build"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5"
  }
}
```

Only the `name` field changes from `@sable/js-sdk` to `@sable-ai/js-sdk`.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: rename root package to @sable-ai/js-sdk"
```

---

## Task 2: Rename `packages/sdk-ui` → `packages/sdk` and update its package.json

**Files:**
- Move: `packages/sdk-ui/` → `packages/sdk/`
- Modify: `packages/sdk/package.json`

- [ ] **Step 1: Move the directory with `git mv`**

```bash
cd /Users/marcoscandeia/workspace/js-sdk-extension
git mv packages/sdk-ui packages/sdk
git status
```

Expected: `packages/sdk-ui/...` files shown as renamed to `packages/sdk/...`.

- [ ] **Step 2: Rewrite `packages/sdk/package.json`**

Replace the file's contents:

```json
{
  "name": "@sable-ai/sdk",
  "version": "0.0.1",
  "description": "Sable SDK — runtime that runs in the user's browser.",
  "type": "module",
  "main": "dist/sable.iife.js",
  "files": ["dist", "src"],
  "publishConfig": {
    "access": "public"
  },
  "scripts": {
    "build": "bun build src/index.ts --outfile dist/sable.iife.js --format=iife",
    "test": "bun test"
  }
}
```

Notes:
- `main` points at the IIFE bundle so consumers loading it via `import` get the same artifact the extension injects.
- `publishConfig.access = "public"` is required for scoped packages on npm. We do NOT run `npm publish` in this PR.
- `files` whitelists what ships when published.

- [ ] **Step 3: Commit the rename**

```bash
git add packages/sdk packages/sdk-ui
git commit -m "refactor: rename @sable/sdk-ui to @sable-ai/sdk"
```

---

## Task 3: Write the SDK source + a unit test

**Files:**
- Modify: `packages/sdk/src/index.ts`
- Create: `packages/sdk/src/index.test.ts`

- [ ] **Step 1: Write the failing test first**

Create `packages/sdk/src/index.test.ts`:

```ts
import { test, expect } from "bun:test";
import { VERSION } from "./index";

test("VERSION is exported as 0.0.1", () => {
  expect(VERSION).toBe("0.0.1");
});
```

- [ ] **Step 2: Run — should fail (current index.ts has no VERSION export… or it does)**

```bash
cd /Users/marcoscandeia/workspace/js-sdk-extension
bun test packages/sdk/src/index.test.ts 2>&1 | tail -10
```

Expected: either passes (current `index.ts` already exports `VERSION = "0.0.1"`) or fails with an import error if it doesn't.

If it already passes: that's fine — we'll still need to expand `index.ts` in step 3 to include the side effects, and the test pins the export.

- [ ] **Step 3: Replace `packages/sdk/src/index.ts` with the v0 SDK**

```ts
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
```

- [ ] **Step 4: Run the test — should still pass**

```bash
bun test packages/sdk/src/index.test.ts 2>&1 | tail -10
```

Expected: 1 pass.

- [ ] **Step 5: Build the SDK and inspect the output**

```bash
cd packages/sdk
bun install  # if needed
bun run build
ls dist/
head -c 400 dist/sable.iife.js
```

Expected: `dist/sable.iife.js` exists. The first chunk of the file should contain `Sable SDK injected` and `window.Sable`. Note: `bun build --format=iife` may not be supported on older Bun versions. If `bun build` rejects `--format=iife`, fall back to the default format (the resulting bundle still works as a `<script>` since top-level code runs on load) and remove `--format=iife` from `package.json`.

- [ ] **Step 6: Commit**

```bash
cd /Users/marcoscandeia/workspace/js-sdk-extension
git add packages/sdk/src/index.ts packages/sdk/src/index.test.ts
git commit -m "feat(sdk): v0 — log + window.Sable on inject"
```

(`dist/` is gitignored at the repo root; if it isn't, add it to `.gitignore` in this commit.)

- [ ] **Step 7: Verify dist is ignored**

```bash
git status
cat .gitignore
```

If `packages/sdk/dist` shows as untracked, add `dist/` (or `**/dist/`) to `.gitignore` and commit:

```bash
echo "dist/" >> .gitignore
git add .gitignore
git commit -m "chore: ignore dist directories"
```

---

## Task 4: Scaffold `packages/extension` — package.json + manifest

**Files:**
- Create: `packages/extension/package.json`
- Create: `packages/extension/manifest.json`
- Create: `packages/extension/.gitignore`

- [ ] **Step 1: Create the package directory**

```bash
mkdir -p /Users/marcoscandeia/workspace/js-sdk-extension/packages/extension/src
```

- [ ] **Step 2: Write `packages/extension/package.json`**

```json
{
  "name": "@sable-ai/extension",
  "version": "0.0.1",
  "private": true,
  "description": "Sable Chrome MV3 extension (development build).",
  "type": "module",
  "scripts": {
    "build": "bun run build:clean && bun run build:scripts && bun run build:assets && bun run build:sdk-copy",
    "build:clean": "rm -rf dist && mkdir -p dist",
    "build:scripts": "bun build src/background.ts src/popup.ts --outdir dist --target=browser",
    "build:assets": "cp manifest.json dist/manifest.json && cp src/popup.html dist/popup.html",
    "build:sdk-copy": "cp ../sdk/dist/sable.iife.js dist/sable.iife.js"
  },
  "dependencies": {
    "@sable-ai/sdk": "workspace:*"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.270"
  }
}
```

Why each script:
- `build:clean` ensures stale files don't ship into `dist/`.
- `build:scripts` bundles `background.ts` and `popup.ts` separately. `--target=browser` is the right target for content/page contexts.
- `build:assets` copies the static `manifest.json` and `popup.html` (Bun's bundler doesn't copy non-JS sources).
- `build:sdk-copy` lifts the SDK bundle out of the sibling package. The extension MUST have run `@sable-ai/sdk`'s build first; we document this in the README.

- [ ] **Step 3: Write `packages/extension/manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Sable (dev)",
  "version": "0.0.1",
  "description": "Inject the Sable SDK into the current tab (development build).",
  "permissions": ["scripting", "activeTab"],
  "action": {
    "default_popup": "popup.html",
    "default_title": "Sable (dev)"
  },
  "background": {
    "service_worker": "background.js"
  },
  "web_accessible_resources": [
    {
      "resources": ["sable.iife.js"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

Note: no `icons` field. Chrome will use a default puzzle-piece icon, which is fine for a dev build. Adding icons is a follow-up.

- [ ] **Step 4: Create `packages/extension/.gitignore`**

```
dist/
```

(Local to the package in case the root `.gitignore` doesn't already cover it.)

- [ ] **Step 5: Install dev deps**

```bash
cd /Users/marcoscandeia/workspace/js-sdk-extension
bun install 2>&1 | tail -10
```

Expected: workspace links resolve, `@types/chrome` is fetched.

- [ ] **Step 6: Commit**

```bash
git add packages/extension/package.json packages/extension/manifest.json packages/extension/.gitignore bun.lock
git commit -m "feat(extension): scaffold @sable-ai/extension package + manifest"
```

---

## Task 5: Write the background service worker

**Files:**
- Create: `packages/extension/src/background.ts`

- [ ] **Step 1: Write `background.ts`**

```ts
/// <reference types="chrome" />

/**
 * Background service worker for @sable-ai/extension (dev build).
 *
 * Listens for {type: "inject"} messages from the popup and uses
 * chrome.scripting.executeScript to drop a <script src> tag into
 * the active tab that loads packages/sdk's IIFE bundle into the
 * page's main JS world.
 *
 * Why a <script src> tag instead of `world: "MAIN"` directly:
 * `chrome.scripting.executeScript({ files: [...] })` runs files in
 * the extension's isolated world, not the page's main world. To
 * load a separate JS file into the main world we have to inject a
 * script tag whose src points at a web_accessible_resource. The
 * fetched script then executes in the page's own JS realm.
 */

interface InjectMessage {
  type: "inject";
}

interface InjectResponse {
  ok: boolean;
  error?: string;
}

chrome.runtime.onMessage.addListener(
  (msg: InjectMessage, _sender, sendResponse: (r: InjectResponse) => void) => {
    if (msg?.type !== "inject") return;

    void (async () => {
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!tab?.id) {
          sendResponse({ ok: false, error: "no active tab" });
          return;
        }

        const sdkUrl = chrome.runtime.getURL("sable.iife.js");

        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (url: string) => {
            const s = document.createElement("script");
            s.src = url;
            s.onload = () => s.remove();
            (document.head || document.documentElement).appendChild(s);
          },
          args: [sdkUrl],
        });

        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    // Return true to keep the message channel open for the async sendResponse.
    return true;
  },
);
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/marcoscandeia/workspace/js-sdk-extension/packages/extension
bunx tsc --noEmit src/background.ts 2>&1 | tail -10
```

Expected: no errors. If `tsc` complains about missing chrome types, ensure `@types/chrome` was installed in Task 4 and re-run `bun install`.

If type-check fails for unrelated reasons (e.g., no `tsconfig.json` in this package), create a minimal `packages/extension/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["chrome", "bun-types"],
    "lib": ["ES2022", "DOM"],
    "noEmit": true
  },
  "include": ["src/**/*"]
}
```

Then rerun `bunx tsc --noEmit` from the package directory.

- [ ] **Step 3: Commit**

```bash
cd /Users/marcoscandeia/workspace/js-sdk-extension
git add packages/extension/src/background.ts packages/extension/tsconfig.json 2>/dev/null || true
git add packages/extension/src/background.ts
[ -f packages/extension/tsconfig.json ] && git add packages/extension/tsconfig.json
git commit -m "feat(extension): background worker that injects sdk script tag"
```

---

## Task 6: Write the popup (HTML + TS)

**Files:**
- Create: `packages/extension/src/popup.html`
- Create: `packages/extension/src/popup.ts`

- [ ] **Step 1: Write `popup.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Sable (dev)</title>
    <style>
      body {
        font-family: -apple-system, system-ui, sans-serif;
        margin: 0;
        padding: 12px;
        width: 240px;
      }
      h1 {
        font-size: 14px;
        margin: 0 0 8px;
      }
      button {
        width: 100%;
        padding: 8px 12px;
        font-size: 13px;
        cursor: pointer;
      }
      #status {
        margin-top: 8px;
        font-size: 12px;
        color: #555;
        min-height: 1em;
      }
    </style>
  </head>
  <body>
    <h1>Sable (dev)</h1>
    <button id="inject-btn">Inject into current tab</button>
    <div id="status"></div>
    <script src="popup.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `popup.ts`**

```ts
/// <reference types="chrome" />

const btn = document.getElementById("inject-btn") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLDivElement;

btn.addEventListener("click", async () => {
  status.textContent = "Injecting…";
  btn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: "inject" });
    if (res?.ok) {
      status.textContent = "Injected. Open the page DevTools console.";
    } else {
      status.textContent = `Error: ${res?.error ?? "unknown"}`;
    }
  } catch (err) {
    status.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    btn.disabled = false;
  }
});
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/marcoscandeia/workspace/js-sdk-extension/packages/extension
bunx tsc --noEmit 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/marcoscandeia/workspace/js-sdk-extension
git add packages/extension/src/popup.html packages/extension/src/popup.ts
git commit -m "feat(extension): popup with inject button"
```

---

## Task 7: Build everything end-to-end and verify the dist layout

**Files:** None.

- [ ] **Step 1: Build the SDK**

```bash
cd /Users/marcoscandeia/workspace/js-sdk-extension
bun run --filter @sable-ai/sdk build 2>&1 | tail -10
ls packages/sdk/dist/
```

Expected: `sable.iife.js` exists.

- [ ] **Step 2: Build the extension**

```bash
bun run --filter @sable-ai/extension build 2>&1 | tail -10
ls packages/extension/dist/
```

Expected: `dist/` contains `manifest.json`, `background.js`, `popup.html`, `popup.js`, `sable.iife.js`.

- [ ] **Step 3: Sanity-check the SDK bundle inside the extension's dist**

```bash
head -c 400 packages/extension/dist/sable.iife.js
```

Expected: contains `"Sable SDK injected"`.

- [ ] **Step 4: Sanity-check the manifest landed correctly**

```bash
cat packages/extension/dist/manifest.json
```

Expected: identical to `packages/extension/manifest.json` from Task 4.

- [ ] **Step 5: Run all tests**

```bash
bun test 2>&1 | tail -10
```

Expected: at least 1 pass (the SDK VERSION test). No failures.

No commit in this task — it's verification only.

---

## Task 8: Write `packages/extension/README.md`

**Files:**
- Create: `packages/extension/README.md`

- [ ] **Step 1: Write the README**

Use the exact contents from the spec's "`packages/extension/README.md`" section. Reproduced here verbatim so the engineer doesn't need to flip back:

````markdown
# @sable-ai/extension (dev build)

Local-only Chrome MV3 extension that injects the Sable SDK into the
current tab. v0 just runs `console.log` from the SDK; no LiveKit, no RPC.

## Build

From the repo root:

    bun install
    bun run --filter @sable-ai/sdk build
    bun run --filter @sable-ai/extension build

This produces `packages/extension/dist/` with `manifest.json`,
`background.js`, `popup.html`, `popup.js`, and `sable.iife.js`.

## Load in Chrome

1. Open `chrome://extensions`
2. Toggle **Developer mode** on (top right)
3. Click **Load unpacked**
4. Select `packages/extension/dist`
5. The Sable (dev) extension appears in the toolbar. Pin it for convenience.

## Test the injection

1. Navigate to any page (e.g., `https://example.com`)
2. Open DevTools → Console
3. Click the Sable toolbar icon → click **Inject into current tab**
4. The console should log:

       Sable SDK injected 0.0.1

5. In the console, run `window.Sable` and you should see `{version: "0.0.1"}`

## Iterating

After editing source files:

    bun run --filter @sable-ai/sdk build
    bun run --filter @sable-ai/extension build

Then in `chrome://extensions`, click the **Reload** icon on the Sable card.
Background service workers don't auto-reload on file changes.

## Troubleshooting

- **"Could not establish connection"** in popup: the background service
  worker may have been unloaded. Click the toolbar icon again — Chrome
  spins it back up on demand.
- **Nothing in the console**: check that DevTools is attached to the
  *page*, not the extension's popup. Right-click the popup → Inspect for
  popup logs; use the page's own DevTools for SDK logs.
- **Permission denied on chrome:// or about:// URLs**: extensions can't
  inject into Chrome's internal pages. Test on a normal http(s) page.
````

- [ ] **Step 2: Commit**

```bash
git add packages/extension/README.md
git commit -m "docs(extension): local install + test instructions"
```

---

## Task 9: Push and open PR

**Files:** None.

- [ ] **Step 1: Push the branch**

```bash
cd /Users/marcoscandeia/workspace/js-sdk-extension
git push -u origin feat/extension-mv3-injection 2>&1 | tail -10
```

- [ ] **Step 2: Open the PR (base = `docs/sdk-extension-design`)**

The base branch is `docs/sdk-extension-design` because that's where the spec lives and where this work is stacked. If you'd rather merge directly to `main`, change `--base main` and the spec commit will travel with this PR.

```bash
gh pr create \
  --base docs/sdk-extension-design \
  --title "feat: chrome extension v0 + sdk injection scaffold" \
  --body "$(cat <<'EOF'
## Summary

First small step toward the full SDK + extension + UserBrowserBridge architecture. Scope is intentionally tiny: prove that a Chrome MV3 extension can inject a built SDK file into the page's main JS world.

- Renames root package to \`@sable-ai/js-sdk\` and \`packages/sdk-ui\` → \`packages/sdk\` (\`@sable-ai/sdk\`)
- New \`packages/extension\` (\`@sable-ai/extension\`, private, MV3)
- v0 SDK: \`console.log("Sable SDK injected", VERSION)\` + \`window.Sable = { version }\`. Nothing else.
- Popup → background → \`chrome.scripting.executeScript\` → \`<script src="chrome-extension://<id>/sable.iife.js">\` → SDK runs in main world
- \`@sable-ai/sdk\` set up with \`publishConfig.access = "public"\` so a future \`npm publish\` lands under the org. This PR does NOT publish.
- Bun for bundling both packages, per repo CLAUDE.md
- \`packages/extension/README.md\` with full local install + test steps

## Test plan

- [x] \`bun test\` passes (1 SDK unit test pinning \`VERSION === "0.0.1"\`)
- [x] \`bun run --filter @sable-ai/sdk build\` produces \`packages/sdk/dist/sable.iife.js\`
- [x] \`bun run --filter @sable-ai/extension build\` produces a complete \`packages/extension/dist/\` (manifest + background + popup + sable.iife.js)
- [ ] Manual: load \`packages/extension/dist\` as unpacked extension in Chrome, click toolbar icon → "Inject into current tab" on \`https://example.com\`, verify \`Sable SDK injected 0.0.1\` in the page console and \`window.Sable.version === "0.0.1"\`. Steps in \`packages/extension/README.md\`.

## Out of scope (deliberate)

- LiveKit / WebRTC / RPC handlers — next PR
- API key, popup status state machine, \`chrome.storage\`
- Auto-inject on \`document_idle\`, content scripts, SPA navigation
- Chrome Web Store submission
- Actual \`npm publish\` of \`@sable-ai/sdk\` (config is in place; publish is a manual next step)

Spec: \`docs/superpowers/specs/2026-04-07-extension-sdk-injection-design.md\`
Plan: \`docs/superpowers/plans/2026-04-07-extension-sdk-injection.md\`
EOF
)" 2>&1 | tail -10
```

- [ ] **Step 3: Capture the PR URL**.

---

## Plan self-review

**Spec coverage** (against `docs/superpowers/specs/2026-04-07-extension-sdk-injection-design.md`):
- "Rename root → `@sable-ai/js-sdk`" → ✅ Task 1
- "Rename `packages/sdk-ui` → `packages/sdk`, package = `@sable-ai/sdk`" → ✅ Task 2
- "SDK source: console.log + window.Sable" → ✅ Task 3
- "SDK unit test pinning VERSION" → ✅ Task 3
- "MV3 manifest with activeTab + scripting + web_accessible_resources" → ✅ Task 4
- "Background worker handles {type:'inject'} → executeScript → script tag" → ✅ Task 5
- "Popup with single Inject button + status div" → ✅ Task 6
- "Build copies sable.iife.js from sdk dist into extension dist" → ✅ Task 4 (build script) + Task 7 (verification)
- "README with build + load-unpacked + test instructions" → ✅ Task 8
- "Publish *config* set up but not run" → ✅ Task 2 (`publishConfig.access`)
- "Bun for bundling" → ✅ Tasks 2, 4

**Placeholder scan:** None. Every code/JSON block is complete and copy-pasteable.

**Type / name consistency:**
- Package names: `@sable-ai/js-sdk` (root), `@sable-ai/sdk` (sdk), `@sable-ai/extension` (extension) — consistent across Tasks 1, 2, 4.
- `chrome.runtime.sendMessage({type: "inject"})` shape is identical in popup.ts (Task 6) and background.ts (Task 5).
- The IIFE bundle path `sable.iife.js` is identical in: sdk's build script (Task 2), extension's `build:sdk-copy` (Task 4), `web_accessible_resources` (Task 4 manifest), and `chrome.runtime.getURL` call (Task 5).

**Known limitations** (deliberate, not bugs):
- `bun build --format=iife` may not be supported on the user's Bun version. Task 3 Step 5 tells the engineer to fall back to the default format if needed; the resulting bundle still works as a `<script>` because top-level code runs on load.
- No icons in the manifest — Chrome shows a default puzzle piece. Fine for dev.
- No tsconfig at the root yet; the per-package tsconfig is created lazily in Task 5 if needed.
- Build needs to run in order (`@sable-ai/sdk` first, then `@sable-ai/extension`). The README documents this. A root-level orchestration script could enforce ordering later.
