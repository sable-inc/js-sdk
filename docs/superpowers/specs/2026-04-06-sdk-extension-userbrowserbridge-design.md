# SDK + Extension + UserBrowserBridge — Design

**Date:** 2026-04-06
**Status:** Draft, pending implementation plan
**Repos affected:** `js-sdk`, `sable-agentkit`, `sable-app`

## Context

Today's `site-preview` reverse proxy injects the SDK into customer pages by rewriting HTML through Caddy + a Cloudflare Worker. It works for visual demos but **OAuth login is broken**: providers like Google refuse to redirect through a proxy domain. This blocks any product flow that requires sign-in, which is most of them.

The fix is structural: stop proxying. Run the SDK directly inside the user's real browser via two delivery mechanisms:

1. A **Chrome extension** that injects the SDK into any page (for internal/early users on sites they don't own).
2. A **self-install** path (`<script>` tag or `import`) for customers embedding on their own sites.

In both cases the SDK joins a LiveKit room and exposes the page's DOM/actions to the agent worker via LiveKit RPC. The agent worker reuses everything from `sable-agentkit` — the agent loop, tool definitions, action types, Northstar element resolution. The only thing that changes is **how the agent reaches the browser**: instead of a Nickel virtual browser over Playwright/CDP, it talks to the user's real browser through RPC over the existing LK data channel.

This requires extracting an abstract `BrowserBridge` interface from today's `BrowserComponent` so that nickel and user-browser are two interchangeable implementations of the same contract.

## Goals

- Agent works in the user's real browser, with real cookies and real login state
- Zero new infrastructure (reuse LiveKit Cloud, sable-app, agentkit worker pool)
- Anything Nickel can do, the user-browser bridge can do (or fails explicitly)
- Self-install in two lines: a script tag and `Sable.start({ apiKey })`
- Tiny entry bundle (~1 KB) so embedding is effectively free; everything else is dynamically imported

## Non-goals (v1)

- Editor / tour authoring UI
- Document Picture-in-Picture (deferred to v1.1)
- Firefox / Safari extension
- Custom theming API
- React/Vue/Svelte adapters
- Usage metering or billing
- Public Chrome Web Store release
- The `Evaluate` action in user browser (security footgun in customer pages)
- Cross-origin navigation continuity for self-install (extension handles this; self-install gracefully ends)
- Recording / replay
- Multi-tab session sharing
- Auth on the extension (paste API key for now)

## Architecture

### High-level topology

```
┌─────────────────────────────────────────────────────────┐
│  User's real browser (Chrome tab on customer.com)       │
│                                                          │
│   ┌────────────────────┐    ┌──────────────────────┐    │
│   │ Extension (MV3)    │    │ @sable-ai/sdk        │    │
│   │  - content script  │───▶│  - LK client          │    │
│   │  - injects sdk     │    │  - wireframe          │    │
│   │  - PTT/orb overlay │    │  - RPC handlers       │    │
│   └────────────────────┘    │  - cursor/highlight   │    │
│                              └──────┬───────────────┘    │
└─────────────────────────────────────┼───────────────────┘
                                      │ WebRTC (LK Cloud)
                                      │ audio + data channel
                                      ▼
                              ┌───────────────┐
                              │  LiveKit Cloud │
                              └───────┬───────┘
                                      │
                                      ▼
                ┌─────────────────────────────────────┐
                │  sable-agentkit worker (k8s)        │
                │   Agent (stateful brain)            │
                │    └─ BrowserComponent              │
                │        └─ UserBrowserBridge ◀─────┐ │
                │           (RPC to SDK)            │ │
                │    [or NickelBrowserBridge ──────┘]│
                └─────────────────────────────────────┘
                                      │
                                      ▼
                              POST /api/sessions/embed
                              (sable-app dispatches agent)
```

The data channel that already exists for LiveKit voice carries our RPC. No second connection.

### Stateful brain, stateless runtime

- **Agent worker** holds knowledge base, conversation context, customer feature awareness, vision, and reasoning. It is the brain.
- **SDK** in the user's browser is a stateless runtime that exposes a fixed set of tools (click, type, highlight, getDomState, etc.). It carries no business logic.

This split is what makes reattach feasible — the SDK can be torn down and respawned mid-session and the agent doesn't notice.

## Components

### 1. `BrowserBridge` refactor (`sable-agentkit`)

Today's `BrowserComponent` does three things in one class: lifecycle (claim nickel + Playwright over CDP), state capture (`VisibleDOM`, `BrowserStream`), and action execution (Playwright locators). All three assume nickel.

**Refactor:** Extract an abstract `BrowserBridge` interface. `BrowserComponent` becomes a thin orchestrator that owns the tool list, action queue, retry logic, and LLM-facing surface, but delegates "how do I actually touch a browser" to a bridge.

```python
class BrowserBridge(ABC):
    @abstractmethod
    async def connect(self) -> None: ...
    @abstractmethod
    async def disconnect(self) -> None: ...
    @abstractmethod
    async def wait_until_ready(self) -> None: ...
    @abstractmethod
    async def get_dom_state(self) -> DomState: ...
    @abstractmethod
    async def get_url(self) -> str: ...
    @abstractmethod
    async def get_viewport(self) -> Viewport: ...
    @abstractmethod
    async def execute_action(self, action: Action) -> ActionResult: ...
```

`Action` and `ActionResult` are the **existing** dataclasses, unchanged. That contract keeps the agent loop bridge-agnostic.

#### Implementations

- **`NickelBrowserBridge`** — today's logic, mechanically extracted. PlaywrightSession over CDP, VisibleDOM injection, BrowserStream for frames.
- **`UserBrowserBridge`** — new. Holds an LK participant handle. Each method is a one-liner over `participant.perform_rpc("sable.*", ...)`.

```python
async def execute_action(self, action: Action) -> ActionResult:
    payload = action_to_dict(action)
    result = await self._participant.perform_rpc(
        method=f"sable.{action.kind}",
        payload=json.dumps(payload),
        response_timeout=10.0,
    )
    return ActionResult.from_dict(json.loads(result))

async def get_dom_state(self) -> DomState:
    result = await self._participant.perform_rpc("sable.getDomState", "{}")
    data = json.loads(result)
    return DomState(
        screenshot=base64.b64decode(data["screenshot"]),
        elements=[Element.from_dict(e) for e in data["elements"]],
        url=data["url"],
    )
```

#### Bridge selection

Happens in `component_factory.build_components()`:

```python
if job_metadata.get("bridge") == "user_browser":
    bridge = UserBrowserBridge(room=ctx.room, participant_identity="user-browser")
else:
    bridge = NickelBrowserBridge(nickel_pool=...)
component = BrowserComponent(bridge=bridge, ...)
```

Existing nickel callers don't pass `bridge` → default behavior unchanged.

#### Action coverage matrix

| Action | Nickel | UserBrowser | Notes |
|---|---|---|---|
| Click | ✅ | ✅ | SDK does `el.click()` |
| Hover | ✅ | ✅ | SDK dispatches `mouseover` |
| Type / CharKey | ✅ | ✅ | SDK uses `InputEvent` |
| Clear | ✅ | ✅ | |
| HighlightBox / HighlightText | ✅ | ✅ | SDK draws overlay div |
| ShowCursor / HideCursor | ✅ | ✅ | SDK draws cursor div |
| CenterScroll | ✅ | ✅ | `scrollIntoView({block:'center'})` |
| Navigate | ✅ | ⚠️ same-origin only | Cross-origin → `NotSupportedOnUserBrowser` |
| Drag | ✅ | ✅ | |
| SelectText | ✅ | ✅ | `Selection` API |
| Evaluate | ✅ | ❌ | Disabled in user browser; cookie/data exfil risk |

#### Frames

Screenshot-on-demand RPC for v1: agent calls `sable.getDomState`, SDK runs wireframe (~126ms on M5 Pro), returns base64 PNG. Agents call this 1–3x per turn. We can swap to a continuous video track later without changing the agent loop because both produce the same `DomState`.

### 2. `js-sdk` packages

Existing repo at `sable-inc/js-sdk` (`/Users/marcoscandeia/workspace/js-sdk`). Bun workspace, TypeScript with `tsc --noEmit` for type checking.

**Existing local packages:**
- `@sable/sdk-ui` — empty stub in the repo today, will be removed in favor of `@sable-ai/ui`

**Existing published packages on npm under `@sable-ai`** (all published 7–8 months ago by `leon@withsable.com`, predate LiveKit/`sable-agentkit`):
- `@sable-ai/core@0.1.6` — 210 KB, no deps, "shared types and utilities". Will be republished as `1.0.0` with our content.
- `@sable-ai/react@0.1.31` — 2 MB, uses `ultravox-client`, depends on `@sable-ai/core@^0.1.6`. **Not touched** (earlier voice-stack iteration; future React adapter for our SDK is a separate decision).
- `@sable-ai/text-agent@0.1.4` — uses `ultravox-client`. **Not touched** (obsolete; the agent now lives in Python in `sable-agentkit`).
- `@sable-ai/voice-agent@0.1.0` — uses `ultravox-client`. **Not touched** (same reason).

**Republishing safety:** the three other packages pin `@sable-ai/core@^0.1.x`. Caret on a 0.x version is locked to that minor — they will NOT auto-upgrade to `1.0.0`. Publishing `@sable-ai/core@1.0.0` with our content is dependency-safe for any code currently installing the old stack.

**This work creates/touches:**
- `@sable-ai/core` *(republish, major version bump)* — LK room join, RPC plumbing, wireframe, DOM state, action handlers. Connection and action layers are tightly coupled (RPC handlers *are* action handlers), so they live together. Republishing is acceptable per product decision; existing consumers (if any) of the old `core` are not load-bearing.
- `@sable-ai/ui` *(new)* — Orb, PTT button, agent cursor, highlight overlays, all inside Shadow DOM. Replaces the local `@sable/sdk-ui` stub.
- `@sable-ai/sdk` *(new)* — Thin top-level orchestrator. ~1 KB entry. Exposes `Sable.start/stop/on`. Dynamically imports `core` and `ui` on first call. The only package customers ever import.
- `@sable-ai/extension` *(new)* — Chrome MV3 extension.

**Package namespace migration:** The local `@sable/*` package(s) in the repo get renamed to `@sable-ai/*` (the `@sable` npm scope is taken; `@sable-ai` is owned by us). Done as part of this work.

**Not touched:** `nickel-ts-lib` already exists as `sable-inc/nickel-ts-lib` at `../nickel/nickel-ts-lib`. Out of scope.

#### Public API (`@sable-ai/sdk`)

```ts
import { Sable } from "@sable-ai/sdk";

await Sable.start({
  appUrl: "https://app.sable.com",
  apiKey: "pk_live_...",
  ui: "default",   // "default" | "headless"
});

Sable.on("ready", () => {});
Sable.on("agent-speaking", (transcript) => {});
Sable.on("end", () => {});

await Sable.stop();
```

That is the entire surface.

#### Tiny loader

```ts
// @sable-ai/sdk entry — must stay <1.5 KB gzipped
export const Sable = {
  async start(opts: StartOpts) {
    const { startSession } = await import("@sable-ai/core");
    return startSession(opts);
  },
  async stop() {
    const { stopSession } = await import("@sable-ai/core");
    return stopSession();
  },
  on(event, handler) { events.on(event, handler); },
};
```

A build-time size assertion fails CI if the entry exceeds 1.5 KB gzipped.

#### RPC handlers (the inverse of `UserBrowserBridge`)

```ts
room.localParticipant.registerRpcMethod("sable.getDomState", async () => {
  const { canvas, elements } = await captureWireframe(document.body);
  return JSON.stringify({
    screenshot: canvas.toDataURL("image/png").split(",")[1],
    elements,
    url: location.href,
  });
});

room.localParticipant.registerRpcMethod("sable.click", async (data) => {
  const { id } = JSON.parse(data.payload);
  const el = elementRegistry.get(id);
  if (!el) return JSON.stringify({ ok: false, error: "stale" });
  el.scrollIntoView({ block: "center" });
  el.click();
  return JSON.stringify({ ok: true });
});
```

`elementRegistry` is a Map populated during each `getDomState` capture, mapping ids to DOM nodes. The id space resets per capture. Stale ids return `ok: false, error: "stale"` and the agent loop knows to re-snapshot.

#### wireframe extension

Today `wireframe.js` (in `context/assets/wireframe.js`, ~474 lines) draws boxes and text on a canvas but **does not export the element list**. We extend it minimally — collect elements during the existing classification pass instead of throwing them away. No second walk. Cost should stay around the existing ~126ms.

```ts
class Wireframe {
  capture(): {
    canvas: HTMLCanvasElement;
    elements: WireframeElement[];
    elapsed: number;
  }
}

interface WireframeElement {
  id: number;            // monotonic, restarts each capture
  type: "button" | "link" | "input" | "heading" | "text" | "image" | "nav" | "block";
  label: string;         // visible text or aria-label or alt
  bbox: { x: number; y: number; w: number; h: number };
  // _node stays SDK-side, never serialized
}
```

The agent only sees `{id, type, label, bbox}`. The DOM node lives in `elementRegistry`.

#### PTT state machine

Direct port of parley's `usePushToTalk.ts` (`/Users/marcoscandeia/workspace/parley/src/features/agent/hooks/usePushToTalk.ts`) to vanilla TS. Hybrid: spacebar + click-and-hold, 200ms threshold. Short tap = toggle, long hold = push-to-talk. Spacebar handler does NOT preventDefault on keydown when target is an input (so typing works). Window blur force-mutes.

Calls `room.localParticipant.setMicrophoneEnabled(...)` directly. No React. The orb subscribes to LK's `TrackMuted`/`TrackUnmuted` events for visual state.

Parley code may be partially reusable for future extraction — eventually parley itself could become a consumer of `@sable-ai/sdk`. **Out of scope for v1.** Start simple; extract later.

#### UI surface (Shadow DOM)

Everything visible — orb, PTT button, cursor, highlights — lives inside a single `<sable-root>` custom element with attached Shadow DOM. Customer CSS can't bleed in; ours can't bleed out; single node to clean up on `Sable.stop()`.

`// TODO(theme):` comments at every place a future theming API would hook in (color tokens, sizing, position).

#### Build / distribution

- Bun bundling, `tsc --noEmit` in CI for type safety
- `@sable-ai/sdk` produces:
  - `dist/sable.esm.js` — for `import { Sable } from "@sable-ai/sdk"`
  - `dist/sable.iife.js` — for `<script src="https://cdn.sable.com/sdk/v1/sable.js">`
- Both are ~1.5 KB gzipped entry; chunks lazy-load on `start()`

### 3. `@sable-ai/extension` (Chrome MV3)

Same monorepo. Two jobs, ranked:

1. **Primary**: Let internal/early users experience the SDK on **any** site without that site installing it.
2. **Secondary (future)**: Editor mode for authoring tours/flows. Out of scope for v1, but architecture shouldn't make it harder to add later.

#### Manifest

```json
{
  "manifest_version": 3,
  "name": "Sable",
  "version": "0.1.0",
  "permissions": ["storage", "activeTab", "scripting"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup.html" },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content-script.js"],
    "run_at": "document_idle"
  }],
  "web_accessible_resources": [{
    "resources": ["inject.js", "sable.js"],
    "matches": ["<all_urls>"]
  }]
}
```

#### Why two scripts (content + inject)

Content scripts run in an **isolated world** — they share the DOM but not the JS realm. The SDK needs `window.Sable` and page-level event observation. So:

- `content-script.ts` (isolated world): bridges `chrome.*` APIs and the page. Listens for popup messages, reads/writes `chrome.storage.session`, injects `<script src="chrome-extension://.../inject.js">` into page DOM.
- `inject.ts` (main world): imports `sable.js` (the same `@sable-ai/sdk` bundle), calls `Sable.start()`. Talks to content-script via `window.postMessage` for things only the extension can do.

#### Session lifecycle from the extension

1. User clicks icon → popup opens
2. Popup sends `{action: "start"}` to background worker
3. Background worker ensures content script is running on the active tab
4. Content script `postMessage`s `{type: "sable:start", apiKey, appUrl}` to main world
5. Main-world `inject.js` calls `Sable.start({apiKey, appUrl})` — same flow as self-install from here
6. SDK stashes session in `sessionStorage` AND posts it back to content script, which writes to `chrome.storage.session` (extension-scoped, survives navigation across origins)
7. On navigation, content script auto-runs at `document_idle`, reads `chrome.storage.session`, and silently re-injects + reattaches

#### Popup (v1)

Minimal:
- Start / Stop button
- Session status (idle / connecting / live / error)
- API key input (`pk_live_...`), stored in `chrome.storage.local`
- Link to docs

No editor UI in v1. The popup is a launcher.

#### Distribution

Internal use only for v1. Loaded as unpacked extension. No Chrome Web Store submission yet.

### 4. `POST /api/sessions/embed` (sable-app)

New endpoint, peer of whatever currently dispatches agents for parley/nickel sessions.

**Request**
```ts
POST /api/sessions/embed
Authorization: Bearer pk_live_...
Content-Type: application/json

{
  "origin": "https://customer.com",
  "pageUrl": "https://customer.com/dashboard",
  "reattach"?: { "sessionId": "...", "roomName": "..." }
}
```

**Response**
```ts
{
  "sessionId": "sess_abc123",
  "wsUrl": "wss://livekit.sable.com",
  "roomName": "embed-sess_abc123",
  "token": "eyJ..."
}
```

**Behavior**
1. Validate `pk_live_...` against the customer record; check `Origin` header against the customer's allowed origins list
2. If `reattach` and the room still exists with an active agent worker → return a fresh participant token for the same room (no new agent dispatch)
3. Else: create new LK room, dispatch agent worker with metadata `{bridge: "user_browser", customerId, origin, pageUrl}`, return token
4. Worker boots, sees `bridge=user_browser`, instantiates `UserBrowserBridge`

**Allowed-origins enforcement** is the security model for v1. Customers list allowed origins per `pk_live_*` key in the dashboard. Internal "sable-internal" key allows `<all_urls>` (used by the extension).

**Out of scope:** session persistence beyond what parley already has, usage metering, rate limiting beyond app defaults.

### 5. Self-install docs

Lives at `js-sdk/docs/install.md`. ~one page. Outline:

1. Get an API key
2. Add allowed origins
3. Add the script tag
4. Or use a bundler
5. Headless mode
6. Troubleshooting (CSP, COOP/COEP, SPA navigation)

## Data flow

### Session establishment

1. User clicks extension icon (or page calls `Sable.start()` if self-installed)
2. SDK calls `POST /api/sessions/embed` with `{ origin, pageUrl }`
3. sable-app creates LK room, dispatches agent worker, returns `{ wsUrl, roomName, token, sessionId }`
4. SDK joins LK room as participant `user-browser`
5. Agent worker boots, sees the participant, instantiates `UserBrowserBridge(participant)`
6. Bridge calls `participant.perform_rpc("sable.ready", {})` → SDK responds with viewport + URL → agent ready
7. Voice and actions flow

### Action loop (per agent turn)

```
agent LLM decides "click the Sign in button"
        │
        ▼
BrowserBridge.get_dom_state()
  ├─ Nickel:  Playwright over CDP → injected VisibleDOM
  └─ User:    perform_rpc("sable.getDomState") → SDK runs wireframe → returns {screenshot, elements[]}
        │
        ▼
Northstar (Gemini) resolves "Sign in" → element id #42
        │
        ▼
BrowserBridge.execute_action(ActionClick(id=42))
  ├─ Nickel:  Playwright locator.click()
  └─ User:    perform_rpc("sable.click", {id: 42}) → SDK looks up element, dispatches MouseEvent
        │
        ▼
ActionShowCursor / ActionHighlightBox → SDK draws overlay div
```

Both bridges return the same result types so the agent loop is bridge-agnostic.

### Reattach on hard navigation

Customer SPAs are fine (no reload). But `<a href>` to a new page kills the SDK's JS context.

1. Before unload, SDK writes `{sessionId, token, roomName}` to `chrome.storage.session` (extension) or `sessionStorage` (self-install)
2. New page loads → extension content script (or self-install snippet) sees a stashed session → SDK auto-rejoins same LK room
3. Agent's `UserBrowserBridge` sees the participant disconnect+reconnect within a **5-second grace window** and treats it as continuity
4. Agent state (conversation, knowledge base) is untouched because it lives in the worker

If the grace window expires, the agent worker shuts down and a fresh `Sable.start()` is required.

**Cross-origin navigation**: in the extension, `chrome.storage.session` is extension-scoped so reattach works across origins. For self-install (`<script>` tag), cross-origin nav kills the session and the agent gracefully ends. This asymmetry is accepted for v1.

## Testing

Three layers, scaled to risk:

### Unit (`bun test`)
- `wireframe.ts` element extraction — known DOM in → expected `WireframeElement[]` out
- PTT state machine — synthetic events in → expected `setMicrophoneEnabled` calls out
- Action handlers — fake DOM elements in → assert side effects
- RPC plumbing — fake LK participant in → assert handlers registered

### Integration (sable-agentkit, Python)
- `UserBrowserBridge` with a fake LK participant that records RPC calls and returns canned responses
- **Run the existing agent loop test suite against the fake bridge** — verify the exact same agent behavior produces the exact same action sequence regardless of which bridge is plugged in. This is the test that proves the abstraction works.

### End-to-end (manual for v1)
- Load extension unpacked, click on a real site (start with sable.com itself), verify orb / PTT / click work
- Self-install on a throwaway HTML page served from `bun --hot`
- Specifically test: hard navigation reattach, cross-origin nav (extension continues, self-install gracefully ends)

Playwright e2e can come later. v1 ships on manual + the integration tests above.

## Rollout

### PR #1 — `BrowserBridge` interface refactor (`sable-agentkit`)
Branch: `refactor/browser-bridge-interface` off agentkit `main`.

- Extract `BrowserBridge` ABC
- Move existing logic into `NickelBrowserBridge`
- `BrowserComponent.__init__` takes a bridge; default is Nickel for backward compatibility
- All existing `BrowserComponent` tests pass unchanged
- Goes up for review

### PR #2 — `UserBrowserBridge` + SDK + extension + endpoint
Branch: `feat/user-browser-bridge` off PR #1's branch (rebased onto `main` after PR #1 merges).

Stacked on PR #1 so we can keep working while PR #1 is in review.

- `sable-agentkit`: add `UserBrowserBridge`, fake-participant integration tests
- `sable-app`: add `POST /api/sessions/embed`, allowed-origins config
- `js-sdk`:
  - Rename local `@sable/*` package(s) → `@sable-ai/*`
  - Create `@sable-ai/core` (LK + RPC + wireframe + actions)
  - Fill in `@sable-ai/ui` (orb + PTT + cursor + highlights)
  - Create `@sable-ai/sdk` (1 KB orchestrator)
  - Create `@sable-ai/extension` (Chrome MV3)
  - `docs/install.md` self-install guide
  - Update `README.md` Phase 1 section to reflect the pivot away from `site-preview` proxy injection
- Manual e2e: extension on sable.com

Each piece is independently reviewable but ships together because nothing works until all four exist.

### Internal dogfood
You and the team load extension unpacked, iterate based on what breaks.

## Open questions

None blocking. All design decisions confirmed in brainstorming.

## Appendix: confirmed decisions

- **Vision**: wireframe (extended to also export element list with `{id, type, label, bbox}` per element)
- **Room model**: SDK joins LK directly via token from sable-app endpoint. No iceServers configuration.
- **UI surface**: in-page Shadow DOM overlay only for v1. Document PiP deferred to v1.1.
- **PTT**: port parley's `usePushToTalk.ts` state machine to vanilla TS. Spacebar + click-and-hold, 200ms threshold.
- **Reattach grace window**: 5 seconds.
- **Cross-origin nav**: works in extension via `chrome.storage.session`; self-install accepts session loss.
- **Stateful brain / stateless runtime**: agent worker holds knowledge, conversation, vision; SDK is a stateless tool runtime.
- **Bridge pattern**: explicit ABC with `NickelBrowserBridge` and `UserBrowserBridge` as polymorphic implementations.
- **Frames**: screenshot-on-demand RPC for v1.
- **`Evaluate` action**: disabled on user browser.
- **Two stacked PRs**: refactor first, feature second.
- **Bundle target**: ~1 KB entry, dynamic imports for the rest.
- **Shadow DOM**: yes, with `// TODO(theme):` comments.
- **TypeScript**: `tsc --noEmit` in CI, `strict: true`.
- **Package namespace**: `@sable-ai/*` (npm scope owned by us; the `@sable` scope is taken).
- **Repo location**: existing `sable-inc/js-sdk` monorepo.
- **`nickel-ts-lib`**: already published as `sable-inc/nickel-ts-lib`, not touched in this work.
- **README Phase 1 update**: included in PR #2.
