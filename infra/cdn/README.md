# sdk.withsable.com — SDK CDN

Static CDN for the `@sable-ai/sdk-core` IIFE bundle. Customers who embed
Sable via a `<script>` tag load from here; customers who use the npm
package don't touch this.

## URLs

| Path | Pin | Cache | Use case |
| --- | --- | --- | --- |
| `https://sdk.withsable.com/v0.1.3/sable.js` | exact version | 1 year, immutable | **Recommended for production.** Upgrades are opt-in, bytes never change under a URL. |
| `https://sdk.withsable.com/v1/sable.js` | latest `0.x` | 1 hour | Accepts patch releases automatically; breaks on a hypothetical `1.0.0`. |
| `https://sdk.withsable.com/latest/sable.js` | always newest | 5 minutes | Demos and smoke tests only. Do NOT use in production — you're opted into every release the day it ships. |

All paths serve the same minified IIFE bundle built from
`packages/sdk-core/src/index.ts` by `bun run build`. The only difference is
which version the path points at and how long the edge cache holds it.

## Architecture

- **Host:** Cloudflare Pages project `sable-sdk-cdn`
- **Custom domain:** `sdk.withsable.com` (CNAME → the Pages subdomain)
- **Source of truth:** the `release-sdk-core` GitHub Actions workflow, which
  publishes to npm and deploys to Pages in the same tag-triggered run.
- **Layout staged on disk before deploy:**
  ```
  infra/cdn/public/
  ├── _headers                  # copied from infra/cdn/_headers
  ├── v0.1.3/sable.js          # the built IIFE for the tag being released
  ├── v1/sable.js              # same bytes, minor-pinned
  └── latest/sable.js          # same bytes, always-newest
  ```
- Previous versions are preserved because Cloudflare Pages does incremental
  deploys — the `v0.0.2/` directory stays in place when `v0.1.3/` is added.

## CORS

`_headers` sends `Access-Control-Allow-Origin: *`. The auth boundary is the
publishable key's allowed-domains list enforced by `sable-api`, not the
CDN's CORS headers — so a permissive CORS policy here is safe.

## First-time setup (manual, one-off)

Run these steps before the first release tag pushes:

1. **Create the Cloudflare Pages project** (`sable-sdk-cdn`). Use the Direct
   Upload flow — no git integration — so releases only happen via the
   workflow, not on every push to `main`.

   ```sh
   bunx wrangler@latest pages project create sable-sdk-cdn --production-branch=main
   ```

2. **Attach the custom domain.** In the Pages dashboard:
   `sable-sdk-cdn` → Custom domains → Add `sdk.withsable.com`. Cloudflare
   will prompt to add a CNAME record pointing to
   `sable-sdk-cdn.pages.dev` — do that in the `withsable.com` zone.

3. **Create a deploy token** at My Profile → API Tokens. Use the
   **Cloudflare Pages — Edit** template. Copy the token and add it as a
   GitHub Actions secret on the `js-sdk` repo:

   - `CLOUDFLARE_API_TOKEN` — the token from above
   - `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID (visible on the
     right sidebar of any zone or in the dashboard URL)

4. **Push a release tag.** `release-sdk-core.yml` will build, publish to
   npm, and deploy to Pages in the same run.

## Verifying a release

After the workflow finishes, cache-bust and sanity-check the three pins:

```sh
curl -sI "https://sdk.withsable.com/v0.1.3/sable.js?t=$RANDOM" | head
curl -sI "https://sdk.withsable.com/v1/sable.js?t=$RANDOM" | head
curl -sI "https://sdk.withsable.com/latest/sable.js?t=$RANDOM" | head
```

Look for `cf-cache-status: MISS` on the first hit (then `HIT` afterwards)
and the `cache-control` header matching the expected pin.
