# @sable-ai/sdk-core

Browser runtime for Sable: joins a LiveKit room and lets users talk to an
agent worker with optional vision + browser-bridge tools. Ships as a
Stripe.js-style split bundle:

| File | Size (gzipped) | When it loads |
| --- | --- | --- |
| `sable.js` (loader) | **~530 B** | Page load |
| `sable-core.mjs` (full SDK, livekit inlined) | ~150 KB | First `Sable.start()` call |

Pages that never open a session pay only the loader cost.

## Install

### Script tag (recommended for no-build sites + extensions)

```html
<script src="https://sdk.withsable.com/v0.1.4/sable.js"></script>
```

The loader installs `window.Sable` synchronously. On the first
`Sable.start()` call it lazy-imports `sable-core.mjs` from the same CDN
path and forwards the call.

Available CDN pins:

| Path | Cache | Use case |
| --- | --- | --- |
| `https://sdk.withsable.com/v0.1.4/sable.js` | 1 year, immutable | **Recommended for production** — exact version pin |
| `https://sdk.withsable.com/v1/sable.js` | 1 hour | Latest 0.x (accepts patch releases automatically) |
| `https://sdk.withsable.com/latest/sable.js` | 5 minutes | Demos and smoke tests only |

### npm (ESM)

```bash
bun add @sable-ai/sdk-core
```

```js
import Sable from "@sable-ai/sdk-core";
// Importing also installs window.Sable (first-write-wins), so mixed
// script-tag + npm usage on the same page stays coherent.
```

The npm build keeps `livekit-client` as an external peer so your bundler
can dedupe it.

## Usage

```js
await window.Sable.start({
  agentPublicId: "agt_...",
  apiUrl: "https://sable-api-gateway-9dfmhij9.wl.gateway.dev", // optional, default
  nickelRegion: "us-east1", // optional
});

// ... user talks to the agent ...

await window.Sable.stop();
```

`Sable.on(event, handler)` subscriptions registered before `start()`
resolves are buffered by the loader and flushed onto the real session
once `sable-core.mjs` finishes loading.

## Architecture

The loader is a tiny IIFE proxy (`src/loader.ts`) that:

1. Captures `document.currentScript.src` synchronously at top-level
   (the only time `currentScript` is defined).
2. Installs `window.Sable` with stub `start/stop/on` methods.
3. On first `start()`, resolves `new URL("./sable-core.mjs", scriptSrc)`
   and dynamically imports it — so `/v0.1.4/sable.js` always pulls
   `/v0.1.4/sable-core.mjs`. Version cohesion is automatic.
4. Memoises the import and flushes any queued `on()` subscriptions.

See `docs/superpowers/specs/` and `infra/cdn/README.md` for more.

## Local development

```bash
bun install
bun run --filter @sable-ai/sdk-core build
python3 -m http.server 5173 --directory packages/sdk-core
```

Open `http://localhost:5173/examples/test.html`, paste an agent public
ID, click Start. Grant mic permission when prompted.

**Only `http://localhost:*` origins work against the hosted API** —
`sable-api`'s CORS policy does not yet allow arbitrary origins.

## Releasing

Tagging `sdk-core-v<x.y.z>` triggers `.github/workflows/release-sdk-core.yml`
which:

1. Runs typecheck + tests + build.
2. Publishes to npm with OIDC trusted-publisher provenance.
3. Stages `dist/sable.iife.js` + `dist/sable-core.mjs` under
   `/v<version>/`, `/v1/`, and `/latest/` via `infra/cdn/stage.sh`.
4. Deploys the staged directory to Cloudflare Pages
   (`sable-sdk-cdn` project, custom domain `sdk.withsable.com`).
