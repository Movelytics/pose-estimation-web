import { COCO_KEYPOINT_NAMES, type CocoKeypointName } from '../../types/pose';
import { initWebGlBackend, resolveTf } from '../../tf/loadTf';
import { resolvePoseDetection } from '../../tf/loadPoseDetection';
import type {
  CreateAdapterContext,
  DetectorFrameResult,
  PoseDetectorAdapter,
  PoseEstimateInput,
} from './types';

function blazeInputSize(input: PoseEstimateInput): { vw: number; vh: number } {
  if (typeof HTMLVideoElement !== 'undefined' && input instanceof HTMLVideoElement) {
    return { vw: input.videoWidth || 0, vh: input.videoHeight || 0 };
  }
  if (typeof HTMLImageElement !== 'undefined' && input instanceof HTMLImageElement) {
    return { vw: input.naturalWidth || input.width || 0, vh: input.naturalHeight || input.height || 0 };
  }
  if (typeof HTMLCanvasElement !== 'undefined' && input instanceof HTMLCanvasElement) {
    return { vw: input.width || 0, vh: input.height || 0 };
  }
  return { vw: (input as ImageBitmap).width || 0, vh: (input as ImageBitmap).height || 0 };
}

/**
 * BlazePose via optional `@tensorflow-models/pose-detection`.
 *
 * Resolution order (same idea as TF.js):
 * 1. `window.poseDetection` (CDN / IIFE)
 * 2. npm peer import (bundlers)
 * 3. Dynamic jsDelivr inject in the browser
 *
 * Maps MediaPipe landmarks to COCO-17. Extra face landmarks
 * (`left_eye_inner` / `outer`, mouth) are appended for profile eye/nose fusion.
 *
 * Default modelType: `lite` (realtime-friendly). Override via resolved options
 * when wired through the client.
 */

const BLAZE_TO_COCO: Record<string, CocoKeypointName | undefined> = {
  nose: 'nose',
  left_eye: 'left_eye',
  right_eye: 'right_eye',
  left_ear: 'left_ear',
  right_ear: 'right_ear',
  left_shoulder: 'left_shoulder',
  right_shoulder: 'right_shoulder',
  left_elbow: 'left_elbow',
  right_elbow: 'right_elbow',
  left_wrist: 'left_wrist',
  right_wrist: 'right_wrist',
  left_hip: 'left_hip',
  right_hip: 'right_hip',
  left_knee: 'left_knee',
  right_knee: 'right_knee',
  left_ankle: 'left_ankle',
  right_ankle: 'right_ankle',
};

const FACE_EXTRA_NAMES = new Set([
  'left_eye_inner',
  'left_eye_outer',
  'right_eye_inner',
  'right_eye_outer',
  'mouth_left',
  'mouth_right',
]);

/** Cap detector input so GPU downscale cannot desync imageSize vs tensor. */
const BLAZE_MAX_SIDE = 1280;

function toSourcePixels(
  x: number,
  y: number,
  scratchW: number,
  scratchH: number,
  srcW: number,
  srcH: number,
  maxCoord: number,
): { x: number; y: number } {
  // TFJS BlazePose usually returns pixels of the tensor image. Some paths
  // leave landmarks in [0,1]; treat that as normalized to the scratch canvas.
  if (maxCoord <= 1.5 && scratchW > 2) {
    return { x: x * srcW, y: y * srcH };
  }
  const sx = scratchW / srcW;
  const sy = scratchH / srcH;
  return { x: sx > 0 ? x / sx : x, y: sy > 0 ? y / sy : y };
}

export type BlazePoseModelType = 'lite' | 'full' | 'heavy';

export class BlazePoseAdapter implements PoseDetectorAdapter {
  readonly modelId = 'blazepose';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private detector: any = null;
  private backend: string | null = null;
  private readonly modelType: BlazePoseModelType = 'lite';

  constructor(_ctx: CreateAdapterContext) {
    /* resolved.kind must be blazepose; default modelType lite */
  }

  getBackend(): string | null {
    return this.backend;
  }

  async load(): Promise<void> {
    const tf = await resolveTf();
    this.backend = await initWebGlBackend(tf);

    const poseDetection = await resolvePoseDetection();

    this.detector = await poseDetection.createDetector(
      poseDetection.SupportedModels.BlazePose,
      {
        runtime: 'tfjs',
        modelType: this.modelType,
        enableSmoothing: false,
      },
    );
  }

