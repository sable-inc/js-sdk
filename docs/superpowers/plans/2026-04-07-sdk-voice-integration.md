# SDK Voice Integration (v0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `window.Sable.start({ agentPublicId })` joins a LiveKit room, publishes the mic, and lets the user talk to a dispatched agent worker on any `http://localhost:*` page.

**Architecture:** The SDK fetches `/connection-details` from sable-api directly (CORS already allows `localhost:*`), dynamically imports `livekit-client`, joins the returned room, and enables the mic. The extension popup collects the agent ID, sends it to the background service worker, which injects the SDK into the active tab and calls `window.Sable.start()` via `chrome.scripting.executeScript({ world: "MAIN" })`.

**Tech Stack:** Bun workspaces, TypeScript (`tsc --noEmit`), `livekit-client@^2.17.0` (matching parley), Chrome MV3 (`chrome.scripting`, `chrome.storage.local`), `bun build --format=iife --target=browser`.

**Spec:** [`docs/superpowers/specs/2026-04-07-sdk-voice-integration-design.md`](../specs/2026-04-07-sdk-voice-integration-design.md)

---

## File Structure

**Created:**
- `packages/sdk/examples/test.html` — standalone local test page
- `packages/sdk/README.md` — minimal usage docs for the SDK

**Modified:**
- `packages/sdk/package.json` — add `livekit-client` dep, bump version to `0.0.2`
- `packages/sdk/src/index.ts` — full rewrite: `window.Sable = { version, start, stop }`, real LiveKit session
- `packages/sdk/src/index.test.ts` — pin `VERSION === "0.0.2"`
- `packages/extension/src/popup.html` — replace single Inject button with agent ID / API URL form + Start/Stop buttons
- `packages/extension/src/popup.ts` — Start/Stop handlers, `chrome.storage.local` persistence
- `packages/extension/src/background.ts` — `start` and `stop` message handlers using `executeScript({ world: "MAIN" })`
- `packages/extension/README.md` — replace test steps with Start/Stop flow + local-only caveat

**Not touched:**
- `packages/extension/manifest.json` — no new permissions needed (`scripting` + `activeTab` already present)
- `packages/extension/package.json` — build script shape is unchanged
- Any file in `sable-app/`, `parley/`, or `sable-agentkit/`

---

## Task 1: Add `livekit-client` dependency to `@sable-ai/sdk`

**Files:**
- Modify: `packages/sdk/package.json`

**Why this task exists:** The SDK needs `livekit-client` at runtime for the `Room` class. Parley pins `^2.17.0`; we match so the LiveKit protocol version stays aligned with what sable-api's server SDK expects.

- [ ] **Step 1: Add the dependency to `packages/sdk/package.json`**

Replace the file contents with:

```json
{
  "name": "@sable-ai/sdk",
  "version": "0.0.2",
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
  },
  "dependencies": {
    "livekit-client": "^2.17.0"
  }
}
```

- [ ] **Step 2: Install the dependency**

Run from the repo root: `bun install`

Expected: `bun install` reports `livekit-client` added; `node_modules/livekit-client/package.json` exists.

Verify: `ls node_modules/livekit-client/package.json` returns the path.

- [ ] **Step 3: Commit**

```bash
git add packages/sdk/package.json bun.lock
git commit -m "feat(sdk): add livekit-client dep + bump to 0.0.2"
```

Note: the lockfile is named `bun.lock` (not `bun.lockb`) in this repo — verify with `ls bun.lock*` if the commit fails to find it.

---

## Task 2: Rewrite `@sable-ai/sdk` to expose real `start`/`stop`

**Files:**
- Modify: `packages/sdk/src/index.ts`
- Modify: `packages/sdk/src/index.test.ts`

**Why this task exists:** Today's `index.ts` auto-logs and sets `window.Sable = { version }` on load. We replace it with `window.Sable = { version, start, stop }` where `start` fetches connection-details, joins a LiveKit room, and publishes the mic. No auto-connect on load.

- [ ] **Step 1: Update the version pin test**

Replace `packages/sdk/src/index.test.ts` with:

