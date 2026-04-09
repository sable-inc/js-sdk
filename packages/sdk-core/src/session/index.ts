/**
 * Session lifecycle.
 *
 * `Session` is the glue layer: it fetches connection details, dynamically
 * imports `livekit-client`, connects, publishes the mic, registers the
 * runtime + browser-bridge RPCs, and — if vision is enabled — starts the
 * frame source + video publisher and mounts the debug panel. `start()`
 * returns once the room is live and mic is publishing; events are emitted
 * via the `SableEventEmitter`.
 *
 * Only one session is allowed at a time. `start()` throws if a session is
 * already active; callers must `stop()` first. `stop()` is idempotent.
 *
 * `livekit-client` is imported dynamically (not statically) so the IIFE
 * entry bundle stays small — the heavy client only loads when a customer
 * actually calls `start()`.
 */

import {
  fetchConnectionDetails,
  DEFAULT_API_URL,
} from "../connection";
import { SableEventEmitter } from "../events";
import { installRuntime } from "../runtime";
import { registerBrowserHandlers } from "../browser-bridge";
import {
  startVision,
  type LiveKitPublishLib,
  type VisionHandle,
} from "../vision";
import type {
  SableAPI,
  SableEventHandler,
  SableEvents,
  StartOptions,
} from "../types";
import { VERSION } from "../version";
import { mountDebugPanel, shouldShowDebugPanel } from "./debug-panel";

// ── livekit-client structural types ───────────────────────────────────────
//
// The client is dynamically imported so we can't use its types at the top
// level. These mirror only the subset we call.

interface LiveKitRoom {
  connect(url: string, token: string): Promise<unknown>;
  disconnect(): Promise<void>;
  on(event: string, handler: (...args: unknown[]) => void): unknown;
  registerRpcMethod(
    method: string,
    handler: (data: { payload: string }) => Promise<string>,
  ): void;
  localParticipant: {
    identity?: string;
    setMicrophoneEnabled(enabled: boolean): Promise<unknown>;
    performRpc(opts: {
      destinationIdentity: string;
      method: string;
      payload: string;
    }): Promise<string>;
    publishTrack(
      track: unknown,
      options?: { source?: unknown; name?: string },
    ): Promise<{ trackSid?: string }>;
    unpublishTrack(track: unknown, stopOnUnpublish?: boolean): Promise<unknown>;
  };
  remoteParticipants?: Map<
    string,
    { identity?: string; trackPublications?: Map<string, unknown> }
  >;
}

// ── Agent handshake ───────────────────────────────────────────────────────
//
// Agents emit `agentReady` after joining and wait for a `uiReady` reply
// before generating their greeting. If we don't reply within ~10s the agent
// gives up and never publishes audio.
// Reference: parley/src/features/agent/hooks/useAgentConnection.ts.

const UI_READY_RETRY_ATTEMPTS = 5;
const UI_READY_RETRY_DELAY_MS = 500;

function findAgentIdentity(room: LiveKitRoom): string | null {
  const remotes = room.remoteParticipants
    ? Array.from(room.remoteParticipants.values())
    : [];
  const agent = remotes.find(
    (p) => typeof p.identity === "string" && p.identity.startsWith("agent"),
  );
  return agent?.identity ?? remotes[0]?.identity ?? null;
}

async function sendUiReady(room: LiveKitRoom): Promise<void> {
  for (let attempt = 1; attempt <= UI_READY_RETRY_ATTEMPTS; attempt++) {
    const identity = findAgentIdentity(room);
    if (!identity) {
      console.warn("[Sable] sendUiReady: no agent participant yet", { attempt });
      await new Promise((r) => setTimeout(r, UI_READY_RETRY_DELAY_MS));
      continue;
    }
    try {
      await room.localParticipant.performRpc({
        destinationIdentity: identity,
        method: "uiReady",
        payload: JSON.stringify({ timestamp: Date.now() }),
      });
      console.log("[Sable] uiReady sent", { identity, attempt });
      return;
    } catch (err) {
      console.warn("[Sable] uiReady RPC failed", { attempt, err });
      await new Promise((r) => setTimeout(r, UI_READY_RETRY_DELAY_MS));
    }
  }
  console.error("[Sable] uiReady: exhausted retries — agent will not greet");
}

