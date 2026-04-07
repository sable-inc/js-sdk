# SDK Voice Integration (v0) — Design

**Date:** 2026-04-07
**Status:** Draft, pending implementation plan
**Repos affected:** `js-sdk` only
**Builds on:** [2026-04-07-extension-sdk-injection-design.md](./2026-04-07-extension-sdk-injection-design.md) — the extension + SDK-injection plumbing landed in `feat/extension-mv3-injection`.
**Next step toward:** [2026-04-06-sdk-extension-userbrowserbridge-design.md](./2026-04-06-sdk-extension-userbrowserbridge-design.md) — the full SDK + `UserBrowserBridge` architecture.

## Goal

Calling `window.Sable.start({ agentPublicId })` on any `http://localhost:*` page joins a LiveKit room, publishes the user's microphone, and connects to a running agent worker. The user can talk to the agent. That is the entire feature.

`window.Sable.stop()` disconnects cleanly.

## Why this scope

First level of integration between the SDK and `sable-agentkit`. Voice only, local only, no UI, no DOM tools, no RPC handlers. The minimum that proves the SDK can actually *do* something with an agent. Every excluded piece becomes its own followup PR.

## Non-goals

- DOM tools / RPC handlers (`sable.click`, `sable.getDomState`, `sable.highlight`, ...)
- Wireframe capture
- Shadow-DOM UI overlay (orb, PTT button, agent cursor, highlight boxes)
- Push-to-talk state machine — mic is on for the full session
- Agent-speaking / agent-listening callbacks or an events API
- `UserBrowserBridge` or any change on the Python side of `sable-agentkit`
- API keys, per-org allowed-origins, origin authorization
- Testing the extension on arbitrary internet pages (`example.com`, `github.com`, etc.) — only `http://localhost:*` works in this PR
- Session reattach across navigations
- Publishing `@sable-ai/sdk` to npm
- Self-install `<script>` tag documentation for customer sites

## Architecture

```text
┌──────────── page (http://localhost:5173) ────────────┐
│                                                        │
│  <script src="./sable.iife.js">                       │
│  window.Sable = { start, stop, version }              │
│                                                        │
│  Sable.start({ agentPublicId, apiUrl? })              │
│    ├─ fetch(`${apiUrl}/connection-details?...`)       │
│    ├─ await import("livekit-client")                  │
│    ├─ Room.connect(serverUrl, token)                  │
│    └─ localParticipant.setMicrophoneEnabled(true)     │
└────────────────────────┬───────────────────────────────┘
                         │ WebRTC: audio up, audio down
                         ▼
                  LiveKit Cloud
                         │
                         ▼
           existing sable-agentkit worker
           (dispatched by sable-api, unchanged)
```

The agent worker is unchanged. Whatever it normally does for the studio's `TestAgentModal` it will do for us — dispatch via `RoomAgentDispatch`, boot with its default (Nickel) browser bridge, handle voice. From the agent's perspective this session is indistinguishable from a studio test session.

## Constraints that shaped the design

- **`sable-api` CORS allows `http://localhost:*` and `*.withsable.com` only** (`sable-app/services/sable-api/src/app.ts:44`). The SDK can call `/connection-details` directly from a localhost page with no sable-app change. From `example.com` the browser would block the response, so that path is out of scope.
- **`sable-api` is publicly reachable at `https://sable-api-gateway-9dfmhij9.wl.gateway.dev`** (Google Cloud API Gateway). We hardcode this as the SDK's default `apiUrl`.
- **Parley's `/api/connection-details` is a BFF forwarder** that proxies to sable-api. We do not call it. The SDK calls sable-api directly so it isn't coupled to parley's lifecycle.
- **`/connection-details` is public by design** (no auth middleware — `sable-api/src/routes/connection-details.ts:15`). An `agentPublicId` plus an allowed CORS origin is enough to dispatch an agent. Opaque IDs are the only gate for v0.

## Components

### 1. `@sable-ai/sdk` — real behavior

