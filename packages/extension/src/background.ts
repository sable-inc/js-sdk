/// <reference types="chrome" />

/**
 * Background service worker for @sable-ai/extension.
 *
 * Two build modes, selected at bun build time via __SABLE_BUILD__
 * (see package.json):
 *
 *   local — loader comes from chrome.runtime.getURL("sable.iife.js"),
 *     which is the bundled 533 B loader stub copied from
 *     ../sdk-core/dist during build.
 *
 *   prod  — loader comes from https://sdk.withsable.com/v1/sable.js
 *     (the CDN). Nothing SDK-related is bundled into the extension.
 *
 * Both modes share the same popup and message flow. The popup exposes:
 *
 *   { type: "inject" } — put the loader on the page and stop. The user
 *     can now call window.Sable.start(...) from devtools manually.
 *
 *   { type: "start", agentId, apiUrl } — inject the loader if not
 *     already there, wait for window.Sable, then call
 *     window.Sable.start({ publicKey: agentId, apiUrl, vision }).
 *
 *   { type: "stop" } — call window.Sable.stop() if the SDK is present.
 *
 * All "touch window.Sable" calls MUST pass world: "MAIN" to executeScript,
 * otherwise they run in the isolated world where Sable is undefined.
 */

declare const __SABLE_BUILD__: "local" | "prod";

const CDN_LOADER_URL = "https://sdk.withsable.com/v1/sable.js";

function loaderUrl(): string {
  return __SABLE_BUILD__ === "prod"
    ? CDN_LOADER_URL
    : chrome.runtime.getURL("sable.iife.js");
}

interface InjectMessage {
  type: "inject";
}

interface StartMessage {
  type: "start";
  agentId: string;
  apiUrl: string;
}

interface StopMessage {
  type: "stop";
}

type IncomingMessage = InjectMessage | StartMessage | StopMessage;

interface OkResponse {
  ok: true;
}
interface ErrResponse {
  ok: false;
  error: string;
}
type BgResponse = OkResponse | ErrResponse;

async function getActiveTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("no active tab");
  }
  return tab.id;
}

async function injectSdkTag(tabId: number): Promise<void> {
  const sdkUrl = loaderUrl();
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (url: string) => {
      const w = window as unknown as { Sable?: unknown };
      if (w.Sable) return; // already injected, skip
      const s = document.createElement("script");
      s.src = url;
      s.async = true;
      (document.head || document.documentElement).appendChild(s);
    },
    args: [sdkUrl],
  });
}

async function waitForSable(tabId: number): Promise<void> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () =>
      new Promise<boolean>((resolve) => {
        const deadline = Date.now() + 5000;
        const tick = () => {
          if ((window as unknown as { Sable?: unknown }).Sable) {
            resolve(true);
            return;
          }
          if (Date.now() > deadline) {
            resolve(false);
            return;
          }
          setTimeout(tick, 50);
        };
        tick();
      }),
  });
  if (!result?.result) {
    throw new Error("timed out waiting for window.Sable to load");
  }
}

async function callStart(
  tabId: number,
  agentId: string,
  apiUrl: string,
): Promise<void> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (publicKey: string, apiUrl: string) => {
      try {
        await (
          window as unknown as {
            Sable: {
              start(opts: {
                publicKey: string;
                apiUrl: string;
                vision?: {
                  enabled: boolean;
                  frameSource?: {
                    type: "wireframe";
                    rate?: number;
                    features?: { includeImages?: boolean };
                  };
                };
              }): Promise<void>;
            };
          }
        ).Sable.start({
          publicKey,
          apiUrl,
          // Extension injection is always agent-drives-the-user-browser,
          // so vision is on by default — the agent needs to see the page.
          // Images in the wireframe are also on: the extension explicitly
          // overrides the SDK default for now because the CDN-hosted SDK
          // (sdk.withsable.com) still defaults to includeImages=false. Once
          // the next sdk-core tag ships with includeImages=true as the
          // default, this explicit frameSource can be dropped.
          vision: {
            enabled: true,
            frameSource: {
              type: "wireframe",
              rate: 2,
              features: { includeImages: true },
            },
          },
        });
        return { ok: true as const };
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
    args: [agentId, apiUrl],
  });
  const r = result?.result as
    | { ok: true }
    | { ok: false; error: string }
    | undefined;
  if (!r) throw new Error("executeScript returned no result");
  if (!r.ok) throw new Error(r.error);
}

async function callStop(tabId: number): Promise<void> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async () => {
      const w = window as unknown as { Sable?: { stop(): Promise<void> } };
      if (!w.Sable) return { ok: true as const }; // nothing to stop
      try {
        await w.Sable.stop();
        return { ok: true as const };
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  });
  const r = result?.result as
    | { ok: true }
    | { ok: false; error: string }
    | undefined;
  if (!r) throw new Error("executeScript returned no result");
  if (!r.ok) throw new Error(r.error);
}

async function handleInject(): Promise<void> {
  const tabId = await getActiveTabId();
  await injectSdkTag(tabId);
  await waitForSable(tabId);
}

async function handleStart(msg: StartMessage): Promise<void> {
  const tabId = await getActiveTabId();
  await injectSdkTag(tabId);
  await waitForSable(tabId);
  await callStart(tabId, msg.agentId, msg.apiUrl);
}

async function handleStop(): Promise<void> {
  const tabId = await getActiveTabId();
  await callStop(tabId);
}

chrome.runtime.onMessage.addListener(
  (msg: IncomingMessage, _sender, sendResponse: (r: BgResponse) => void) => {
    const respond = (p: Promise<void>) => {
      p.then(
        () => sendResponse({ ok: true }),
        (err: unknown) =>
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
      );
      return true; // async response
    };

    if (msg?.type === "inject") return respond(handleInject());
    if (msg?.type === "start") return respond(handleStart(msg));
    if (msg?.type === "stop") return respond(handleStop());
    return false;
  },
);