```ts
import { test, expect } from "bun:test";
import { VERSION } from "./index";

test("VERSION is exported as 0.0.2", () => {
  expect(VERSION).toBe("0.0.2");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from repo root: `bun test packages/sdk/src/index.test.ts`

Expected: FAIL with `Expected: "0.0.2"  Received: "0.0.1"`.

- [ ] **Step 3: Rewrite `packages/sdk/src/index.ts`**

Replace the file contents with:

```ts
/**
 * @sable-ai/sdk — v0 voice-only entry point.
 *
 * Installs `window.Sable = { version, start, stop }` when loaded in a browser.
 * `start(opts)` fetches LiveKit connection details from sable-api, dynamically
 * imports `livekit-client`, connects to the returned room, and publishes the
 * local microphone. Observability is console-only for v0.
 */

export const VERSION = "0.0.2";

const DEFAULT_API_URL = "https://sable-api-gateway-9dfmhij9.wl.gateway.dev";

export interface StartOpts {
  agentPublicId: string;
  apiUrl?: string;
  nickelRegion?: string;
}

export interface SableAPI {
  version: string;
  start(opts: StartOpts): Promise<void>;
  stop(): Promise<void>;
}

declare global {
  interface Window {
    Sable?: SableAPI;
  }
}

interface ConnectionDetails {
  serverUrl: string;
  roomName: string;
  participantToken: string;
  participantName: string;
}

// Minimal structural type for the LiveKit Room instance we use.
// Defined so we don't have to import a type from livekit-client at the
// top level of the IIFE (the client is dynamically imported inside start()).
interface LiveKitRoom {
  connect(url: string, token: string): Promise<unknown>;
  disconnect(): Promise<void>;
  on(event: string, handler: (...args: unknown[]) => void): unknown;
  localParticipant: {
    setMicrophoneEnabled(enabled: boolean): Promise<unknown>;
  };
}

let activeRoom: LiveKitRoom | null = null;

async function fetchConnectionDetails(
  apiUrl: string,
  agentPublicId: string,
  nickelRegion: string | undefined,
): Promise<ConnectionDetails> {
  const url = new URL("/connection-details", apiUrl);
  url.searchParams.set("agentPublicId", agentPublicId);
  if (nickelRegion) {
    url.searchParams.set("nickelRegion", nickelRegion);
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`connection-details failed: ${res.status} ${body}`);
  }
  return (await res.json()) as ConnectionDetails;
}

async function start(opts: StartOpts): Promise<void> {
  if (activeRoom) {
    throw new Error("Sable already started; call stop() first");
  }

  const apiUrl = opts.apiUrl ?? DEFAULT_API_URL;
  console.log("[Sable] fetching connection details", {
    apiUrl,
    agentPublicId: opts.agentPublicId,
  });
  const details = await fetchConnectionDetails(
    apiUrl,
    opts.agentPublicId,
    opts.nickelRegion,
  );
  console.log("[Sable] connection details received", {
    roomName: details.roomName,
    participantName: details.participantName,
  });

  const { Room, RoomEvent } = await import("livekit-client");
  const room = new Room() as unknown as LiveKitRoom;

  room.on(RoomEvent.ConnectionStateChanged, (state: unknown) => {
    console.log("[Sable] ConnectionStateChanged", state);
  });
  room.on(RoomEvent.Disconnected, (reason: unknown) => {
    console.log("[Sable] Disconnected", reason);
    activeRoom = null;
  });
  room.on(RoomEvent.ParticipantConnected, (participant: unknown) => {
    console.log("[Sable] ParticipantConnected", participant);
  });
  room.on(RoomEvent.TrackSubscribed, (track: unknown, pub: unknown, participant: unknown) => {
    console.log("[Sable] TrackSubscribed", { track, pub, participant });
  });
  room.on(RoomEvent.TrackUnsubscribed, (track: unknown) => {
    console.log("[Sable] TrackUnsubscribed", track);
  });

  await room.connect(details.serverUrl, details.participantToken);
  await room.localParticipant.setMicrophoneEnabled(true);

  activeRoom = room;
  console.log("[Sable] session live", {
    roomName: details.roomName,
    participantName: details.participantName,
  });
}

