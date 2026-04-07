# Chrome Extension + SDK Injection (v0) — Design

> First step toward the full SDK + extension + UserBrowserBridge architecture defined in [2026-04-06-sdk-extension-userbrowserbridge-design.md](./2026-04-06-sdk-extension-userbrowserbridge-design.md). Scope of *this* design is intentionally tiny: prove that a Chrome MV3 extension can inject a built SDK file into the page's main JS world. Nothing else.

## Goal

A loadable Chrome MV3 extension that, on user click, injects a built SDK file into the active tab. The injected SDK does exactly two things:

1. `console.log("Sable SDK injected", VERSION)`
2. Sets `window.Sable = { version: VERSION }`

That's the entire SDK for v0.

## Why this scope

The user wants the smallest possible step that proves the injection plumbing works. No LiveKit, no RPC, no API key, no popup status, no auto-inject on navigation. Each of those becomes its own follow-up.

## Non-goals

- LiveKit / WebRTC connection
- RPC handlers (`browser.execute_action`, `browser.get_dom_state`, etc.)
- API key handling, customer auth
- Popup with status, session management, Start/Stop semantics
- Auto-inject on `document_idle`
- Chrome Web Store submission
- Actually publishing `@sable-ai/sdk` to npm (we set up the publish *config* but don't run `npm publish`)
- The shadow-DOM UI overlay (orb, PTT button)
- Wireframe / element capture

These belong to subsequent PRs that build on this one.

## Architecture

### Monorepo layout

```
js-sdk/
├─ package.json                 # @sable-ai/js-sdk (renamed from @sable/js-sdk)
├─ packages/
│  ├─ sdk/                      # renamed from sdk-ui; published as @sable-ai/sdk
│  │  ├─ package.json
│  │  ├─ src/index.ts           # console.log + window.Sable = { version }
│  │  └─ dist/sable.iife.js     # bun-built, IIFE for <script src> injection
│  └─ extension/                # new; private (not published)
│     ├─ package.json
│     ├─ README.md              # local install / test instructions
│     ├─ manifest.json
│     ├─ src/
│     │  ├─ background.ts       # service worker
│     │  ├─ popup.html
│     │  ├─ popup.ts            # "Inject" button → message background
│     │  └─ inject-script.ts    # tiny function executed via chrome.scripting
│     └─ dist/                  # bun-built; loaded unpacked
└─ docs/
   ├─ specs/2026-04-07-extension-sdk-injection-design.md   # this file
   └─ plans/2026-04-07-extension-sdk-injection.md          # implementation plan
```

The `sdk-ui` package becomes `sdk`. The name `sdk-ui` was a placeholder; the spec calls for `@sable-ai/sdk`.

### Injection flow

User clicks the extension's toolbar icon to open the popup. The popup has one button: **Inject into current tab**.

```
1. User clicks "Inject"
2. popup.ts → chrome.runtime.sendMessage({ type: "inject" })
3. background.ts receives, calls chrome.tabs.query({active: true, currentWindow: true})
   to find the target tab
4. background.ts calls chrome.scripting.executeScript({
       target: { tabId },
       func: injectScriptIntoMainWorld,
       args: [chrome.runtime.getURL("sable.iife.js")],
       world: "ISOLATED",  // default — runs in extension's isolated world
   })
5. injectScriptIntoMainWorld runs in the page's isolated world. It creates
   a <script src="chrome-extension://<id>/sable.iife.js"> element and
   appends it to document.documentElement. The browser fetches the script
   (allowed because sable.iife.js is in web_accessible_resources) and
   executes it in the page's MAIN JS world.
6. sable.iife.js runs in the main world: console.log + window.Sable = {...}
```

**Why a script tag instead of `world: "MAIN"` directly?** `chrome.scripting.executeScript` with `world: "MAIN"` works for inline functions, but to *load a separate file* into the main world we use the `<script src>` trick. This is the canonical MV3 pattern and matches what the full spec calls for.

### How the SDK file gets into the extension's `dist/`

The extension's build step copies `packages/sdk/dist/sable.iife.js` into `packages/extension/dist/sable.iife.js`. This way the extension always ships with the SDK at a known path.

For v0 the copy is a one-line script in `packages/extension/package.json`'s build command. A real release pipeline (later) will pin to a published version of `@sable-ai/sdk`.

## Components

### `@sable-ai/sdk` (`packages/sdk`)

- `src/index.ts`:
  ```ts
  export const VERSION = "0.0.1";

  // IIFE entry: when bundled to sable.iife.js, this runs immediately on
  // <script> load and exposes window.Sable.
  declare global {
    interface Window {
      Sable?: { version: string };
    }
  }

  console.log("Sable SDK injected", VERSION);
  window.Sable = { version: VERSION };
  ```
- `package.json`:
  - `name: "@sable-ai/sdk"`
  - `version: "0.0.1"`
  - `publishConfig: { access: "public" }`
  - `files: ["dist"]`
  - `main: "dist/sable.iife.js"`
  - `scripts.build: "bun build src/index.ts --outfile dist/sable.iife.js --format=iife"`
  - `scripts.test: "bun test"`
- `src/index.test.ts`: a single unit test that imports `VERSION` and asserts it equals `"0.0.1"`. This pins the export shape so future renames don't silently break the extension's expectations.

### `@sable-ai/extension` (`packages/extension`)

- `package.json`:
  - `name: "@sable-ai/extension"`
  - `private: true`
  - `scripts.build: "bun run build:sdk-copy && bun build src/background.ts src/popup.ts --outdir dist --target=browser && bun run build:assets"` (or simpler — see plan)
  - Depends on `@sable-ai/sdk` via workspace
- `manifest.json`:
  ```json
  {
    "manifest_version": 3,
    "name": "Sable (dev)",
    "version": "0.0.1",
    "description": "Inject the Sable SDK into any page (development build).",
    "permissions": ["scripting", "activeTab"],
    "action": { "default_popup": "popup.html" },
    "background": { "service_worker": "background.js" },
    "web_accessible_resources": [
      { "resources": ["sable.iife.js"], "matches": ["<all_urls>"] }
    ]
  }
  ```
  Note: no `host_permissions` and no `content_scripts` block. `activeTab` + user-gesture click is enough for `chrome.scripting.executeScript` against the active tab. This is the minimum-permission shape.
- `src/background.ts`:
  ```ts
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "inject") return;
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        sendResponse({ ok: false, error: "no active tab" });
        return;
      }
      const url = chrome.runtime.getURL("sable.iife.js");
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (sdkUrl: string) => {
          const s = document.createElement("script");
          s.src = sdkUrl;
          s.onload = () => s.remove();
          (document.head || document.documentElement).appendChild(s);
        },
        args: [url],
      });
      sendResponse({ ok: true });
    })();
    return true; // keep the message channel open for async sendResponse
  });
  ```
- `src/popup.html`: minimal HTML with one button + a status div. Loads `popup.js`.
- `src/popup.ts`:
  ```ts
  document.getElementById("inject-btn")!.addEventListener("click", async () => {
    const status = document.getElementById("status")!;
    status.textContent = "Injecting…";
    const res = await chrome.runtime.sendMessage({ type: "inject" });
    status.textContent = res?.ok
      ? "Injected. Open DevTools console."
      : `Error: ${res?.error ?? "unknown"}`;
  });
  ```

### `packages/extension/README.md`

The user explicitly asked for this. Contents:

```markdown
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
```

## Build / publish setup

- Bun for bundling (per repo CLAUDE.md).
- Root `package.json` renamed: `@sable/js-sdk` → `@sable-ai/js-sdk`.
- `packages/sdk/package.json` set up with `publishConfig.access = "public"` so a future `bun publish` (or `npm publish`) lands under the `@sable-ai` org. **We do not actually run publish in this PR** — that requires npm org credentials and is a separate, manual step.
- Extension is `private: true` and never publishes.

## Test plan

### Automated
- `packages/sdk/src/index.test.ts`: pins `VERSION === "0.0.1"`. Run with `bun test` from the package or root.
- No automated tests for the extension itself in v0 — Chrome extension testing requires Puppeteer/Playwright with a real Chromium and is overkill for "click button, see console.log".

### Manual (per the README)
- Build both packages
- Load unpacked in `chrome://extensions`
- Open `https://example.com`
- Click toolbar icon → Inject
- Verify `Sable SDK injected 0.0.1` in the page console and `window.Sable.version === "0.0.1"`

## Risks / known limitations

- **Service worker lifecycle**: MV3 background workers shut down after ~30s of idle. Each click of the popup's button cold-starts the worker. The async `sendResponse` pattern in `background.ts` accounts for this.
- **No `host_permissions`**: by relying solely on `activeTab` we cannot inject without a user gesture. That's fine — and intentional — for v0. The full SDK design will need broader permissions later when it auto-injects.
- **`sable.iife.js` is duplicated**: it's built once in `packages/sdk/dist` and copied into `packages/extension/dist`. v0 uses a copy step in the extension's build. A future refactor could symlink or use a `bun build` plugin, but copy-once-at-build is the simplest correct thing.
- **No CSP escape hatch**: pages with strict `script-src` directives may refuse the injected `<script src="chrome-extension://...">`. We accept that limitation for v0 — the spec's full content-script + MAIN-world `chrome.scripting.executeScript({ files: [...] })` pattern is the workaround, and we'll add it when we hit a real customer page that breaks.

## What this design does NOT do

(Repeated from non-goals for emphasis when scoping the plan.)

- No LiveKit, no audio, no RPC, no agent connection
- No popup status/state machine beyond "Injecting…" / "Injected." / "Error"
- No API key input or `chrome.storage`
- No content script, no auto-inject, no SPA navigation handling
- No actual `npm publish`
