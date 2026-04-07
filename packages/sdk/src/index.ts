/**
 * @sable-ai/sdk — v0 voice-only entry point.
 *
 * Installs `window.Sable = { version, start, stop }` when loaded in a browser.
 * `start(opts)` fetches LiveKit connection details from sable-api, dynamically
 * imports `livekit-client`, connects to the returned room, and publishes the
 * local microphone. Observability is console-only for v0.
 */

export const VERSION = "0.0.2";

const DEFAULT_API_URL = "https://sable-api-gateway-9dfmhij9.wl.gateway.dev";

export interface StartOpts {
  agentPublicId: string;
  apiUrl?: string;
  nickelRegion?: string;
}

export interface SableAPI {
  version: string;
  start(opts: StartOpts): Promise<void>;
  stop(): Promise<void>;
}

declare global {
  interface Window {
    Sable?: SableAPI;
  }
}

interface ConnectionDetails {
  serverUrl: string;
  roomName: string;
  participantToken: string;
  participantName: string;
}

// Minimal structural type for the LiveKit Room instance we use.
// Defined so we don't have to import a type from livekit-client at the
// top level of the IIFE (the client is dynamically imported inside start()).
interface LiveKitRoom {
  connect(url: string, token: string): Promise<unknown>;
  disconnect(): Promise<void>;
  on(event: string, handler: (...args: unknown[]) => void): unknown;
  localParticipant: {
    setMicrophoneEnabled(enabled: boolean): Promise<unknown>;
  };
}

let activeRoom: LiveKitRoom | null = null;

async function fetchConnectionDetails(
  apiUrl: string,
  agentPublicId: string,
  nickelRegion: string | undefined,
): Promise<ConnectionDetails> {
  const url = new URL("/connection-details", apiUrl);
  url.searchParams.set("agentPublicId", agentPublicId);
  if (nickelRegion) {
    url.searchParams.set("nickelRegion", nickelRegion);
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`connection-details failed: ${res.status} ${body}`);
  }
  return (await res.json()) as ConnectionDetails;
}

async function start(opts: StartOpts): Promise<void> {
  if (activeRoom) {
    throw new Error("Sable already started; call stop() first");
  }

  const apiUrl = opts.apiUrl ?? DEFAULT_API_URL;
  console.log("[Sable] fetching connection details", {
    apiUrl,
    agentPublicId: opts.agentPublicId,
  });
  const details = await fetchConnectionDetails(
    apiUrl,
    opts.agentPublicId,
    opts.nickelRegion,
  );
  console.log("[Sable] connection details received", {
    roomName: details.roomName,
    participantName: details.participantName,
  });

  const { Room, RoomEvent } = await import("livekit-client");
  const room = new Room() as unknown as LiveKitRoom;

  room.on(RoomEvent.ConnectionStateChanged, (state: unknown) => {
    console.log("[Sable] ConnectionStateChanged", state);
  });
  room.on(RoomEvent.Disconnected, (reason: unknown) => {
    console.log("[Sable] Disconnected", reason);
    activeRoom = null;
  });
  room.on(RoomEvent.ParticipantConnected, (participant: unknown) => {
    console.log("[Sable] ParticipantConnected", participant);
  });
  room.on(
    RoomEvent.TrackSubscribed,
    (track: unknown, pub: unknown, participant: unknown) => {
      console.log("[Sable] TrackSubscribed", { track, pub, participant });
    },
  );
  room.on(RoomEvent.TrackUnsubscribed, (track: unknown) => {
    console.log("[Sable] TrackUnsubscribed", track);
  });

  await room.connect(details.serverUrl, details.participantToken);
  await room.localParticipant.setMicrophoneEnabled(true);

  activeRoom = room;
  console.log("[Sable] session live", {
    roomName: details.roomName,
    participantName: details.participantName,
  });
}

async function stop(): Promise<void> {
  if (!activeRoom) {
    return;
  }
  const room = activeRoom;
  activeRoom = null;
  try {
    await room.localParticipant.setMicrophoneEnabled(false);
  } catch (err) {
    console.warn("[Sable] setMicrophoneEnabled(false) failed", err);
  }
  await room.disconnect();
  console.log("[Sable] session ended");
}

// Side effects only run in a browser. Guarded so the test env (bun:test)
// doesn't try to install on a nonexistent `window`.
if (typeof window !== "undefined") {
  window.Sable = { version: VERSION, start, stop };
  console.log("Sable SDK loaded", VERSION);
}
