/// <reference types="chrome" />

/**
 * Background service worker for @sable-ai/extension (dev build).
 *
 * Listens for {type: "inject"} messages from the popup and uses
 * chrome.scripting.executeScript to drop a <script src> tag into
 * the active tab that loads packages/sdk's IIFE bundle into the
 * page's main JS world.
 *
 * Why a <script src> tag instead of `world: "MAIN"` directly:
 * `chrome.scripting.executeScript({ files: [...] })` runs files in
 * the extension's isolated world, not the page's main world. To
 * load a separate JS file into the main world we have to inject a
 * script tag whose src points at a web_accessible_resource. The
 * fetched script then executes in the page's own JS realm.
 */

interface InjectMessage {
  type: "inject";
}

interface InjectResponse {
  ok: boolean;
  error?: string;
}

chrome.runtime.onMessage.addListener(
  (msg: InjectMessage, _sender, sendResponse: (r: InjectResponse) => void) => {
    if (msg?.type !== "inject") return;

    void (async () => {
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!tab?.id) {
          sendResponse({ ok: false, error: "no active tab" });
          return;
        }

        const sdkUrl = chrome.runtime.getURL("sable.iife.js");

        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (url: string) => {
            const s = document.createElement("script");
            s.src = url;
            s.onload = () => s.remove();
            (document.head || document.documentElement).appendChild(s);
          },
          args: [sdkUrl],
        });

        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    // Return true to keep the message channel open for the async sendResponse.
    return true;
  },
);
