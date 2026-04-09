/**
 * sable-api `/connection-details` fetch.
 *
 * Isolated in its own file because this is the ONE thing that changes when
 * the backend flips from raw agent IDs (`?agentPublicId=...`) to publishable
 * keys (`?publicKey=pk_live_...` + per-agent allowed-domains origin check).
 * When that lands, the diff is contained to this file.
 *
 * Until then: we accept `publicKey` from the customer and pass it through as
 * `?agentPublicId=...` on the wire, which keeps the current sable-api
 * contract working while the public-facing option name is already the one
 * we want long-term.
 */

export const DEFAULT_API_URL = "https://sable-api-gateway-9dfmhij9.wl.gateway.dev";

export interface ConnectionDetails {
  serverUrl: string;
  roomName: string;
  participantToken: string;
  participantName: string;
}

export interface FetchConnectionDetailsInput {
  apiUrl: string;
  /** Either a `pk_live_...` publishable key or a raw `agt_...` agent ID. */
  publicKey: string;
}

export async function fetchConnectionDetails(
  input: FetchConnectionDetailsInput,
): Promise<ConnectionDetails> {
  const url = new URL("/connection-details", input.apiUrl);
  // During beta the backend still reads this as `agentPublicId`. When pk_live
  // keys land, rename here (and only here).
  url.searchParams.set("agentPublicId", input.publicKey);
  // The SDK is, by definition, the "agent drives the user's browser" path.
  // There is no nickel-backed SDK mode — that's what the virtual browser
  // product handles — so we hardcode the bridge attribute here instead of
  // leaking it into the public API.
  url.searchParams.set("bridge", "user");

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`connection-details failed: ${res.status} ${body}`);
  }
  return (await res.json()) as ConnectionDetails;
}
