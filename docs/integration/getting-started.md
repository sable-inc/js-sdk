# Adding a Sable agent to your website

> **Beta.** The platform UI, the SDK API, and the error codes described below
> may still change before general availability. If you're integrating now,
> pin the SDK to an exact version.

Sable is a voice + vision agent that lives inside your users' browsers. Drop
a single `<script>` tag on the pages where you want it, call `Sable.start()`,
and an agent you configured on the Sable platform can talk to your user and
see what they see — no iframes, no overlays you don't control, no changes to
your backend.

This guide walks you through the end-to-end integration as a web engineer at
a company that already has a Sable account.

---

## 1. Create an agent on the Sable platform

1. Sign in to <https://platform.withsable.com>.
2. **Agents → New agent**. Give it a name and pick a template (voice-only,
   voice + vision, etc).
3. Write the agent's system prompt and configure its tools. This is the same
   agent config you'd use in any Sable channel — the SDK just exposes it in
   your user's browser instead of a Sable-hosted call page.
4. Publish the agent. You'll land on the agent detail page.

## 2. Add your domain to the allowlist

Still on the agent detail page:

1. Open the **Web SDK** tab.
2. Under **Allowed domains**, add every origin where you intend to load the
   SDK. Exact hostnames only — `example.com`, `www.example.com`,
   `app.example.com`. Wildcards are supported as a leading `*.`
   (e.g. `*.example.com` covers every subdomain).
3. Save.

Why this matters: the SDK is loaded inside the user's browser and talks
directly to the Sable API from the page. Sable rejects requests from any
origin that isn't on this list, so adding your domain here is the gate
that lets the script tag on your site actually connect. **If you forget
this step, you'll see a CORS error in the devtools console and nothing
else — the call never starts.**

Allowed domains are scoped to the agent. An agent for your marketing site
and an agent for your product dashboard can have different allowlists.

## 3. Copy your public key

On the same **Web SDK** tab, under **Public key**, you'll see a value like:

```
pk_live_8f3a9c2d4e5b6a7c
```

This is the key you'll paste into your page. It's a **publishable** key —
safe to ship in client-side code, visible in devtools, not a secret. It
identifies the agent and is validated by Sable against the allowed-domains
list above, so even if someone copies it onto their own site it won't work
unless their origin is on your allowlist.

If you ever need to rotate it (e.g. the key shows up somewhere you don't
want it), click **Rotate key** and update the snippet on your site. The old
key is immediately invalidated.

## 4. Load the SDK

You have two options. Both expose the same API; pick whichever fits your
stack.

### Option A: Script tag (works everywhere)

Add this to every page you want the agent to be available on:

```html
<script src="https://sdk.withsable.com/v1/sable.js" async></script>
```

That's the whole payload — a < 1 KB stub, no dependencies, no stylesheet.
It installs a single global (`window.Sable`) and does nothing else until
you call `start()`: no network requests, no microphone prompt, no DOM
mutations. Idle cost to your site is effectively zero.

The script is served from Sable's CDN, cached at the edge, and versioned.
`v1` is a stable major line — the API won't change without a major bump.
Pin to an exact version (`v1.2.3`) if you want bit-for-bit reproducibility.

### Option B: npm package (React, Vue, Svelte, Next, etc.)

```bash
npm install @sable-ai/sdk-core
```

```js
import { Sable } from "@sable-ai/sdk-core";

await Sable.start({ publicKey: "pk_live_..." });
```

Under the hood the package loads the same CDN script on first use and
re-exports `window.Sable`, so both options share a single runtime on the
page — you cannot accidentally end up with two copies. The npm package
adds TypeScript types, SSR-safe guards (`Sable.start` is a no-op during
server rendering), and tree-shakable event helpers. Use this path if you
want typed autocomplete and bundler integration.

## 5. Start a session from your app code

When you want the agent to actually connect — on a button click, on page
load, when the user opens a help menu, whatever — call:

```js
await window.Sable.start({
  publicKey: "pk_live_8f3a9c2d4e5b6a7c",

  // Optional — what the agent can see.
  vision: {
    enabled: true,
    // How frames are produced. Defaults to the built-in wireframe renderer.
    // Discriminated on `type`:
    //   { type: "wireframe", features: { includeImages?: boolean } }
    //   { type: "fn", captureFn: () => HTMLCanvasElement | ImageBitmap }
    frameSource: {
      type: "wireframe",
      rate: 2, // frames per second; default 2
      features: {
        includeImages: true, // include rendered images, not just layout boxes
      },
    },
  },

  // Optional — implementations for methods the agent can RPC into your page.
  // The SDK defines a small set of "UI stub" methods (e.g. showMessage,
  // highlightElement). You can override any of them here, and add your own
  // for agent tools specific to your app. Anything you pass becomes callable
  // by the agent.
  runtime: {
    showMessage: (text) => myToast.show(text),
    highlightElement: (selector) => { /* ... */ },
    openDocument: (docId) => router.push(`/docs/${docId}`),
  },

  // Optional — arbitrary context forwarded to the agent at session start.
  // Surfaces verbatim in the agent's initial prompt.
  context: {
    userId: currentUser.id,
    userName: currentUser.name,
    currentPage: "dashboard",
  },
});
```