async function stop(): Promise<void> {
  if (!activeRoom) {
    return;
  }
  const room = activeRoom;
  activeRoom = null;
  try {
    await room.localParticipant.setMicrophoneEnabled(false);
  } catch (err) {
    console.warn("[Sable] setMicrophoneEnabled(false) failed", err);
  }
  await room.disconnect();
  console.log("[Sable] session ended");
}

// Side effects only run in a browser. Guarded so the test env (bun:test)
// doesn't try to install on a nonexistent `window`.
if (typeof window !== "undefined") {
  window.Sable = { version: VERSION, start, stop };
  console.log("Sable SDK loaded", VERSION);
}
```

- [ ] **Step 4: Run the version test to verify it passes**

Run: `bun test packages/sdk/src/index.test.ts`

Expected: PASS — `1 pass, 0 fail`.

- [ ] **Step 5: Type-check the SDK package**

Run from repo root: `bunx tsc --noEmit -p packages/sdk/tsconfig.json`

Expected: no output (success). If TypeScript complains about `RoomEvent` member access, that's fine because `RoomEvent` is a real enum exported from `livekit-client` and the dynamic `import("livekit-client")` types it automatically.

If it complains about `window` not being defined, ensure `packages/sdk/tsconfig.json` (or the root `tsconfig.json` it extends) includes `"lib": ["ES2022", "DOM"]`. Check with: `cat tsconfig.json`. If DOM is missing, add it to the root `tsconfig.json` `compilerOptions.lib` array.

- [ ] **Step 6: Build the SDK bundle**

Run from repo root: `bun run --filter @sable-ai/sdk build`

Expected: `dist/sable.iife.js` written. It will be ~300 KB because `livekit-client` is inlined — that is expected.

Verify: `ls -lh packages/sdk/dist/sable.iife.js` shows a file larger than 100 KB.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/index.ts packages/sdk/src/index.test.ts packages/sdk/dist/sable.iife.js
git commit -m "feat(sdk): real start/stop — join LiveKit room + publish mic"
```

Note: `dist/` is usually gitignored, so the `dist/sable.iife.js` path may be skipped. That's fine — the extension build script regenerates it.

---

## Task 3: Add `packages/sdk/examples/test.html`

**Files:**
- Create: `packages/sdk/examples/test.html`

**Why this task exists:** The SDK needs a local test harness so you can talk to an agent without going through the extension. This page is also the canonical "how do I use the SDK" example for future customers.

- [ ] **Step 1: Create the examples directory**

Run from repo root: `mkdir -p packages/sdk/examples`

Verify: `ls -d packages/sdk/examples` succeeds.

- [ ] **Step 2: Write `packages/sdk/examples/test.html`**