// ── Session class ─────────────────────────────────────────────────────────

/**
 * One active session at a time. The class is internal — customers interact
 * with the `SableAPI` singleton installed on `window.Sable` (see `global.ts`).
 * Keeping a class here (rather than a bag of module-level vars) makes the
 * state ownership explicit and the teardown path easier to reason about.
 */
export class Session implements SableAPI {
  readonly version = VERSION;
  private readonly emitter = new SableEventEmitter();
  private activeRoom: LiveKitRoom | null = null;
  private visionHandle: VisionHandle | null = null;
  private unmountDebugPanel: (() => void) | null = null;

  on<E extends keyof SableEvents>(
    event: E,
    handler: SableEventHandler<E>,
  ): () => void {
    return this.emitter.on(event, handler);
  }

  async start(opts: StartOptions): Promise<void> {
    if (this.activeRoom) {
      throw new Error("Sable already started; call stop() first");
    }

    // Public key resolution. `publicKey` wins when both are passed, but
    // `agentPublicId` remains supported during beta so customers upgrading
    // from an earlier build don't have to rename the field the same day
    // they update the package.
    const publicKey = opts.publicKey ?? opts.agentPublicId;
    if (!publicKey) {
      throw new Error("Sable.start: `publicKey` is required");
    }

    const apiUrl = opts.apiUrl ?? DEFAULT_API_URL;
    console.log("[Sable] fetching connection details", { apiUrl });
    const details = await fetchConnectionDetails({ apiUrl, publicKey });
    console.log("[Sable] connection details received", {
      roomName: details.roomName,
      participantName: details.participantName,
    });

    // Dynamic import keeps the IIFE entry small; livekit-client is ~200KB
    // minified and only needed once a session actually starts.
    const livekit = await import("livekit-client");
    const { Room, RoomEvent, LocalVideoTrack, Track } = livekit;
    const room = new Room() as unknown as LiveKitRoom;

    const publishLib: LiveKitPublishLib = {
      LocalVideoTrack: LocalVideoTrack as unknown as LiveKitPublishLib["LocalVideoTrack"],
      Track: Track as unknown as LiveKitPublishLib["Track"],
    };

    // Handshake handler MUST be registered before room.connect() so it's
    // ready when the first RPC arrives.
    room.registerRpcMethod("agentReady", async () => {
      console.log("[Sable] RPC agentReady received");
      void sendUiReady(room);
      return JSON.stringify({ success: true });
    });

    // Browser bridge: 6 browser.* handlers. Safe to register even for
    // voice-only sessions — the agent just won't call them.
    registerBrowserHandlers(room);

    // Runtime: default methods (clipboard, switchView) + customer overrides
    // and extensions passed via `opts.runtime`.
    installRuntime(room, opts.runtime);

    this.wireRoomEvents(room, RoomEvent);

    await room.connect(details.serverUrl, details.participantToken);
    await room.localParticipant.setMicrophoneEnabled(true);

    this.activeRoom = room;

    // Vision is off by default. Opt in with `vision: { enabled: true }`.
    if (opts.vision?.enabled) {
      try {
        this.visionHandle = await startVision({
          room: room as unknown as Parameters<typeof startVision>[0]["room"],
          lib: publishLib,
          options: opts.vision,
        });
        if (shouldShowDebugPanel(opts.debug)) {
          this.unmountDebugPanel = mountDebugPanel(this.visionHandle.canvas);
        }
      } catch (e) {
        console.warn("[Sable] failed to start vision", e);
      }
    }

    console.log("[Sable] session live", {
      roomName: details.roomName,
      participantName: details.participantName,
    });
    this.emitter.emit("session:started", {
      roomName: details.roomName,
      participantName: details.participantName,
    });

    // Watchdog: warn loudly if no remote audio track shows up within 10s.
    setTimeout(() => {
      if (this.activeRoom !== room) return;
      const r = room as unknown as {
        remoteParticipants?: Map<
          string,
          {
            identity?: string;
            trackPublications?: Map<
              string,
              { kind?: string; isSubscribed?: boolean }
            >;
          }
        >;
      };
      const remotes = r.remoteParticipants
        ? Array.from(r.remoteParticipants.values())
        : [];
      const summary = remotes.map((p) => ({
        identity: p.identity,
        tracks: p.trackPublications
          ? Array.from(p.trackPublications.values()).map((t) => ({
              kind: t.kind,
              subscribed: t.isSubscribed,
            }))
          : [],
      }));
      const anyAudio = summary.some((p) =>
        p.tracks.some((t) => t.kind === "audio"),
      );
      if (!anyAudio) {
        console.warn(
          "[Sable] no remote audio track after 10s — agent worker probably failed to publish. Remote participants:",
          summary,
        );
      }
    }, 10000);
  }