`Sable.start()` returns a promise that resolves when the mic is live and
the agent has greeted the user. It rejects if the public key is invalid,
the origin isn't on the allowlist, or the user denies microphone access.

To end the session:

```js
await window.Sable.stop();
```

You can call `start()` and `stop()` as many times as you like during a page
lifetime. Only one session can be active at a time.

## 6. React to session events (optional)

If you want to, say, show your own UI when the agent is talking, subscribe
to events:

```js
window.Sable.on("session:started", () => { ... });
window.Sable.on("session:ended", (reason) => { ... });
window.Sable.on("agent:speaking", (speaking) => { ... });
window.Sable.on("user:speaking", (speaking) => { ... });
window.Sable.on("error", (err) => { ... });
```

All events are fire-and-forget; the SDK does not care whether you subscribe.

---

## Reference: `Sable.start()` options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `publicKey` | `string` | **required** | The `pk_live_*` key from the platform. |
| `vision.enabled` | `boolean` | `false` | Whether to publish a video track of the page to the agent. |
| `vision.frameSource` | `FrameSource` | `{ type: "wireframe" }` | Where frames come from. Either the built-in wireframe renderer or a custom function (see below). |
| `vision.frameSource.rate` | `number` | `2` | Capture rate in frames per second. Applies to both `wireframe` and `fn`. Higher = more responsive agent vision, more bandwidth. |
| `vision.frameSource.features.includeImages` | `boolean` | `false` | (Wireframe only.) Include rendered images, not just layout boxes. Slightly higher bandwidth. |
| `vision.frameSource.captureFn` | `() => HTMLCanvasElement \| ImageBitmap` | — | (Required when `type: "fn"`.) Called at `rate` Hz. Useful for feeding the agent a custom canvas (e.g. a 3D scene, a video element, a WebGL surface). |
| `runtime` | `Record<string, Function>` | `{}` | Implementations for UI-stub methods the agent can call, plus any additional methods you want to expose as agent tools. |
| `context` | `Record<string, unknown>` | `{}` | Forwarded verbatim to the agent at session start. Appears in the agent's initial prompt. |

## Reference: errors

| Code | Cause | Fix |
| --- | --- | --- |
| `SABLE_INVALID_KEY` | Public key doesn't exist or was rotated. | Copy the current key from the platform. |
| `SABLE_ORIGIN_NOT_ALLOWED` | Page's origin isn't on the agent's allowlist. | Add the exact origin in the platform's Web SDK → Allowed domains. |
| `SABLE_MIC_DENIED` | User denied microphone permission. | Prompt them again, or show a message explaining why voice is needed. |
| `SABLE_RATE_LIMITED` | Too many sessions started from this origin in a short window. | Back off and retry. |
| `SABLE_NETWORK` | Couldn't reach the Sable API. | Usually transient — retry with backoff. |

---

## FAQ

**Do I need a backend integration?**
No. The SDK talks directly to `api.withsable.com` from the page. There's no
webhook to install, no server-to-server auth, no token exchange you have to
implement. The public key + allowed-domains check is the entire trust model.

**Is the public key a secret?**
No — it's designed to be shipped in client-side code. The security boundary
is the allowed-domains list, not the key itself. Someone who copies your
key to their own site can't use it unless their origin is also on your
allowlist.

**Script tag or npm package — which should I use?**
Either. They share the same runtime on the page (the npm package loads the
CDN script on first use and re-exports `window.Sable`), so there's no
second-copy risk. Use the script tag for static HTML or if you want to
avoid bundler configuration. Use the npm package if you want TypeScript
types, SSR-safe guards, and bundler-integrated imports. Mixing is fine —
the script tag set a global, the npm package will find and reuse it.

**Why a global (`window.Sable`) instead of an import-only API?**
To keep the drop-in story honest. A single `<script>` tag works in every
web framework — React, Vue, Svelte, Next, Rails, plain HTML — without
bundler setup. The npm package is a typed wrapper around the same global,
so you get the best of both: one runtime on the page, two ways to reach it.

**Does the SDK render anything by default?**
The SDK itself is headless — it handles voice, vision, and agent
communication but renders nothing on its own. A default UI (mic button,
avatar, agent-driven overlays) can be enabled via a separate package, or
you can build your own using the event API and your own component library.

**Does the agent see my users' data?**
Only what's on the page at the moment the session is active, and only if
`vision.enabled` is `true`. The wireframe is generated client-side and
streamed as a video track; Sable never scrapes, indexes, or stores page
content server-side. Microphone audio is end-to-end within the voice
session.

**What happens if the user navigates away?**
The session ends. The SDK tears down the connection, stops the microphone,
and unmounts anything it mounted. A fresh `Sable.start()` on the next page
creates a new session.

**How do I test this locally?**
Add `http://localhost:3000` (or whatever port you use) to the allowed
domains list alongside your production origin. The SDK treats localhost
the same as any other origin — there's no special dev bypass.

**Can I self-host the script?**
Not recommended. The CDN copy is versioned, cached globally, and updated
automatically. If you self-host you own the update path, which you
probably don't want. If you really need to — e.g. an air-gapped customer —
contact support.

**Does the SDK work with strict CSP (`script-src` nonces, etc.)?**
Yes, but you need to apply your nonce to the `<script>` tag. The SDK does
not dynamically load additional scripts from other origins at runtime, so
the single tag you add is the only thing your CSP needs to allow.
