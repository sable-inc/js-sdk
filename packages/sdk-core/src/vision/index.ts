/**
 * Vision entry point.
 *
 * `startVision` owns the full lifecycle of "what the agent sees":
 *
 *   1. create a capture canvas sized to the viewport
 *   2. start the configured frame source, drawing into that canvas
 *   3. publish the canvas as a LiveKit screenshare video track
 *
 * Returns both the canvas (so the session can hand it to the debug panel,
 * which just renders the exact pixels we publish) and a combined async stop
 * function. Everything is off by default — callers pass `vision: { enabled:
 * true }` in `Sable.start({ ... })` to opt in.
 */

import type { FrameSource, VisionOptions } from "../types";
import { startFrameSource } from "./frame-source";
import {
  publishCanvasAsVideoTrack,
  type LiveKitPublishLib,
  type PublishCapableRoom,
} from "./publisher";

export type { LiveKitPublishLib, PublishCapableRoom } from "./publisher";

const DEFAULT_FRAME_SOURCE: FrameSource = {
  type: "wireframe",
  rate: 2,
  features: { includeImages: true },
};

export interface StartVisionArgs {
  room: PublishCapableRoom;
  lib: LiveKitPublishLib;
  options: VisionOptions;
}

export interface VisionHandle {
  /** The canvas being published. Useful for the debug panel. */
  canvas: HTMLCanvasElement;
  /** Stop the frame loop and unpublish the track. */
  stop: () => Promise<void>;
}

export async function startVision(args: StartVisionArgs): Promise<VisionHandle> {
  const source: FrameSource = args.options.frameSource ?? DEFAULT_FRAME_SOURCE;
  const fps = typeof source.rate === "number" && source.rate > 0 ? source.rate : 2;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, window.innerWidth);
  canvas.height = Math.max(1, window.innerHeight);

  const stopFrameSource = startFrameSource(source, canvas);

  let stopPublish: () => Promise<void>;
  try {
    stopPublish = await publishCanvasAsVideoTrack(args.room, args.lib, canvas, fps);
  } catch (err) {
    stopFrameSource();
    throw err;
  }

  return {
    canvas,
    stop: async () => {
      stopFrameSource();
      await stopPublish();
    },
  };
}
