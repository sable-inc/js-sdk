/**
 * Runtime: the set of methods the agent can RPC into the page.
 *
 * Historically these were called "UI stubs" because they originated as
 * no-op placeholders for methods parley implements in its call overlay.
 * That framing no longer fits: half of them now do real work, and the
 * public API lets customers replace any of them AND add new ones through
 * the same `Sable.start({ runtime })` surface.
 *
 * The shape:
 *
 *   1. `DEFAULT_RUNTIME` — built-in implementations shipped with the SDK.
 *      A few do real work (clipboard copy, video overlay); the rest are
 *      no-ops for methods that only make sense in a host-app call UI.
 *
 *   2. `installRuntime(room, userRuntime)` — merges `userRuntime` over the
 *      defaults and registers every entry as a LiveKit RPC handler on
 *      `room`. Agent RPC calls → run the matching method → return a
 *      JSON-encoded result.
 *
 * Customers extend the runtime by passing new keys in `userRuntime`:
 * anything you put in becomes callable by the agent as-is. This means
 * the same surface handles both "override a built-in" and "expose a
 * business-logic tool" — one concept, not two.
 */

import { safeParse, type RpcRoom } from "../rpc";
import type { RuntimeMethod, RuntimeMethods } from "../types";
import { handleCopyable } from "./clipboard";
import { mountVideoOverlay, removeViewOverlay } from "./video-overlay";

// ── Default runtime ────────────────────────────────────────────────────────
//
// Methods that do meaningful work out of the box (clipboard, video overlay)
// plus no-ops for the set of call-UI methods the agent can call. The no-ops
// are here so agent tool calls always succeed even if the host app hasn't
// overridden them — without these, the agent's builtin tools raise
// "Method not supported at destination" and the conversation derails.

function noop(): Promise<{ success: true }> {
  return Promise.resolve({ success: true });
}

export const DEFAULT_RUNTIME: RuntimeMethods = {
  // Real defaults
  sendToolMessage: (payload) => handleCopyable("sendToolMessage", payload),
  sendCopyableText: (payload) => handleCopyable("sendCopyableText", payload),
  switchView: async (payload) => {
    const mode = typeof payload.mode === "string" ? payload.mode : "";
    const url = typeof payload.url === "string" ? payload.url : "";
    if (mode === "video" && url) {
      try {
        mountVideoOverlay(url);
        return { success: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[Sable] switchView: failed to mount video overlay", msg);
        return { success: false, error: msg };
      }
    }
    removeViewOverlay();
    return { success: true };
  },

  // No-ops: host-UI-specific methods. Host apps override to render into
  // their own call surface; the SDK's default answer is "ack, did nothing".
  setCallControlsEnabled: noop,
  setUserInputEnabled: noop,
  setAgentInControl: noop,
  showSuggestedReplies: noop,
  hideSuggestedReplies: noop,
  highlightHangup: noop,
  hideVideo: noop,
  showVideo: noop,
  stopScreenShare: noop,
  showSlide: noop,
  hideSlide: noop,
  responseFailed: noop,
  requestContinue: noop,
  greetingComplete: noop,
  speechComplete: noop,
  enableMicrophone: noop,
  requestDisconnect: noop,
  setNickelSession: noop,
};

// ── Registration ───────────────────────────────────────────────────────────

/**
 * Wrap a runtime method in an RPC-compatible handler: decode JSON payload,
 * run the method, re-encode the result. Errors become `{ error: message }`
 * responses — never thrown back to the caller, since LiveKit RPC propagates
 * exceptions to the agent and derails the conversation.
 */
function toRpcHandler(
  name: string,
  method: RuntimeMethod,
): (data: { payload: string }) => Promise<string> {
  return async (data) => {
    const payload = safeParse(data.payload);
    try {
      const result = await method(payload);
      return JSON.stringify(result ?? { success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Sable] runtime method "${name}" threw`, msg);
      return JSON.stringify({ success: false, error: msg });
    }
  };
}

/**
 * Merge the user-provided runtime over `DEFAULT_RUNTIME` and register every
 * entry as a LiveKit RPC handler on `room`. Later keys win — so passing
 * `{ switchView: myImpl }` replaces the default video-overlay behaviour,
 * while passing `{ activateTrial: ... }` exposes a new method the agent
 * can call without touching the built-ins.
 */
export function installRuntime(
  room: RpcRoom,
  userRuntime: RuntimeMethods = {},
): void {
  const merged: RuntimeMethods = { ...DEFAULT_RUNTIME, ...userRuntime };
  for (const [name, method] of Object.entries(merged)) {
    room.registerRpcMethod(name, toRpcHandler(name, method));
  }
  const overrides = Object.keys(userRuntime).filter(
    (k) => k in DEFAULT_RUNTIME,
  );
  const extensions = Object.keys(userRuntime).filter(
    (k) => !(k in DEFAULT_RUNTIME),
  );
  console.log("[Sable] runtime installed", {
    total: Object.keys(merged).length,
    overrides,
    extensions,
  });
}