  async stop(): Promise<void> {
    const room = this.activeRoom;
    if (!room) return;
    this.activeRoom = null;

    if (this.unmountDebugPanel) {
      try {
        this.unmountDebugPanel();
      } catch (e) {
        console.warn("[Sable] debug panel unmount failed", e);
      }
      this.unmountDebugPanel = null;
    }

    if (this.visionHandle) {
      try {
        await this.visionHandle.stop();
      } catch (e) {
        console.warn("[Sable] vision stop failed", e);
      }
      this.visionHandle = null;
    }

    try {
      await room.localParticipant.setMicrophoneEnabled(false);
    } catch (err) {
      console.warn("[Sable] setMicrophoneEnabled(false) failed", err);
    }
    await room.disconnect();
    console.log("[Sable] session ended");
    this.emitter.emit("session:ended", {});
  }

  /**
   * Subscribe to LiveKit room events and translate the interesting ones into
   * `SableEvents`. Keeps the Session → customer event surface decoupled from
   * the LiveKit event names so we can swap the transport later without
   * breaking subscribers.
   */
  private wireRoomEvents(
    room: LiveKitRoom,
    RoomEvent: Record<string, string>,
  ): void {
    room.on(RoomEvent.ConnectionStateChanged, (state: unknown) => {
      console.log("[Sable] ConnectionStateChanged", state);
    });
    room.on(RoomEvent.Disconnected, (reason: unknown) => {
      console.log("[Sable] Disconnected", reason);
      // Forward to stop() so cleanup runs exactly once regardless of who
      // initiated the disconnect (customer call vs. server drop).
      if (this.activeRoom === room) {
        void this.stop().catch((e) =>
          console.warn("[Sable] stop on disconnect failed", e),
        );
      }
    });
    room.on(RoomEvent.ParticipantConnected, (participant: unknown) => {
      const p = participant as {
        identity?: string;
        sid?: string;
        metadata?: string;
      };
      console.log("[Sable] ParticipantConnected", {
        identity: p.identity,
        sid: p.sid,
      });
    });
    room.on(RoomEvent.ParticipantDisconnected, (participant: unknown) => {
      const p = participant as { identity?: string };
      console.warn("[Sable] ParticipantDisconnected", { identity: p.identity });
    });
    room.on(
      RoomEvent.TrackSubscribed,
      (track: unknown, _pub: unknown, participant: unknown) => {
        const t = track as {
          kind?: string;
          attach?: () => HTMLMediaElement;
        };
        const p = participant as { identity?: string };
        console.log("[Sable] TrackSubscribed", {
          kind: t.kind,
          participant: p.identity,
        });
        // Auto-attach remote audio so the agent's voice plays without the
        // customer needing to wire up an <audio> element themselves.
        if (t.kind === "audio" && typeof t.attach === "function") {
          const el = t.attach();
          el.setAttribute("data-sable", "1");
          el.setAttribute("playsinline", "");
          el.autoplay = true;
          document.body.appendChild(el);
          console.log("[Sable] attached remote audio element");
        }
      },
    );
    room.on(RoomEvent.TrackUnsubscribed, (track: unknown) => {
      const t = track as { detach?: () => HTMLMediaElement[] };
      if (typeof t.detach === "function") {
        for (const el of t.detach()) {
          el.remove();
        }
      }
    });
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers: unknown) => {
      const list = (speakers as Array<{ identity?: string }>) ?? [];
      const agentTalking = list.some(
        (s) => typeof s.identity === "string" && s.identity.startsWith("agent"),
      );
      const userTalking = list.some(
        (s) =>
          typeof s.identity === "string" && !s.identity.startsWith("agent"),
      );
      this.emitter.emit("agent:speaking", agentTalking);
      this.emitter.emit("user:speaking", userTalking);
    });
  }
}