Create the file with this exact content:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Sable SDK — local test</title>
    <style>
      body {
        font-family: -apple-system, system-ui, sans-serif;
        max-width: 520px;
        margin: 40px auto;
        padding: 0 16px;
      }
      label {
        display: block;
        margin: 12px 0 4px;
        font-size: 13px;
        color: #333;
      }
      input {
        width: 100%;
        padding: 6px 8px;
        font: inherit;
        box-sizing: border-box;
      }
      .row {
        display: flex;
        gap: 8px;
        margin-top: 16px;
      }
      button {
        flex: 1;
        padding: 8px 12px;
        font: inherit;
        cursor: pointer;
      }
      pre#status {
        background: #f5f5f5;
        padding: 12px;
        margin-top: 16px;
        border-radius: 4px;
        min-height: 48px;
        white-space: pre-wrap;
        word-break: break-word;
      }
    </style>
  </head>
  <body>
    <h1>Sable SDK — local test</h1>
    <p>Serve this page from a localhost port and click Start. Open the DevTools console to see session logs.</p>
    <form id="sable-form">
      <label for="agent-id">Agent ID</label>
      <input id="agent-id" type="text" placeholder="agt_..." required />

      <label for="api-url">API URL</label>
      <input id="api-url" type="text" value="https://sable-api-gateway-9dfmhij9.wl.gateway.dev" />

      <div class="row">
        <button type="submit">Start</button>
        <button type="button" id="stop-btn">Stop</button>
      </div>
    </form>
    <pre id="status"></pre>

    <script src="../dist/sable.iife.js"></script>
    <script>
      const form = document.getElementById("sable-form");
      const agentInput = document.getElementById("agent-id");
      const apiInput = document.getElementById("api-url");
      const stopBtn = document.getElementById("stop-btn");
      const statusEl = document.getElementById("status");

      // Persist agent id across reloads so you don't retype it.
      const saved = localStorage.getItem("sable-agent-id");
      if (saved) agentInput.value = saved;
      const savedApi = localStorage.getItem("sable-api-url");
      if (savedApi) apiInput.value = savedApi;

      function setStatus(msg) {
        statusEl.textContent = msg;
      }

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        localStorage.setItem("sable-agent-id", agentInput.value);
        localStorage.setItem("sable-api-url", apiInput.value);
        setStatus("Starting…");
        try {
          await window.Sable.start({
            agentPublicId: agentInput.value,
            apiUrl: apiInput.value || undefined,
          });
          setStatus("Live. Talk to the agent. Check the console for events.");
        } catch (err) {
          setStatus("Error: " + (err?.message ?? String(err)));
        }
      });

      stopBtn.addEventListener("click", async () => {
        setStatus("Stopping…");
        try {
          await window.Sable.stop();
          setStatus("Stopped.");
        } catch (err) {
          setStatus("Error: " + (err?.message ?? String(err)));
        }
      });
    </script>
  </body>
</html>
```

- [ ] **Step 3: Smoke-test that the page serves**

Run from repo root (in a background shell — stop it after the check):

```bash
python3 -m http.server 5173 --directory packages/sdk/examples
```

In another shell: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/test.html`

Expected: `200`.

Stop the server (`Ctrl-C` or `kill %1`).

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/examples/test.html
git commit -m "feat(sdk): add examples/test.html local test harness"
```

---

## Task 4: Add `packages/sdk/README.md`

**Files:**
- Create: `packages/sdk/README.md`

**Why this task exists:** The SDK package needs a minimal readme so future callers (and future us) can remember the public shape and the local test flow.

- [ ] **Step 1: Create `packages/sdk/README.md`**

Write the file with this exact content:

```markdown
# @sable-ai/sdk

v0 browser runtime for Sable: joins a LiveKit room and lets the user talk to an
agent worker. Voice-only. No DOM tools, no UI overlay, no events API.

## Install

```bash
bun add @sable-ai/sdk
```

Or include the IIFE bundle directly:

```html
<script src="./sable.iife.js"></script>
```

## Usage

```js
await window.Sable.start({
  agentPublicId: "agt_...",
  apiUrl: "https://sable-api-gateway-9dfmhij9.wl.gateway.dev", // optional, this is the default
  nickelRegion: "us-east1", // optional
});

// ... user talks to the agent ...

await window.Sable.stop();
```

## Local test

```bash
bun install
bun run --filter @sable-ai/sdk build
python3 -m http.server 5173 --directory packages/sdk/examples
```

Open `http://localhost:5173/test.html`, paste an agent public ID, click Start.
Grant mic permission when prompted. Observe the console for LiveKit session
events.

**Only `http://localhost:*` origins work in v0** — `sable-api`'s CORS policy
does not yet allow arbitrary origins. See the v0 spec at
`docs/superpowers/specs/2026-04-07-sdk-voice-integration-design.md` for the
deferred per-org allowed-origins work.

## Known limitations (v0)

