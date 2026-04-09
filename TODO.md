# TODO

Pending work, parked for later. Each section is self-contained — pick one and
go.

## sdk-core: headless avatar API (target: 0.1.6)

Goal: let consumers build their own custom avatar UI on top of the headless
SDK. No UI ships from us — just the data + control primitives needed to wire
up an orb / voice bars / floating widget in any framework.

### API surface (signed off in chat 2026-04-09)

```ts
// New event on the existing emitter
Sable.on("agent:audioLevel", (level: number) => { /* 0..1, RAF cadence */ });

// New methods on SableAPI
await Sable.setMicrophoneEnabled(false);  // mute
Sable.isMicrophoneEnabled();              // → boolean
```

### Files to touch

- **Modify** `packages/sdk-core/src/types/index.ts`
  - Add `"agent:audioLevel": number` to `SableEvents`.
  - Add `setMicrophoneEnabled(enabled: boolean): Promise<void>` and
    `isMicrophoneEnabled(): boolean` to `SableAPI`.
- **Modify** `packages/sdk-core/src/events/index.ts`
  - Add `hasListeners(event): boolean` so the session can lazily start/stop
    the RAF loop based on subscriber count.
- **Create** `packages/sdk-core/src/session/audio-level.ts` (~60 LOC)
  - `startAudioLevelLoop(room, emit): () => void`
  - RAF loop that reads `agentParticipant.audioLevel` and calls `emit(level)`.
  - Re-resolves the agent participant each frame (cheap — Map of ≤2 entries)
    to handle the case where the agent joins after `Sable.start()` returns.
- **Modify** `packages/sdk-core/src/session/index.ts`
  - Add `mic-on` tracking field on `Session` (default true after start, false
    after `setMicrophoneEnabled(false)`).
  - Override `Session.on()` so subscribing to `agent:audioLevel` lazily starts
    the audio-level loop. Stop the loop when last subscriber unsubscribes
    AND on `Session.stop()`.
  - Implement `setMicrophoneEnabled` (delegates to
    `room.localParticipant.setMicrophoneEnabled` + updates the field).
  - Implement `isMicrophoneEnabled` (returns the field).
- **Modify** `packages/sdk-core/README.md`
  - New "Building a custom avatar" section with the four-primitive example
    (audio level subscribe, speaking subscribe, mic toggle, hangup).
- **Create** `packages/sdk-core/tests/audio-level.test.ts`
  - Mock room with synthetic `audioLevel` per tick.
  - Verify emit cadence matches RAF.
  - Verify the loop stops when the last subscriber unsubscribes.
  - Verify subscribing before the agent participant exists doesn't crash and
    emits 0 in the meantime.

### Implementation notes / gotchas

1. **Lazy RAF loop.** The loop runs only while ≥1 subscriber to
   `agent:audioLevel` exists. This is the only reason `events.hasListeners`
   needs to exist — keep it minimal, don't add a general-purpose
   subscribe/unsubscribe callback.
2. **Initial emit on subscribe.** When a subscriber registers, immediately
   call them once with `0` so they don't have to special-case "no data yet".
3. **Agent identity lookup.** Use the same predicate as `findAgentIdentity`
   in `session/index.ts:83` (`identity.startsWith("agent")`, fall back to
   first remote participant). Don't extract it into a shared helper unless
   it's used in a third place.
4. **LiveKit structural type.** The structural `LiveKitRoom` interface in
   `session/index.ts:45` doesn't currently expose `audioLevel` on remote
   participants. Add it (`audioLevel?: number`) — same pattern as the
   existing `trackPublications` field.
5. **`isMicrophoneEnabled` defaults.** Initially `false`. Becomes `true`
   inside `Session.start()` after the `setMicrophoneEnabled(true)` call
   succeeds. Becomes `false` again on `Session.stop()`.

### Out of scope for 0.1.6

- `user:audioLevel` event. Add when someone asks.
- FFT / spectrum data (parley uses RMS only).
- Document Picture-in-Picture support — that's a consumer concern.
- Shadow DOM root for mounting custom avatars — also a consumer concern.

### Release process

Same as 0.1.5 (`.github/workflows/release-sdk-core.yml` is the source of
truth). Bump → commit → tag `sdk-core-v0.1.6` → push.

### Once shipped

The extension's explicit `frameSource.features.includeImages = true`
override in `packages/extension/src/background.ts` callStart can be deleted
once `sdk.withsable.com/v1/sable.js` tracks 0.1.6 (which will already have
that as the default). The comment in that file flags this — search for
"explicit frameSource".

---

## extension: Chrome Web Store icons + listing assets

Goal: produce the rasterized PNG icons + store listing artwork that the
Chrome Web Store requires before we can publish the extension.

### What's already in the repo (committed alongside this TODO)

`packages/extension/assets/` contains:

- `logo-icon.svg` — source icon, fetched from webflow CDN, 31×25 viewBox,
  single-path #0D0E1F fill. The square Sable mark only.
- `logo-full.svg` — source full logo with wordmark, 132×29 viewBox.
- `_icon-{16,32,48,128}.svg` — wrapper SVGs that embed `logo-icon.svg` on a
  square white background, centered with ~12px padding (Google's icon
  design spec). One per required size.
- `_promo-440.svg` — 440×280 wrapper for the small store-listing tile,
  full logo at width 340.
- `_marquee-1400.svg` — 1400×560 wrapper for the marquee promo image,
  full logo at width 1080.

The `_`-prefixed files are intermediates — only the rasterized PNGs need
to ship in `dist/`. The wrapper SVGs are committed so the rasterization
step is reproducible without re-fetching from webflow.

### Steps to finish

1. Install rsvg-convert if missing (`brew install librsvg`).
2. Rasterize each wrapper SVG to PNG at the target size:
   ```sh
   cd packages/extension/assets
   for s in 16 32 48 128; do
     rsvg-convert -w $s -h $s _icon-$s.svg -o icon-$s.png
   done
   rsvg-convert -w 440 -h 280  _promo-440.svg   -o promo-440x280.png
   rsvg-convert -w 1400 -h 560 _marquee-1400.svg -o marquee-1400x560.png
   ```
3. Verify PNGs are opaque, no alpha channel artifacts (Chrome Web Store
   rejects icons with weird alpha).
4. Wire `icon-{16,32,48,128}.png` into both manifests:
   ```json
   "icons": {
     "16": "icon-16.png",
     "32": "icon-32.png",
     "48": "icon-48.png",
     "128": "icon-128.png"
   },
   "action": {
     "default_popup": "popup.html",
     "default_title": "Sable",
     "default_icon": {
       "16": "icon-16.png",
       "32": "icon-32.png",
       "48": "icon-48.png",
       "128": "icon-128.png"
     }
   }
   ```
   Update both `packages/extension/manifest.local.json` and
   `packages/extension/manifest.prod.json`.
5. Update `packages/extension/package.json` build scripts so `_assets:local`
   and `_assets:prod` also copy the four `icon-*.png` files into `dist/`.
6. Run `bun run build:prod && bun run package:prod` and verify the produced
   `sable-extension-prod-0.0.1.zip` contains all four icons + manifest
   references them at the listed paths.
7. The store listing PNGs (`promo-440x280.png`, `marquee-1400x560.png`) do
   NOT belong in `dist/` — they're uploaded separately on the Chrome Web
   Store dashboard during the listing creation step.

### Publishing flow (for the actual store upload)

1. Generate `sable-extension-prod-0.0.1.zip` via `bun run package:prod`.
2. Go to Chrome Web Store Developer Dashboard
   (https://chrome.google.com/webstore/devconsole) — costs $5 one-time
   developer registration if not already registered.
3. Create a new item, upload the zip.
4. Fill out the listing: store icon (128×128), description, screenshots
   (1280×800 or 640×400, at least one), promo tile (440×280), marquee
   (1400×560 — optional, only shown on featured pages).
5. Privacy: declare permissions justification — `scripting`, `activeTab`,
   `storage`, `declarativeNetRequest`, `host_permissions: <all_urls>`.
   The justification for `<all_urls>` will be the most-scrutinized field;
   write something specific like "Inject the Sable SDK loader on whatever
   page the user invokes the extension from. The extension does not
   read, modify, or transmit page content beyond loading the SDK script."
6. Submit for review. First review usually takes a few business days; the
   `<all_urls>` permission triggers manual review.

### CI/CD (deferred)

There's no GitHub Action for the extension yet — only manual builds. If we
ever want a tag-triggered upload, the path is:

- Tag pattern: `extension-v*`.
- Workflow: build prod, zip, upload via Chrome Web Store API
  (`https://developer.chrome.com/docs/webstore/api`).
- Requires three repo secrets: `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`,
  `CWS_REFRESH_TOKEN`. The OAuth dance to obtain the refresh token is
  documented at the link above.
- Don't bother building this until the listing actually exists in the
  store dashboard — the API needs the extension's item ID, which only
  exists after a manual first upload.

---

## misc / smaller things

- **PR #827 and PR #2 descriptions** are stale (carried over from a much
  older task list). Reconcile or close.
- **The empty CF DNS record** at `api.withsable.com` (proxied CNAME →
  `sable-api-gateway-9dfmhij9.wl.gateway.dev`) doesn't actually serve
  traffic — the gateway 404s on the wrong Host header. Either delete it,
  or do the GCLB + Serverless NEG work to make it real. Documented in
  the iac repo's `global/cloudflare/api-domain.tf` (currently just the
  CNAME, the failed Origin Rule attempt was rolled back).