**File:** `packages/sdk/src/index.ts` (replaces today's console.log-only stub)

**Public surface:**

```ts
export const VERSION = "0.0.2";

interface StartOpts {
  agentPublicId: string;
  apiUrl?: string;        // default: "https://sable-api-gateway-9dfmhij9.wl.gateway.dev"
  nickelRegion?: string;  // optional; forwarded to /connection-details
}

interface SableAPI {
  version: string;
  start(opts: StartOpts): Promise<void>;
  stop(): Promise<void>;
}

declare global {
  interface Window {
    Sable?: SableAPI;
  }
}
```

The IIFE no longer auto-connects on load. It installs `window.Sable` and logs `Sable SDK loaded 0.0.2`.

**`start(opts)` flow:**

1. If a session is already live → throw `Error("Sable already started; call stop() first")`. No silent reuse.
2. Build URL: `${apiUrl}/connection-details?agentPublicId=${encodeURIComponent(agentPublicId)}`. Append `&nickelRegion=...` if provided.
3. `fetch(url)`. On non-2xx, throw `Error(\`connection-details failed: ${status} ${body}\`)`.
4. Parse `{ serverUrl, roomName, participantToken, participantName }` from JSON.
5. Lazy-import: `const { Room, RoomEvent } = await import("livekit-client")`. Keeps the entry logic out of the top-level load path and matches the bigger spec's eventual "tiny entry, lazy chunks" shape — even though bun will inline it for v0.
6. `const room = new Room()`.
7. Wire observability handlers (`console.log` only, no events API):
   - `RoomEvent.ConnectionStateChanged` → log state
   - `RoomEvent.Disconnected` → log reason, clear singleton
   - `RoomEvent.ParticipantConnected` → log participant identity
   - `RoomEvent.TrackSubscribed` → log track kind + source
   - `RoomEvent.TrackUnsubscribed` → log
8. `await room.connect(serverUrl, participantToken)`.
9. `await room.localParticipant.setMicrophoneEnabled(true)` — triggers the browser's mic permission prompt on first use.
10. Store `room` on a module-level singleton so `stop()` can find it.
11. `console.log("Sable session live", { roomName, participantName })`.

**`stop()` flow:**

1. If no live session → no-op. Do not throw.
2. `await room.localParticipant.setMicrophoneEnabled(false)`.
3. `await room.disconnect()`.
4. Clear the singleton.
5. `console.log("Sable session ended")`.

**Errors propagate.** No try/catch inside `start()` swallows errors; callers (popup or test page) are responsible for rendering them.

**Observability is console-only.** No event emitter, no callbacks. If voice works, the console will show the track subscription and audio I/O happens.

**Dependencies added to `packages/sdk/package.json`:**

- `livekit-client` as a dependency. Version matched to what parley uses (`pnpm list livekit-client` in parley during implementation). Dynamically imported; bun will inline it into the IIFE.

**Bundle size:** `sable.iife.js` grows from <1 KB to ~300 KB (livekit-client is ~250 KB minified). Explicitly acceptable — tiny-entry + lazy chunks is a follow-up optimization.

### 2. `packages/sdk/examples/test.html` (new)

A standalone HTML page that serves as both the local test harness and the canonical example. Structure:

```html
<!doctype html>
<html>
<body>
  <h1>Sable SDK test</h1>
  <form id="sable-form">
    <label>Agent ID <input id="agent-id" placeholder="agt_..." required /></label>
    <label>API URL <input id="api-url" value="https://sable-api-gateway-9dfmhij9.wl.gateway.dev" /></label>
    <button type="submit">Start</button>
    <button type="button" id="stop-btn">Stop</button>
  </form>
  <pre id="status"></pre>
  <script src="../dist/sable.iife.js"></script>
  <script>
    // Minimal wiring: submit → Sable.start(...); stop-btn → Sable.stop()
    // Any error → dump into #status.
    // Persists agent id in localStorage so reloads don't re-prompt.
  </script>
</body>
</html>
```

Served via `python3 -m http.server 5173 --directory packages/sdk/examples` or `bunx serve`. Chrome treats `http://localhost` as a secure context, so mic permissions work.

### 3. `@sable-ai/extension` — popup + background rewire

**`packages/extension/src/popup.html`** — replace the single Inject button:

```html
<form id="sable-form">
  <label>Agent ID <input id="agent-id" type="text" placeholder="agt_..." required /></label>
  <label>API URL <input id="api-url" type="text" /></label>
  <button type="submit" id="start-btn">Start</button>
  <button type="button" id="stop-btn">Stop</button>
</form>
<div id="status"></div>
```

**`packages/extension/src/popup.ts`:**

1. On DOMContentLoaded: read `agentId` and `apiUrl` from `chrome.storage.local`; populate inputs. Default `apiUrl` to the gateway URL if unset.
2. On input `change`: write back to `chrome.storage.local`.
3. On form submit: `chrome.runtime.sendMessage({ type: "start", agentId, apiUrl })`. Show `Starting…`. On response: `Live` or `Error: <msg>`.
4. On Stop click: `chrome.runtime.sendMessage({ type: "stop" })`. Show `Stopping…` → `Stopped`.

**`packages/extension/src/background.ts`** — two message handlers:

```ts
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "start") {
    handleStart(msg.agentId, msg.apiUrl).then(
      (r) => sendResponse({ ok: true, ...r }),
      (e) => sendResponse({ ok: false, error: e.message }),
    );
    return true;
  }
  if (msg.type === "stop") {
    handleStop().then(
      () => sendResponse({ ok: true }),
      (e) => sendResponse({ ok: false, error: e.message }),
    );
    return true;
  }
});
```

**`handleStart(agentId, apiUrl)` flow:**

1. Get the active tab via `chrome.tabs.query({ active: true, currentWindow: true })`.
2. **Inject the SDK script tag into the main world** (existing v0 logic, made idempotent):
   ```ts
   await chrome.scripting.executeScript({
     target: { tabId },
     func: (sdkUrl) => {
       if ((window as any).Sable) return; // already injected
       const s = document.createElement("script");
       s.src = sdkUrl;
       (document.head || document.documentElement).appendChild(s);
     },
     args: [chrome.runtime.getURL("sable.iife.js")],
   });
   ```
3. **Poll for `window.Sable` in the main world** (up to 5s, 50ms interval):
   ```ts
   await chrome.scripting.executeScript({
     target: { tabId },
     world: "MAIN",
     func: () => new Promise<boolean>((r) => {
       const deadline = Date.now() + 5000;
       const tick = () => {
         if ((window as any).Sable) return r(true);
         if (Date.now() > deadline) return r(false);
         setTimeout(tick, 50);
       };
       tick();
     }),
   });
   ```
4. **Call `window.Sable.start(...)` in the main world:**
   ```ts
   await chrome.scripting.executeScript({
     target: { tabId },
     world: "MAIN",
     func: (agentId, apiUrl) =>
       (window as any).Sable.start({ agentPublicId: agentId, apiUrl }),
     args: [agentId, apiUrl],
   });
   ```
5. Surface any thrown error back to the popup.

**`handleStop()` flow:** same pattern — `chrome.scripting.executeScript` with `world: "MAIN"` calling `window.Sable.stop()`. No-op if the SDK isn't loaded.

**Critical detail — `world: "MAIN"`:** the script tag loaded via step 2 runs in the page's main world (that's how `<script src>` works), so `window.Sable` lives in the main world. Any subsequent `executeScript` that touches `window.Sable` MUST pass `world: "MAIN"`; otherwise it runs in the extension's isolated world where `Sable` is undefined. This is the single most common MV3 scripting bug; calling it out so future-us doesn't burn an hour on it.

