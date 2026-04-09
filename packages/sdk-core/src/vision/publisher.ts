/**
 * Publish a canvas as a LiveKit screenshare video track.
 *
 * Vision is delivered as a regular LiveKit video track rather than raw
 * bytes: we draw each frame into a persistent canvas (see `frame-source.ts`)
 * and hand that canvas to `canvas.captureStream(fps)`. The resulting
 * MediaStreamTrack gets wrapped in a LocalVideoTrack and published as
 * `Track.Source.ScreenShare`, so the agent subscribes to it the same way
 * it would subscribe to any screenshare — no custom byte-stream handler,
 * no per-frame PNG decode, and the codec delta-compresses mostly-static
 * pages so bandwidth stays low.
 *
 * The fps passed to `captureStream` should match the frame source's render
 * rate; a mismatch either drops frames (encoder faster than source) or
 * wastes bandwidth (encoder slower than source). `vision/index.ts` owns
 * the pairing.
 */

// ── livekit-client structural types ───────────────────────────────────────
//
// sdk-core does NOT statically import `livekit-client` — the heavy runtime
// lives behind a dynamic import so the IIFE entry bundle stays small. We
// describe only the minimum surface the publisher actually touches here.

interface LocalTrackPublication {
  trackSid?: string;
}

export interface PublishCapableRoom {
  localParticipant: {
    publishTrack(
      track: unknown,
      options?: { source?: unknown; name?: string },
    ): Promise<LocalTrackPublication>;
    unpublishTrack(track: unknown, stopOnUnpublish?: boolean): Promise<unknown>;
  };
}

export interface LiveKitPublishLib {
  LocalVideoTrack: new (
    mediaStreamTrack: MediaStreamTrack,
    constraints?: unknown,
    userProvidedTrack?: boolean,
  ) => unknown;
  Track: {
    Source: {
      ScreenShare: unknown;
    };
  };
}

const BROWSER_TRACK_NAME = "browser";

/**
 * Publish `canvas` as a screenshare track at `fps` frames per second.
 * Returns an async teardown that unpublishes the track and stops the
 * underlying MediaStreamTrack.
 */
export async function publishCanvasAsVideoTrack(
  room: PublishCapableRoom,
  lib: LiveKitPublishLib,
  canvas: HTMLCanvasElement,
  fps: number,
): Promise<() => Promise<void>> {
  const mediaStream = (canvas as unknown as {
    captureStream: (fps?: number) => MediaStream;
  }).captureStream(fps);

  const videoTracks = mediaStream.getVideoTracks();
  if (videoTracks.length === 0) {
    throw new Error("canvas.captureStream produced no video tracks");
  }
  const mediaStreamTrack = videoTracks[0];

  // userProvidedTrack=true → livekit-client won't try to restart the
  // track (which would fail for a canvas-backed MediaStreamTrack).
  const localTrack = new lib.LocalVideoTrack(
    mediaStreamTrack,
    undefined,
    true,
  );

  const publication = await room.localParticipant.publishTrack(localTrack, {
    source: lib.Track.Source.ScreenShare,
    name: BROWSER_TRACK_NAME,
  });

  console.log("[Sable] vision track published", {
    trackSid: publication.trackSid,
    fps,
  });

  return async () => {
    try {
      await room.localParticipant.unpublishTrack(localTrack, true);
    } catch (e) {
      console.warn("[Sable] vision unpublishTrack failed", e);
    }
    try {
      mediaStreamTrack.stop();
    } catch {
      /* ignore */
    }
    console.log("[Sable] vision track stopped");
  };
}
