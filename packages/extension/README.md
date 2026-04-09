# @sable-ai/extension (dev build)

Local-only Chrome MV3 extension that injects `@sable-ai/sdk-core` into the current
tab and starts a voice session with a dispatched agent worker.

## Build

From the repo root:

```bash
bun install
bun run --filter @sable-ai/sdk-core build
bun run --filter @sable-ai/extension build
```

This produces `packages/extension/dist/` with `manifest.json`, `background.js`,
`popup.html`, `popup.js`, `sable.iife.js` (the ~1 KB loader), and
`sable-core.mjs` (the full SDK bundle, ~150 KB gzipped). Both SDK files are
declared in `web_accessible_resources` so the loader can dynamic-import
the core from its own `chrome-extension://<id>/` origin.

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
   python3 -m http.server 5173 --directory packages/sdk-core
   ```

2. Open `http://localhost:5173/examples/test.html` in Chrome. Open DevTools → Console.
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
bun run --filter @sable-ai/sdk-core build
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
