# @sable/js-sdk

Monorepo for Sable's client-side SDK packages. These packages power interactive product demos by connecting an AI agent to a live website — capturing what's on screen, executing actions, and rendering the call UI.

## Context: RFC-0001

This repo implements the **SDK layer** from [RFC-0001: Future Architecture](../context/rfcs/0001_future_architecture.md). The SDK enables three demo modes:

| Mode | Integration | SDK packages used |
|------|------------|-------------------|
| **Slides** | Zero (proxy only) | `sdk-live` + `sdk-ui` |
| **On-site** | `<script>` tag or GTM | `sdk-live` + `sdk-ui` + `sdk-core` |
| **Nickel** (virtual browser) | Zero | `sdk-live` + `sdk-ui` + `sdk-nickel` |

The rollout is phased:
- **Phase 1** (April 2026): Slides + Nickel. SDK injected via [`site-preview`](https://github.com/sable-inc/site-preview) proxy. `sdk-core` runs inside nickel via CDP.
- **Phase 2** (July 2026): Customer installs SDK. On-site mode — agent navigates the real website in the user's browser.
- **Phase 3** (October 2026): Embedded mode. Customer adds the Sable button to their site. No proxy, no nickel required.

## Packages

### `@sable/sdk-ui`
Call overlay UI: voice indicators, agent avatar, transcription, call controls, and the Sable button (embedded mode). Customizable to match customer branding. Overlays either the nickel video stream or the actual customer page.

### `@sable-ai/sdk-core` — **shipped** ([npm](https://www.npmjs.com/package/@sable-ai/sdk-core))
The agent's eyes and hands on the page:
- **Wireframe capture**: DOM walker that classifies elements (buttons, inputs, text, images, nav) and renders wireframes to Canvas. ~126ms per capture, zero dependencies, pure Canvas API.
- **DOM observation**: Reports structured page state (elements, positions, text, interactive components) to the agent. Hybrid approach — DOM state for speed, wireframes for visual context.
- **Action execution**: Receives commands from the agent and executes native DOM actions (click, scroll, type, navigate). Same API whether running on nickel's browser or the user's browser.

**Install** — either a script tag (recommended for no-build sites) or the npm package:

```html
<!-- Stripe.js-style split bundle: 533 B loader on page load, 150 KB core lazy-loaded on first Sable.start() -->
<script src="https://sdk.withsable.com/v0.1.4/sable.js"></script>
<script>
  await window.Sable.start({ publicKey: "pk_live_...", vision: { enabled: true } });
</script>
```

```bash
bun add @sable-ai/sdk-core
```

CDN pins (all served from Cloudflare Pages at `sdk.withsable.com`):

| URL | Cache | Use case |
| --- | --- | --- |
| `https://sdk.withsable.com/v0.1.4/sable.js` | 1 year, immutable | **Recommended for production** — exact version pin |
| `https://sdk.withsable.com/v1/sable.js` | 1 hour | Latest 0.x — accepts patch releases automatically |
| `https://sdk.withsable.com/latest/sable.js` | 5 minutes | Demos and smoke tests only |

Each pin serves two files side-by-side: `sable.js` (the 533 B IIFE loader stub) and `sable-core.mjs` (the full SDK, livekit inlined). The loader captures its own script URL and dynamic-imports the core from the same path on the first `Sable.start()` call — so pages that never open a session pay only the loader cost.

See [`packages/sdk-core/README.md`](packages/sdk-core/README.md) and [`infra/cdn/README.md`](infra/cdn/README.md) for details.

### `@sable/sdk-live` *(planned)*
LiveKit connection — voice, audio, WebRTC peer connection, data channels. Extracted from parley as a standalone module. Common ground for all demo modes.

### `@sable/sdk-nickel` *(planned)*
Nickel virtual browser integration — server claim flow, WebRTC video stream, user input forwarding via FlatBuffers binary protocol. Replaces the `useNickelConnection` hook from parley. Only needed for nickel mode (canvas-heavy sites, security-sensitive demos, subscription-gated features).

## Quick start

```bash
bun install
bun test
```

## Structure

```
packages/
  sdk-ui/           Call overlay, agent avatar, Sable button
  sdk-core/         (planned) Wireframe capture, DOM observation, action execution
  sdk-live/         (planned) LiveKit voice/WebRTC connection
  sdk-nickel/       (planned) Nickel virtual browser integration
```

This is a [Bun workspaces](https://bun.sh/docs/install/workspaces) monorepo. Each package is independently publishable under the `@sable/` npm scope.

## Related

- [`sable-inc/site-preview`](https://github.com/sable-inc/site-preview) — Reverse proxy that injects the SDK into any website for the PLG funnel
- [`sable-inc/parley`](https://github.com/sable-inc/parley) — Customer-facing frontend (sdk-live and sdk-nickel are extracted from here)
- [`sable-inc/sable-agentkit`](https://github.com/sable-inc/sable-agentkit) — Python-based agent that consumes sdk-core's wireframes and sends actions back
