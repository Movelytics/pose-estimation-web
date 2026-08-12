import { COCO_KEYPOINT_NAMES } from '../../types/pose';
import { initWebGlBackend, resolveTf, type TfModule } from '../../tf/loadTf';
import type {
  CreateAdapterContext,
  DetectorFrameResult,
  Letterbox,
  PoseDetectorAdapter,
} from './types';

const INPUT_SIZE = 192;
const SMOOTH_ALPHA = 0.5;

function modelNormToVideo(xNorm: number, yNorm: number, lb: Letterbox): { x: number; y: number } {
  const xSq = xNorm * INPUT_SIZE;
  const ySq = yNorm * INPUT_SIZE;
  return {
    x: (xSq - lb.offsetX) * (lb.vw / lb.drawW),
    y: (ySq - lb.offsetY) * (lb.vh / lb.drawH),
  };
}

function videoToCover(
  vx: number,
  vy: number,
  dispW: number,
  dispH: number,
  lb: Letterbox,
): { x: number; y: number } {
  const scale = Math.max(dispW / lb.vw, dispH / lb.vh);
  const ox = (dispW - lb.vw * scale) / 2;
  const oy = (dispH - lb.vh * scale) / 2;
  return { x: vx * scale + ox, y: vy * scale + oy };
}

export class MoveNetGraphAdapter implements PoseDetectorAdapter {
  readonly modelId: string;
  private readonly modelUrl: string;
  private tf: TfModule | null = null;
  private model: Awaited<ReturnType<TfModule['loadGraphModel']>> | null = null;
  private backend: string | null = null;
  private offscreen: HTMLCanvasElement | null = null;
  private offCtx: CanvasRenderingContext2D | null = null;
  private smoothed: Array<{ xPx: number; yPx: number; score: number }> | null = null;
  private letterbox: Letterbox = {
    offsetX: 0,
    offsetY: 0,
    drawW: INPUT_SIZE,
    drawH: INPUT_SIZE,
    vw: 1,
    vh: 1,
  };

  constructor(ctx: CreateAdapterContext) {
    if (!ctx.resolved.modelUrl) {
      throw new Error(ctx.resolved.unsupportedReason ?? 'MoveNet requires a modelUrl');
    }
    this.modelId = ctx.resolved.modelId;
    this.modelUrl = ctx.resolved.modelUrl;
  }

  getBackend(): string | null {
    return this.backend;
  }

  async load(): Promise<void> {
    this.tf = await resolveTf();
    this.backend = await initWebGlBackend(this.tf);
    this.model = await this.tf.loadGraphModel(this.modelUrl);
    // Warm-up zeros
    const z = this.tf.zeros([1, INPUT_SIZE, INPUT_SIZE, 3], 'int32');
    const out = this.model.execute(z);
    const tensor = Array.isArray(out) ? out[0] : out;
    tensor.dataSync();
    z.dispose();
    if (Array.isArray(out)) out.forEach((t) => t.dispose());
    else out.dispose();
  }

  private poseCanvasCtx(): CanvasRenderingContext2D {
    if (!this.offscreen) {
      this.offscreen = document.createElement('canvas');
      this.offscreen.width = INPUT_SIZE;
      this.offscreen.height = INPUT_SIZE;
      this.offCtx = this.offscreen.getContext('2d', { willReadFrequently: true });
    }
    if (!this.offCtx) throw new Error('2d context unavailable');
    return this.offCtx;
  }

  private prepareInput(video: HTMLVideoElement): HTMLCanvasElement {
    const vw = video.videoWidth || 1;
    const vh = video.videoHeight || 1;
    const scale = Math.min(INPUT_SIZE / vw, INPUT_SIZE / vh);
    const drawW = vw * scale;
    const drawH = vh * scale;
    const offsetX = (INPUT_SIZE - drawW) / 2;
    const offsetY = (INPUT_SIZE - drawH) / 2;
    this.letterbox = { offsetX, offsetY, drawW, drawH, vw, vh };

    const c2d = this.poseCanvasCtx();
    c2d.fillStyle = '#000';
    c2d.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
    c2d.drawImage(video, 0, 0, vw, vh, offsetX, offsetY, drawW, drawH);
    return this.offscreen!;
  }

