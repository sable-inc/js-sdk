# @sable-ai/extension (dev build)

Local-only Chrome MV3 extension that injects the Sable SDK into the
current tab. v0 just runs `console.log` from the SDK; no LiveKit, no RPC.

## Build

From the repo root:

```bash
bun install
bun run --filter @sable-ai/sdk build
bun run --filter @sable-ai/extension build
```

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

   ```
   Sable SDK injected 0.0.1
   ```

5. In the console, run `window.Sable` and you should see `{version: "0.0.1"}`

## Iterating

After editing source files:

```bash
bun run --filter @sable-ai/sdk build
bun run --filter @sable-ai/extension build
```

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
