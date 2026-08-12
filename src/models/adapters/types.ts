import type { Keypoint } from '../../types/pose';
import type { PoseEstimateInput } from '../../types/source';
import type { ResolvedPoseModel } from '../poseModels';

export interface Letterbox {
  offsetX: number;
  offsetY: number;
  drawW: number;
  drawH: number;
  vw: number;
  vh: number;
}

export interface DetectorFrameResult {
  /** Raw model output used for skeleton mapping (MoveNet: Float32Array length 51). */
  raw?: Float32Array | Float32ArrayLike;
  keypoints: Keypoint[];
  score: number;
  inferenceMs: number;
  /** Video-space keypoints for overlay (before object-fit:cover). */
  videoKeypoints: Array<{ name: string; xPx: number; yPx: number; score: number }>;
  letterbox: Letterbox;
}

export type Float32ArrayLike = ArrayLike<number>;

export type { PoseEstimateInput };

export interface PoseDetectorAdapter {
  readonly modelId: string;
  load(): Promise<void>;
  /**
   * Run one frame. Input must have non-zero dimensions
   * (HTMLVideoElement, HTMLImageElement, canvas, or ImageBitmap).
   * Returns null when the frame should be skipped.
   */
  estimate(
    input: PoseEstimateInput,
    options: { facingMode: 'user' | 'environment'; displayWidth: number; displayHeight: number },
  ): Promise<DetectorFrameResult | null>;
  dispose(): void;
}

export interface CreateAdapterContext {
  resolved: ResolvedPoseModel;
  /** Optional override when host already loaded tf. */
  getTf?: () => typeof import('@tensorflow/tfjs');
}