  private smooth(
    raw: Array<{ xPx: number; yPx: number; score: number }>,
  ): Array<{ xPx: number; yPx: number; score: number }> {
    if (!this.smoothed) {
      this.smoothed = raw.map((k) => ({ ...k }));
      return this.smoothed;
    }
    for (let i = 0; i < raw.length; i++) {
      if (raw[i].score < 0.1) continue;
      this.smoothed[i].xPx = SMOOTH_ALPHA * raw[i].xPx + (1 - SMOOTH_ALPHA) * this.smoothed[i].xPx;
      this.smoothed[i].yPx = SMOOTH_ALPHA * raw[i].yPx + (1 - SMOOTH_ALPHA) * this.smoothed[i].yPx;
      this.smoothed[i].score = raw[i].score;
    }
    return this.smoothed;
  }

  async estimate(
    video: HTMLVideoElement,
    options: {
      facingMode: 'user' | 'environment';
      displayWidth: number;
      displayHeight: number;
    },
  ): Promise<DetectorFrameResult | null> {
    if (!this.tf || !this.model) throw new Error('MoveNet adapter not loaded');
    if (!(video.videoWidth > 0 && video.videoHeight > 0)) return null;

    const t0 = performance.now();
    const canvas = this.prepareInput(video);
    const input = this.tf.tidy(() => this.tf!.expandDims(this.tf!.browser.fromPixels(canvas), 0));
    const out = this.model.execute(input);
    const tensor = Array.isArray(out) ? out[0] : out;
    const data = tensor.dataSync() as Float32Array;
    input.dispose();
    if (Array.isArray(out)) out.forEach((t) => t.dispose());
    else out.dispose();
    const inferenceMs = performance.now() - t0;

    const lb = this.letterbox;
    const dispW = options.displayWidth || 1;
    const dispH = options.displayHeight || 1;
    const drawRaw: Array<{ name: string; xPx: number; yPx: number; score: number }> = [];
    let scoreSum = 0;

    for (let i = 0; i < 17; i++) {
      const yNorm = Math.min(1, Math.max(0, data[i * 3]));
      const xNorm = Math.min(1, Math.max(0, data[i * 3 + 1]));
      const score = data[i * 3 + 2];
      const vid = modelNormToVideo(xNorm, yNorm, lb);
      drawRaw.push({
        name: COCO_KEYPOINT_NAMES[i],
        xPx: vid.x,
        yPx: vid.y,
        score,
      });
      scoreSum += score;
    }

    const sm = this.smooth(drawRaw);
    const videoKeypoints = sm.map((k, i) => ({
      name: COCO_KEYPOINT_NAMES[i],
      xPx: k.xPx,
      yPx: k.yPx,
      score: k.score,
    }));

    const keypoints = videoKeypoints.map((k) => {
      const d = videoToCover(k.xPx, k.yPx, dispW, dispH, lb);
      let nx = dispW > 0 ? d.x / dispW : 0;
      const ny = dispH > 0 ? d.y / dispH : 0;
      if (options.facingMode === 'user') nx = 1 - nx;
      return {
        name: k.name as (typeof COCO_KEYPOINT_NAMES)[number],
        x: Math.min(1, Math.max(0, nx)),
        y: Math.min(1, Math.max(0, ny)),
        score: k.score,
      };
    });

    return {
      raw: data,
      keypoints,
      score: scoreSum / 17,
      inferenceMs,
      videoKeypoints,
      letterbox: lb,
    };
  }

  dispose(): void {
    try {
      this.model?.dispose();
    } catch {
      /* ignore */
    }
    this.model = null;
    this.smoothed = null;
    this.offscreen = null;
    this.offCtx = null;
  }
}

/** Map video keypoints → object-fit:cover display pixels for drawing. */
export function mapVideoKeypointsToDisplay(
  videoKeypoints: Array<{ name: string; xPx: number; yPx: number; score: number }>,
  letterbox: Letterbox,
  dispW: number,
  dispH: number,
): Array<{ name: string; dx: number; dy: number; score: number }> {
  return videoKeypoints.map((k) => {
    const d = videoToCover(k.xPx, k.yPx, dispW, dispH, letterbox);
    return { name: k.name, dx: d.x, dy: d.y, score: k.score };
  });
}