- Voice only. No DOM tools, no actions, no wireframe.
- Bundle is ~300 KB because `livekit-client` is inlined into the IIFE.
- No session persistence across navigations.
- No push-to-talk; the mic stays open for the whole session.
- Errors from `start()` propagate; callers must catch and display them.
```

- [ ] **Step 2: Commit**

```bash
git add packages/sdk/README.md
git commit -m "docs(sdk): add v0 README"
```

---

## Task 5: Rewrite extension popup HTML

**Files:**
- Modify: `packages/extension/src/popup.html`

**Why this task exists:** Today's popup has one Inject button. We need agent ID + API URL inputs and Start/Stop buttons so the popup can drive `window.Sable.start/stop` via the background worker.

- [ ] **Step 1: Replace `packages/extension/src/popup.html`**

Replace the file contents with:

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
        width: 280px;
      }
      h1 {
        font-size: 14px;
        margin: 0 0 8px;
      }
      label {
        display: block;
        font-size: 11px;
        color: #555;
        margin-top: 8px;
      }
      input {
        width: 100%;
        padding: 5px 6px;
        font: inherit;
        box-sizing: border-box;
      }
      .row {
        display: flex;
        gap: 6px;
        margin-top: 10px;
      }
      button {
        flex: 1;
        padding: 6px 8px;
        font-size: 13px;
        cursor: pointer;
      }
      #status {
        margin-top: 10px;
        font-size: 12px;
        color: #555;
        min-height: 1em;
        word-break: break-word;
      }
    </style>
  </head>
  <body>
    <h1>Sable (dev)</h1>
    <form id="sable-form">
      <label for="agent-id">Agent ID</label>
      <input id="agent-id" type="text" placeholder="agt_..." required />

      <label for="api-url">API URL</label>
      <input id="api-url" type="text" />

      <div class="row">
        <button type="submit" id="start-btn">Start</button>
        <button type="button" id="stop-btn">Stop</button>
      </div>
    </form>
    <div id="status"></div>
    <script src="popup.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add packages/extension/src/popup.html
git commit -m "feat(extension): popup form with agent id + api url + start/stop"
```

---

## Task 6: Rewrite extension popup script

**Files:**
- Modify: `packages/extension/src/popup.ts`

**Why this task exists:** The popup script must persist agent ID and API URL in `chrome.storage.local`, send typed `start`/`stop` messages to the background worker, and surface errors into the status div.

- [ ] **Step 1: Replace `packages/extension/src/popup.ts`**

Replace the file contents with:

```ts
/// <reference types="chrome" />

const DEFAULT_API_URL = "https://sable-api-gateway-9dfmhij9.wl.gateway.dev";

const form = document.getElementById("sable-form") as HTMLFormElement;
const agentInput = document.getElementById("agent-id") as HTMLInputElement;
const apiInput = document.getElementById("api-url") as HTMLInputElement;
const startBtn = document.getElementById("start-btn") as HTMLButtonElement;
const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;

interface StoredState {
  agentId?: string;
  apiUrl?: string;
}

async function loadStored(): Promise<void> {
  const { agentId, apiUrl } = (await chrome.storage.local.get([
    "agentId",
    "apiUrl",
  ])) as StoredState;
  if (agentId) agentInput.value = agentId;
  apiInput.value = apiUrl ?? DEFAULT_API_URL;
}

async function saveStored(): Promise<void> {
  await chrome.storage.local.set({
    agentId: agentInput.value,
    apiUrl: apiInput.value,
  });
}

function setStatus(msg: string): void {
  statusEl.textContent = msg;
}

function setBusy(busy: boolean): void {
  startBtn.disabled = busy;
  stopBtn.disabled = busy;
}

void loadStored();

agentInput.addEventListener("change", () => void saveStored());
apiInput.addEventListener("change", () => void saveStored());

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await saveStored();
  setBusy(true);
  setStatus("Starting…");
  try {
    const res = (await chrome.runtime.sendMessage({
      type: "start",
      agentId: agentInput.value,
      apiUrl: apiInput.value || DEFAULT_API_URL,
    })) as { ok: boolean; error?: string };
    if (res?.ok) {
      setStatus("Live. Talk to the agent. Check the page console for events.");
    } else {
      setStatus(`Error: ${res?.error ?? "unknown"}`);
    }
  } catch (err) {
    setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setBusy(false);
  }
});

stopBtn.addEventListener("click", async () => {
  setBusy(true);
  setStatus("Stopping…");
  try {
    const res = (await chrome.runtime.sendMessage({ type: "stop" })) as {
      ok: boolean;
      error?: string;
    };
    if (res?.ok) {
      setStatus("Stopped.");
    } else {
      setStatus(`Error: ${res?.error ?? "unknown"}`);
    }
  } catch (err) {
    setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setBusy(false);
  }
});
```

