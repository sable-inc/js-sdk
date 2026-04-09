/**
 * Shared LiveKit RPC primitives.
 *
 * Both `runtime/` (agent → page method calls) and `browser-bridge/` (agent
 * driving the user's browser) register handlers on the room via
 * `registerRpcMethod`. They don't need the full LiveKit `Room` type — just the
 * single method — so we describe the minimum shape here. This keeps the heavy
 * `livekit-client` import dynamic and out of the IIFE entry bundle.
 */

export interface RpcRoom {
  registerRpcMethod(
    method: string,
    handler: (data: { payload: string }) => Promise<string>,
  ): void;
}

/**
 * Parse an RPC payload string into a plain object. RPC payloads are JSON but
 * we don't want a single malformed call from the agent to throw inside a
 * handler — LiveKit RPC propagates exceptions back to the caller and the
 * agent's tool use logic treats that as a hard error that can derail the
 * conversation. Soft-failing to `{}` lets the handler decide what to do.
 */
export function safeParse(payload: string): Record<string, unknown> {
  try {
    return payload ? (JSON.parse(payload) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
