/**
 * Public type surface for @sable-ai/sdk-core.
 *
 * Everything a consumer can touch lives here. Internal types stay in their
 * respective modules so we never accidentally ship them in the published
 * `.d.ts` bundle.
 */

// ── Frame sources ──────────────────────────────────────────────────────────
//
// Discriminated union — `type` is the tag. Adding a new source (e.g. `video`,
// `webgl`) means adding a new variant here and a new case in
// `vision/frame-source.ts`. The public API stays stable.

export interface WireframeFrameSource {
  type: "wireframe";
  /** Capture rate in frames per second. Default: 2. */
  rate?: number;
  features?: {
    /**
     * Include rendered images in the wireframe (instead of placeholder boxes).
     * Slightly higher CPU + bandwidth. Default: true.
     */
    includeImages?: boolean;
  };
}

export interface FnFrameSource {
  type: "fn";
  /** Capture rate in frames per second. Default: 2. */
  rate?: number;
  /**
   * Called at `rate` Hz. Return an `HTMLCanvasElement` or `ImageBitmap` that
   * the SDK will publish to the agent as a video track. Useful for feeding
   * custom sources like a 3D scene, a `<video>` element, or a WebGL surface
   * that the DOM walker can't introspect.
   */
  captureFn: () => HTMLCanvasElement | ImageBitmap;
}

export type FrameSource = WireframeFrameSource | FnFrameSource;

// ── Vision ─────────────────────────────────────────────────────────────────

export interface VisionOptions {
  /**
   * Whether to publish a video track of the page to the agent. Default: false.
   * Turn this on for agents that should be able to *see* the user's screen
   * in addition to hearing them.
   */
  enabled?: boolean;
  /**
   * Where video frames come from. Defaults to the built-in wireframe renderer
   * at 2 fps with images enabled.
   */
  frameSource?: FrameSource;
}

// ── Runtime (agent → page RPC surface) ─────────────────────────────────────
//
// The agent can call methods on the page over LiveKit RPC. `sdk-core` ships
// default implementations for a known set of methods (clipboard copy, video
// overlay, and no-op placeholders for host-UI-specific methods). Customers
// override any of them by passing matching keys in `Sable.start({ runtime })`,
// and can add new methods specific to their app that become callable by the
// agent. One unified surface: no distinction between "SDK methods" and
// "customer methods" from the agent's perspective.

export type RuntimeMethod = (
  payload: Record<string, unknown>,
) => unknown | Promise<unknown>;

/**
 * Map of method name → handler. Used both for the user-provided overrides
 * passed to `Sable.start({ runtime })` and for the SDK's internal defaults.
 */
export interface RuntimeMethods {
  [method: string]: RuntimeMethod;
}

// ── Start options ──────────────────────────────────────────────────────────

export interface StartOptions {
  /**
   * Publishable key for the agent (from platform.withsable.com → your agent
   * → Web SDK → Public key). Safe to ship in client-side code — the security
   * boundary is the allowed-domains list configured alongside the key.
   *
   * During beta, raw agent IDs (e.g. `agt_...`) are accepted here too.
   */
  publicKey?: string;

  /**
   * @deprecated Use `publicKey` instead. Accepted as an alias during beta and
   * will be removed before 1.0. If both are set, `publicKey` wins.
   */
  agentPublicId?: string;

  /**
   * What the agent can see. Off by default — opt in for vision-enabled agents.
   */
  vision?: VisionOptions;

  /**
   * Overrides + extensions for methods the agent can RPC into the page.
   * Unspecified methods fall back to the SDK's default implementations. New
   * methods become callable by the agent as-is.
   */
  runtime?: RuntimeMethods;

  /**
   * Arbitrary metadata forwarded to the agent at session start. Surfaces
   * verbatim in the agent's initial prompt.
   */
  context?: Record<string, unknown>;

  /**
   * Dev-only: mount a floating preview panel showing the exact wireframe
   * canvas being published to the agent. Can also be enabled via
   * `?sable-debug=1` or `localStorage["sable:debug"]="1"`.
   */
  debug?: boolean;

  /**
   * Override the sable-api base URL. Dev/test only. Defaults to the
   * production gateway.
   * @internal
   */
  apiUrl?: string;
}

// ── Events ─────────────────────────────────────────────────────────────────
//
// Fire-and-forget — the SDK does not care whether customers subscribe.

export interface SableEvents {
  /** Fired once the room is connected, mic is live, and handshake is done. */
  "session:started": { roomName: string; participantName: string };
  /** Fired once when the session ends for any reason. */
  "session:ended": { reason?: string };
  /** Fired whenever the agent starts or stops speaking. */
  "agent:speaking": boolean;
  /** Fired whenever the local user starts or stops speaking. */
  "user:speaking": boolean;
  /** Fired for any non-fatal error during the session. */
  error: Error;
}

export type SableEventHandler<E extends keyof SableEvents> = (
  payload: SableEvents[E],
) => void;

// ── Public API surface ─────────────────────────────────────────────────────

export interface SableAPI {
  /** SDK version string, matches the npm package version. */
  version: string;
  /** Start a voice (and optionally vision) session with the agent. */
  start(opts: StartOptions): Promise<void>;
  /** Tear down the active session. No-op if none. */
  stop(): Promise<void>;
  /**
   * Subscribe to a session event. Returns an unsubscribe function. Fire-and-
   * forget — the SDK does not care whether you subscribe.
   */
  on<E extends keyof SableEvents>(
    event: E,
    handler: SableEventHandler<E>,
  ): () => void;
}

declare global {
  interface Window {
    Sable?: SableAPI;
  }
}