  async estimate(
    input: PoseEstimateInput,
    options: {
      facingMode: 'user' | 'environment';
      displayWidth: number;
      displayHeight: number;
      temporalSmooth?: boolean;
    },
  ): Promise<DetectorFrameResult | null> {
    if (!this.detector) throw new Error('BlazePose adapter not loaded');
    const size = blazeInputSize(input);
    if (!(size.vw > 0 && size.vh > 0)) return null;

    // Independent stills: drop cached ROI so a previous photo cannot warp this one.
    if (options.temporalSmooth === false) this.resetTemporal();

    // Feed a canvas at natural aspect so CSS-shrunk <img>/<video> mounts do not
    // starve the detector. Cap the long side so TF.js texture downscale cannot
    // desync getImageSize() vs the actual tensor.
    let estimateTarget: PoseEstimateInput = input;
    let scratch: HTMLCanvasElement | null = null;
    let scratchW = size.vw;
    let scratchH = size.vh;
    if (
      (typeof HTMLImageElement !== 'undefined' && input instanceof HTMLImageElement) ||
      (typeof HTMLVideoElement !== 'undefined' && input instanceof HTMLVideoElement) ||
      (typeof HTMLCanvasElement !== 'undefined' && input instanceof HTMLCanvasElement)
    ) {
      const fit = Math.min(1, BLAZE_MAX_SIDE / Math.max(size.vw, size.vh));
      scratchW = Math.max(1, Math.round(size.vw * fit));
      scratchH = Math.max(1, Math.round(size.vh * fit));
      scratch = document.createElement('canvas');
      scratch.width = scratchW;
      scratch.height = scratchH;
      const ctx = scratch.getContext('2d');
      if (ctx) {
        ctx.drawImage(input as CanvasImageSource, 0, 0, scratchW, scratchH);
        estimateTarget = scratch;
      }
    }

    const t0 = performance.now();
    const poses = await this.detector.estimatePoses(estimateTarget as HTMLVideoElement, {
      flipHorizontal: false,
      maxPoses: 1,
    });
    const inferenceMs = performance.now() - t0;
    const pose = poses[0];
    if (!pose?.keypoints?.length) {
      return {
        keypoints: COCO_KEYPOINT_NAMES.map((name) => ({ name, x: 0, y: 0, score: 0 })),
        score: 0,
        inferenceMs,
        videoKeypoints: COCO_KEYPOINT_NAMES.map((name) => ({
          name,
          xPx: 0,
          yPx: 0,
          score: 0,
        })),
        letterbox: {
          offsetX: 0,
          offsetY: 0,
          drawW: size.vw,
          drawH: size.vh,
          vw: size.vw,
          vh: size.vh,
        },
      };
    }

    const vw = size.vw || 1;
    const vh = size.vh || 1;
    const dispW = options.displayWidth || 1;
    const dispH = options.displayHeight || 1;
    let maxCoord = 0;
    for (const kp of pose.keypoints) {
      maxCoord = Math.max(maxCoord, Math.abs(kp.x || 0), Math.abs(kp.y || 0));
    }
    const byName = new Map<string, { x: number; y: number; score: number }>();
    const extrasRaw: Array<{ name: string; x: number; y: number; score: number }> = [];
    for (const kp of pose.keypoints) {
      const name = String(kp.name || '').toLowerCase();
      const score = typeof kp.score === 'number' ? kp.score : 0;
      const src = toSourcePixels(kp.x, kp.y, scratchW, scratchH, vw, vh, maxCoord);
      const coco = BLAZE_TO_COCO[name];
      if (coco) {
        byName.set(coco, { x: src.x, y: src.y, score });
      } else if (FACE_EXTRA_NAMES.has(name)) {
        extrasRaw.push({ name, x: src.x, y: src.y, score });
      }
    }

    const videoKeypoints = COCO_KEYPOINT_NAMES.map((name) => {
      const k = byName.get(name);
      return {
        name,
        xPx: k?.x ?? 0,
        yPx: k?.y ?? 0,
        score: k?.score ?? 0,
      };
    });

    // object-fit:cover mapping from video pixels
    const scale = Math.max(dispW / vw, dispH / vh);
    const ox = (dispW - vw * scale) / 2;
    const oy = (dispH - vh * scale) / 2;

    let scoreSum = 0;
    const keypoints = videoKeypoints.map((k) => {
      const dx = k.xPx * scale + ox;
      const dy = k.yPx * scale + oy;
      let nx = dispW > 0 ? dx / dispW : 0;
      const ny = dispH > 0 ? dy / dispH : 0;
      if (options.facingMode === 'user') nx = 1 - nx;
      scoreSum += k.score;
      return {
        name: k.name as CocoKeypointName,
        x: Math.min(1, Math.max(0, nx)),
        y: Math.min(1, Math.max(0, ny)),
        score: k.score,
      };
    });

    for (const extra of extrasRaw) {
      const dx = extra.x * scale + ox;
      const dy = extra.y * scale + oy;
      let nx = dispW > 0 ? dx / dispW : 0;
      const ny = dispH > 0 ? dy / dispH : 0;
      if (options.facingMode === 'user') nx = 1 - nx;
      keypoints.push({
        name: extra.name as CocoKeypointName,
        x: Math.min(1, Math.max(0, nx)),
        y: Math.min(1, Math.max(0, ny)),
        score: extra.score,
      });
    }

    return {
      keypoints,
      score: scoreSum / 17,
      inferenceMs,
      videoKeypoints,
      letterbox: {
        offsetX: 0,
        offsetY: 0,
        drawW: vw,
        drawH: vh,
        vw,
        vh,
      },
    };
  }

  /** Clear cached ROI / landmark filters (call when the still changes). */
  resetTemporal(): void {
    try {
      this.detector?.reset?.();
    } catch {
      /* ignore */
    }
  }

  dispose(): void {
    try {
      this.detector?.dispose?.();
    } catch {
      /* ignore */
    }
    this.detector = null;
  }
}