- [ ] **Step 2: Type-check the extension package**

Run from repo root: `bunx tsc --noEmit -p packages/extension/tsconfig.json`

Expected: no output (success). If the type checker complains about `chrome.storage`, ensure `@types/chrome` is still installed: `ls node_modules/@types/chrome`.

- [ ] **Step 3: Commit**

```bash
git add packages/extension/src/popup.ts
git commit -m "feat(extension): popup drives start/stop via background worker"
```

---

## Task 7: Rewrite extension background service worker

**Files:**
- Modify: `packages/extension/src/background.ts`

**Why this task exists:** The background worker must now handle two message types (`start`, `stop`), inject the SDK script tag idempotently, wait for `window.Sable` to be defined, and call `start`/`stop` in the page's main world.

**Critical detail:** every `executeScript` call that reads or calls `window.Sable` MUST pass `world: "MAIN"`. Without it the call runs in the extension's isolated world where `window.Sable` is `undefined`. This is the #1 MV3 scripting bug.

- [ ] **Step 1: Replace `packages/extension/src/background.ts`**

Replace the file contents with:

```ts
/// <reference types="chrome" />

/**
 * Background service worker for @sable-ai/extension (dev build).
 *
 * Handles two message types from the popup:
 *
 *   { type: "start", agentId, apiUrl } — idempotently inject the SDK
 *     script tag into the active tab (main world via web_accessible_resources),
 *     wait for `window.Sable` to appear, then call
 *     `window.Sable.start({agentPublicId, apiUrl})` in the main world.
 *
 *   { type: "stop" } — call `window.Sable.stop()` in the main world if the
 *     SDK is loaded. No-op otherwise.
 *
 * All "touch window.Sable" calls MUST pass world: "MAIN" to executeScript,
 * otherwise they run in the isolated world where Sable is undefined.
 */

interface StartMessage {
  type: "start";
  agentId: string;
  apiUrl: string;
}

interface StopMessage {
  type: "stop";
}

type IncomingMessage = StartMessage | StopMessage;

interface OkResponse {
  ok: true;
}
interface ErrResponse {
  ok: false;
  error: string;
}
type Response = OkResponse | ErrResponse;

async function getActiveTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("no active tab");
  }
  return tab.id;
}

async function injectSdkTag(tabId: number): Promise<void> {
  const sdkUrl = chrome.runtime.getURL("sable.iife.js");
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (url: string) => {
      const w = window as unknown as { Sable?: unknown };
      if (w.Sable) return; // already injected, skip
      const s = document.createElement("script");
      s.src = url;
      (document.head || document.documentElement).appendChild(s);
    },
    args: [sdkUrl],
  });
}

async function waitForSable(tabId: number): Promise<void> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () =>
      new Promise<boolean>((resolve) => {
        const deadline = Date.now() + 5000;
        const tick = () => {
          if ((window as unknown as { Sable?: unknown }).Sable) {
            resolve(true);
            return;
          }
          if (Date.now() > deadline) {
            resolve(false);
            return;
          }
          setTimeout(tick, 50);
        };
        tick();
      }),
  });
  if (!result?.result) {
    throw new Error("timed out waiting for window.Sable to load");
  }
}

async function callStart(
  tabId: number,
  agentId: string,
  apiUrl: string,
): Promise<void> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (agentPublicId: string, apiUrl: string) => {
      try {
        await (window as unknown as {
          Sable: {
            start(opts: { agentPublicId: string; apiUrl: string }): Promise<void>;
          };
        }).Sable.start({ agentPublicId, apiUrl });
        return { ok: true as const };
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
    args: [agentId, apiUrl],
  });
  const r = result?.result as { ok: true } | { ok: false; error: string } | undefined;
  if (!r) throw new Error("executeScript returned no result");
  if (!r.ok) throw new Error(r.error);
}

async function callStop(tabId: number): Promise<void> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async () => {
      const w = window as unknown as { Sable?: { stop(): Promise<void> } };
      if (!w.Sable) return { ok: true as const }; // nothing to stop
      try {
        await w.Sable.stop();
        return { ok: true as const };
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  });
  const r = result?.result as { ok: true } | { ok: false; error: string } | undefined;
  if (!r) throw new Error("executeScript returned no result");
  if (!r.ok) throw new Error(r.error);
}

async function handleStart(msg: StartMessage): Promise<void> {
  const tabId = await getActiveTabId();
  await injectSdkTag(tabId);
  await waitForSable(tabId);
  await callStart(tabId, msg.agentId, msg.apiUrl);
}

async function handleStop(): Promise<void> {
  const tabId = await getActiveTabId();
  await callStop(tabId);
}

chrome.runtime.onMessage.addListener(
  (msg: IncomingMessage, _sender, sendResponse: (r: Response) => void) => {
    if (msg?.type === "start") {
      handleStart(msg).then(
        () => sendResponse({ ok: true }),
        (err: unknown) =>
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
      );
      return true; // async response
    }
    if (msg?.type === "stop") {
      handleStop().then(
        () => sendResponse({ ok: true }),
        (err: unknown) =>
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
      );
      return true; // async response
    }
    return false;
  },
);
```

