import { COCO_KEYPOINT_NAMES, type CocoKeypointName } from '../../types/pose';
import { initWebGlBackend, resolveTf } from '../../tf/loadTf';
import { resolvePoseDetection } from '../../tf/loadPoseDetection';
import type { CreateAdapterContext, DetectorFrameResult, PoseDetectorAdapter } from './types';

/**
 * BlazePose via optional `@tensorflow-models/pose-detection`.
 *
 * Resolution order (same idea as TF.js):
 * 1. `window.poseDetection` (CDN / IIFE)
 * 2. npm peer import (bundlers)
 * 3. Dynamic jsDelivr inject in the browser
 *
 * Maps MediaPipe landmarks to COCO-17 when possible; BlazePose’s extra face /
 * hand / foot joints are dropped so `keypoints` events stay MoveNet-shaped.
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
        enableSmoothing: true,
      },
    );
  }

  async estimate(
    video: HTMLVideoElement,
    options: {
      facingMode: 'user' | 'environment';
      displayWidth: number;
      displayHeight: number;
    },
  ): Promise<DetectorFrameResult | null> {
    if (!this.detector) throw new Error('BlazePose adapter not loaded');
    if (!(video.videoWidth > 0 && video.videoHeight > 0)) return null;

    const t0 = performance.now();
    const poses = await this.detector.estimatePoses(video, {
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
          drawW: video.videoWidth,
          drawH: video.videoHeight,
          vw: video.videoWidth,
          vh: video.videoHeight,
        },
      };
    }

    const vw = video.videoWidth || 1;
    const vh = video.videoHeight || 1;
    const dispW = options.displayWidth || 1;
    const dispH = options.displayHeight || 1;
    const byName = new Map<string, { x: number; y: number; score: number }>();
    for (const kp of pose.keypoints) {
      const name = String(kp.name || '').toLowerCase();
      const coco = BLAZE_TO_COCO[name];
      if (!coco) continue;
      byName.set(coco, {
        x: kp.x,
        y: kp.y,
        score: typeof kp.score === 'number' ? kp.score : 0,
      });
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

  dispose(): void {
    try {
      this.detector?.dispose?.();
    } catch {
      /* ignore */
    }
    this.detector = null;
  }
}
