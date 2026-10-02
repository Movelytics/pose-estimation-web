/**
 * External frames: the host page owns the camera and the preview, and pushes
 * frames to {@link PoseTrackerClient.processFrame}. The SDK infers, runs the
 * active exercise engine, and returns data. It mounts and draws nothing.
 */

import type { PoseTrackerEvent } from './events';
import type { Pose } from './pose';

export interface ExternalFrame {
  /** Decoded frame, used as is. Takes precedence over `base64` / `uri`. */
  image?: ImageBitmap | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement;
  /** Encoded image (JPEG / PNG) without the `data:` prefix. */
  base64?: string;
  /** Image URL (`blob:`, `data:`, or same-origin / CORS-enabled `https:`). */
  uri?: string;
  /** Width of the frame you send. Keep the longest side at 256 px or less. */
  width: number;
  height: number;
  /** Capture time of the frame. The exercise engine uses it for timing. */
  timestampMs: number;
  /**
   * Mirror keypoints horizontally, as for a selfie preview. Default `true`.
   * Pass `false` for a back camera or an unmirrored preview.
   */
  mirrored?: boolean;
  /** MIME type of `base64`. Default `image/jpeg`. */
  mime?: string;
}

export interface ExternalFrameResult {
  /** True when a previous frame was still running. Nothing was inferred. */
  dropped: boolean;
  /**
   * Pose for this frame, or the last pose when `dropped`. Keypoints are
   * normalized 0–1 to the frame you sent.
   */
  pose: Pose | null;
  /**
   * Events produced by this frame (keypoints, counter, posture, angles,
   * form score, …), in emission order. They are also delivered to `on()`
   * listeners. Empty when `dropped`.
   */
  events: PoseTrackerEvent[];
}