- [ ] **Step 2: Type-check the extension package**

Run from repo root: `bunx tsc --noEmit -p packages/extension/tsconfig.json`

Expected: no output (success).

- [ ] **Step 3: Build the extension**

Run from repo root (requires SDK dist from Task 2): `bun run --filter @sable-ai/extension build`

Expected: `packages/extension/dist/` contains `manifest.json`, `background.js`, `popup.html`, `popup.js`, `sable.iife.js`. Verify with `ls packages/extension/dist/`.

- [ ] **Step 4: Commit**

```bash
git add packages/extension/src/background.ts
git commit -m "feat(extension): background handles start/stop via executeScript world:MAIN"
```

---

## Task 8: Update `packages/extension/README.md`

**Files:**
- Modify: `packages/extension/README.md`

**Why this task exists:** The README's current test steps are for the v0 "click Inject, see console log" flow. Replace them with the new Start/Stop flow and document the localhost-only CORS limitation prominently so future testers don't waste time trying to inject on arbitrary sites.

- [ ] **Step 1: Replace `packages/extension/README.md`**

Replace the file contents with:

```markdown
# @sable-ai/extension (dev build)

Local-only Chrome MV3 extension that injects `@sable-ai/sdk` into the current
tab and starts a voice session with a dispatched agent worker.

## Build

From the repo root:

```bash
bun install
bun run --filter @sable-ai/sdk build
bun run --filter @sable-ai/extension build
```

This produces `packages/extension/dist/` with `manifest.json`, `background.js`,
`popup.html`, `popup.js`, and `sable.iife.js`.

## Load in Chrome

1. Open `chrome://extensions`
2. Toggle **Developer mode** on (top right)
3. Click **Load unpacked**
4. Select `packages/extension/dist`
5. Pin the Sable (dev) extension for convenience

## Test the voice session

**Important: this v0 build only works on `http://localhost:*` tabs.** The
sable-api CORS policy does not yet allow arbitrary origins, so injecting into
`example.com` or any non-withsable site will fail the `/connection-details`
fetch. Open a local test page first.

1. Serve the SDK's local test page:

```bash
python3 -m http.server 5173 --directory packages/sdk/examples
```

2. Open `http://localhost:5173/test.html` in Chrome. Open DevTools → Console.
3. Click the Sable toolbar icon. In the popup, paste an agent public ID
   (e.g. `agt_...`). The API URL defaults to the production sable-api gateway.
4. Click **Start**. Grant mic permission on the first run.
5. Expect in the page console:
   - `Sable SDK loaded 0.0.2`
   - `[Sable] fetching connection details`
   - `[Sable] ConnectionStateChanged connecting`
   - `[Sable] ConnectionStateChanged connected`
   - `[Sable] TrackSubscribed` when the agent publishes its voice
   - `[Sable] session live { roomName, participantName }`
6. Talk to the agent; you should hear it respond.
7. Click **Stop** → `[Sable] session ended`.

