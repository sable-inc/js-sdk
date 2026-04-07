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
- Bundle is ~1 MB unminified because `livekit-client` is inlined into the IIFE.
- No session persistence across navigations.
- No push-to-talk; the mic stays open for the whole session.
- Errors from `start()` propagate; callers must catch and display them.