**Manifest changes:** none. `"scripting"` permission is already there. `web_accessible_resources` already exposes `sable.iife.js`. No new `host_permissions` because we're only hitting `localhost:*` tabs, and `activeTab` covers injection.

## Build / distribution

- **`packages/sdk`:**
  - `scripts.build`: `bun build src/index.ts --outfile dist/sable.iife.js --format=iife --target=browser`
  - Bun inlines `livekit-client` automatically.
- **`packages/extension`:**
  - Build script unchanged in shape — clean, bundle `background.ts` + `popup.ts`, copy `manifest.json` + `popup.html` + `../sdk/dist/sable.iife.js` into `dist/`.
- **`bun test`** and **`bunx tsc --noEmit`** (in both packages) still pass.

## Tests

### Automated

- `packages/sdk/src/index.test.ts`: keep the single pinning assertion, bumped to `VERSION === "0.0.2"`.
- **No new unit tests.** The value under test is "connects to LiveKit and passes audio," which is inherently end-to-end. Mocking `Room.connect()` would test our own call sequence back at us.

### Manual e2e (per PR body)

1. `bun install && bun run --filter @sable-ai/sdk build && bun run --filter @sable-ai/extension build`
2. Serve the example: `python3 -m http.server 5173 --directory packages/sdk/examples`
3. Open `http://localhost:5173/test.html` in Chrome. Open DevTools console.
4. Enter a real agent ID (e.g., `agt_JWRPzUynWvhxnApo7KnkU`), click Start. Grant mic permission.
5. Expect in console: `Sable session live { roomName, ... }`, `TrackSubscribed` for the agent's audio track. Talking produces an agent response.
6. Click Stop → `Sable session ended`.
7. Load the extension in `chrome://extensions` (Developer mode → Load unpacked → `packages/extension/dist`). Open the same `localhost:5173/test.html` tab. Open the popup, fill agent ID, click Start → same behavior through the extension path.

