/**
 * SDK side of the Sable browser bridge.
 *
 * Registers six LiveKit RPC handlers that the agent's UserBrowserBridge
 * (`sable-agentkit/components/browser/bridges/user.py`) calls into:
 *
 *   browser.execute_action  → dispatches an Action variant against the page
 *   browser.get_dom_state   → wireframe screenshot + visible-element list
 *   browser.get_url         → window.location.href
 *   browser.get_viewport    → window.innerWidth/innerHeight
 *   browser.verify_selector → !!document.querySelector(selector)
 *   browser.settle          → mutation-observer quiet-period wait
 *
 * The wire contract is the canonical Python implementation in
 * `sable_agentkit/components/browser/bridges/wire.py` — every field shape
 * and Action `kind` tag must match it exactly.
 */

import type { RpcRoom } from "../rpc";
import { dispatchAction, type ActionEnvelope } from "./actions";
import { captureDomState, settle } from "./dom-state";

function makeHandler(
  name: string,
  body: (req: Record<string, unknown>) => Promise<unknown>,
): (data: { payload: string }) => Promise<string> {
  return async (data) => {
    let req: Record<string, unknown> = {};
    try {
      req = data.payload ? JSON.parse(data.payload) : {};
    } catch (e) {
      console.warn(`[Sable] ${name}: bad JSON payload`, e);
    }
    try {
      const result = await body(req);
      return JSON.stringify(result ?? {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Sable] ${name}: handler error`, msg);
      return JSON.stringify({ error: msg });
    }
  };
}

export function registerBrowserHandlers(room: RpcRoom): void {
  room.registerRpcMethod(
    "browser.execute_action",
    makeHandler("browser.execute_action", async (req) => {
      const action = req.action as ActionEnvelope | undefined;
      if (!action || typeof action !== "object") {
        throw new Error("execute_action: missing action");
      }
      await dispatchAction(action);
      return {};
    }),
  );

  room.registerRpcMethod(
    "browser.get_dom_state",
    makeHandler("browser.get_dom_state", async () => captureDomState()),
  );

  room.registerRpcMethod(
    "browser.get_url",
    makeHandler("browser.get_url", async () => ({ url: window.location.href })),
  );

  room.registerRpcMethod(
    "browser.get_viewport",
    makeHandler("browser.get_viewport", async () => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })),
  );

  room.registerRpcMethod(
    "browser.verify_selector",
    makeHandler("browser.verify_selector", async (req) => {
      const selector = typeof req.selector === "string" ? req.selector : "";
      let matches = false;
      try {
        matches = !!document.querySelector(selector);
      } catch {
        matches = false;
      }
      return { matches };
    }),
  );

  room.registerRpcMethod(
    "browser.settle",
    makeHandler("browser.settle", async () => {
      await settle();
      return {};
    }),
  );

  console.log("[Sable] browser bridge RPCs registered");
}
