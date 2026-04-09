/// <reference types="chrome" />

/**
 * Background service worker for @sable-ai/extension (dev build).
 *
 * Handles two message types from the popup:
 *
 *   { type: "start", agentId, apiUrl } — idempotently inject the SDK
 *     script tag into the active tab (main world via web_accessible_resources),
 *     wait for `window.Sable` to appear, then call
 *     `window.Sable.start({publicKey, apiUrl, vision})` in the main world.
 *
 *   { type: "stop" } — call `window.Sable.stop()` in the main world if the
 *     SDK is loaded. No-op otherwise.
 *
 * All "touch window.Sable" calls MUST pass world: "MAIN" to executeScript,
 * otherwise they run in the isolated world where Sable is undefined.
 */

interface StartMessage {
  type: "start";
  agentId: string;
  apiUrl: string;
}

interface StopMessage {
  type: "stop";
}

type IncomingMessage = StartMessage | StopMessage;

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
  const sdkUrl = chrome.runtime.getURL("sable.iife.js");
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (url: string) => {
      const w = window as unknown as { Sable?: unknown };
      if (w.Sable) return; // already injected, skip
      const s = document.createElement("script");
      s.src = url;
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
                vision?: { enabled: boolean };
              }): Promise<void>;
            };
          }
        ).Sable.start({
          publicKey,
          apiUrl,
          // Extension injection is always agent-drives-the-user-browser,
          // so vision is on by default — the agent needs to see the page.
          vision: { enabled: true },
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
    if (msg?.type === "start") {
      handleStart(msg).then(
        () => sendResponse({ ok: true }),
        (err: unknown) =>
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
      );
      return true; // async response
    }
    if (msg?.type === "stop") {
      handleStop().then(
        () => sendResponse({ ok: true }),
        (err: unknown) =>
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
      );
      return true; // async response
    }
    return false;
  },
);