## Documentation

- **`packages/sdk/README.md`** (new, ~30 lines): minimal usage example, `StartOpts` shape, `stop()`, note about the gateway URL default.
- **`packages/extension/README.md`** (updated): replace the "click Inject, see console log" test steps with the new Start/Stop flow. Note that only `http://localhost:*` tabs work in v0.
- **No updates** to the repo-root `README.md`.

## Risks / known limitations

1. **CORS limits local testing.** Only `http://localhost:*` origins reach `sable-api`. Extension injection on `example.com` or any non-withsable page will fail the `fetch("/connection-details")` call. Documented as an explicit non-goal; followup PR adds per-org allowed-origins.
2. **Bundle size** jumps from <1 KB to ~300 KB because `livekit-client` is inlined. Acceptable for v0. Tiny-entry + lazy-chunk split is a follow-up.
3. **No session persistence across navigations.** Clicking a link or reloading kills the SDK and (after the 5s LK grace window) the agent worker. Re-click Start.
4. **No stale-session detection.** Starting sessions on two tabs against the same agent spins up two agent workers. Not prevented.
5. **`nickelRegion`** is exposed on `StartOpts` but has no UI in the popup. Omitted calls use the agent's default region.
6. **Service worker cold start** in MV3 is absorbed naturally: the SDK's state lives in the page's main-world `window.Sable`, not in the background worker, so the worker can be torn down and respawned freely.
7. **`world: "MAIN"` trap**: every `executeScript` call that touches `window.Sable` must specify `world: "MAIN"`. Default is ISOLATED and the symptom is a silent `Cannot read properties of undefined`.
8. **Secure-context requirement for mic:** only `http://localhost` (literal) is a secure context. Using `127.0.0.1` or `0.0.0.0` may not be. The docs tell users to use `localhost`.

## What this design does NOT do

- No DOM tools, no RPC, no wireframe, no visible UI
- No customer-facing self-install docs
- No sable-app changes
- No parley changes
- No `@sable-ai/sdk` publish to npm
- No new test framework or e2e harness

Each belongs to a subsequent PR that builds on this one.

## Open questions

None blocking. Everything above is confirmed in brainstorming.