## Iterating

After editing source files:

```bash
bun run --filter @sable-ai/sdk build
bun run --filter @sable-ai/extension build
```

Then in `chrome://extensions`, click the **Reload** icon on the Sable card.
Background service workers don't auto-reload on file changes.

## Troubleshooting

- **`Error: connection-details failed: 0` or a CORS message in the page
  console**: you're on a non-localhost origin. See the "Important" note above.
- **`Error: timed out waiting for window.Sable to load`**: the SDK bundle
  failed to load. Check the page DevTools Network tab for a failed request to
  `chrome-extension://<id>/sable.iife.js`, and verify `web_accessible_resources`
  in `manifest.json` lists it.
- **`Could not establish connection`** in the popup: the background service
  worker was idle and got torn down. Re-click the toolbar icon to respawn it.
- **Mic prompt doesn't appear**: you're probably on `http://127.0.0.1` or
  `http://0.0.0.0`. Chrome only treats literal `localhost` as a secure
  context for some APIs. Use `http://localhost:5173`.
- **Nothing happens on click**: make sure DevTools is attached to the *page*,
  not the extension popup. Right-click the popup → Inspect for popup logs.
- **`chrome://` pages**: extensions can't inject into Chrome's internal pages.
  Use a normal http(s) page.
```

- [ ] **Step 2: Commit**

```bash
git add packages/extension/README.md
git commit -m "docs(extension): rewrite test steps for v0 voice session"
```

---

## Task 9: Full verification

**Files:** none modified

**Why this task exists:** Before handing the PR off for manual e2e, verify the whole repo builds + type-checks + tests cleanly from a clean state.

- [ ] **Step 1: Clean and reinstall**

Run from repo root: `bun install`

Expected: no errors. `node_modules/livekit-client` exists.

- [ ] **Step 2: Type-check both packages**

Run from repo root:

```bash
bunx tsc --noEmit -p packages/sdk/tsconfig.json && bunx tsc --noEmit -p packages/extension/tsconfig.json
```

Expected: no output, exit code 0.

- [ ] **Step 3: Run unit tests**

Run from repo root: `bun test`

Expected: `1 pass, 0 fail` (the `VERSION === "0.0.2"` pin).

- [ ] **Step 4: Build both packages**

Run from repo root:

```bash
bun run --filter @sable-ai/sdk build && bun run --filter @sable-ai/extension build
```

Expected: both builds succeed. `ls packages/extension/dist/` shows `background.js`, `popup.html`, `popup.js`, `manifest.json`, `sable.iife.js`.

- [ ] **Step 5: Verify SDK bundle contains `livekit-client`**

Run from repo root: `grep -l "livekit" packages/sdk/dist/sable.iife.js`

Expected: the file path prints (indicating `livekit-client` was inlined). If grep returns nothing, the dynamic import didn't get bundled — re-check `packages/sdk/package.json`'s `build` script and ensure `livekit-client` is in `dependencies`.

- [ ] **Step 6: Manual e2e (driven by the human reviewer, not the agent)**

Document in the PR body:

1. Serve the test page: `python3 -m http.server 5173 --directory packages/sdk/examples`
2. Open `http://localhost:5173/test.html` in Chrome, open DevTools console
3. Paste agent ID `agt_JWRPzUynWvhxnApo7KnkU` (or any other dispatched agent), click Start
4. Grant mic permission
5. Expect the session-live log and a TrackSubscribed for the agent's audio
6. Talk to the agent; verify a response
7. Click Stop → session-ended log
8. Repeat via the extension: load unpacked from `packages/extension/dist`, open the same localhost tab, click the extension icon, enter the same agent ID, click Start → same behavior

- [ ] **Step 7: Final status check**

Run: `git status`

Expected: working tree clean. All changes committed.

---

## Rollback

If anything about Tasks 1-8 needs to be reverted without losing subsequent work: each task corresponds to exactly one commit. `git revert <sha>` the offending commit. Task 2 is the only one that creates cross-task dependencies (Tasks 6, 7, 9 all require the new SDK shape) — reverting it forces a revert of 6, 7, 9.
