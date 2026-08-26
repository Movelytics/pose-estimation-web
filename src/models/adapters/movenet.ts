import { COCO_KEYPOINT_NAMES } from '../../types/pose';
import { initWebGlBackend, resolveTf, type TfModule } from '../../tf/loadTf';
import type {
  CreateAdapterContext,
  DetectorFrameResult,
  Letterbox,
  PoseDetectorAdapter,
  PoseEstimateInput,
} from './types';

function inputSize(input: PoseEstimateInput): { vw: number; vh: number } {
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

const INPUT_SIZE = 192;
const SMOOTH_ALPHA = 0.45;
/** Person bbox as a fraction of the 192 window — typical webcam upper-body framing. */
const STILL_TARGET_FILL = 0.52;

function modelNormToVideo(xNorm: number, yNorm: number, lb: Letterbox): { x: number; y: number } {
  const xSq = xNorm * INPUT_SIZE;
  const ySq = yNorm * INPUT_SIZE;
  return {
    x: (xSq - lb.offsetX) * (lb.vw / lb.drawW) + (lb.originX ?? 0),
    y: (ySq - lb.offsetY) * (lb.vh / lb.drawH) + (lb.originY ?? 0),
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
  private lastVideoKps: Array<{ xPx: number; yPx: number; score: number }> | null = null;
  private stillPass = 0;
  private inferLb: Letterbox = {
    offsetX: 0,
    offsetY: 0,
    drawW: INPUT_SIZE,
    drawH: INPUT_SIZE,
    vw: 1,
    vh: 1,
    originX: 0,
    originY: 0,
  };
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

  private prepareInput(input: PoseEstimateInput, trackRoi: boolean): HTMLCanvasElement {
    const { vw: rawW, vh: rawH } = inputSize(input);
    const vw = rawW || 1;
    const vh = rawH || 1;

    let winX = 0;
    let winY = 0;
    let winW = vw;
    let winH = vh;

    if (trackRoi && this.lastVideoKps && this.stillPass > 0) {
      const pts = this.lastVideoKps.filter((k) => k.score >= 0.15);
      if (pts.length >= 4) {
        let minx = Infinity;
        let miny = Infinity;
        let maxx = -Infinity;
        let maxy = -Infinity;
        for (const p of pts) {
          minx = Math.min(minx, p.xPx);
          miny = Math.min(miny, p.yPx);
          maxx = Math.max(maxx, p.xPx);
          maxy = Math.max(maxy, p.yPx);
        }
        const bw = Math.max(8, maxx - minx);
        const bh = Math.max(8, maxy - miny);
        const cx = (minx + maxx) / 2;
        const cy = (miny + maxy) / 2;
        winW = Math.max(bw / STILL_TARGET_FILL, vw * 0.35);
        winH = Math.max(bh / STILL_TARGET_FILL, vh * 0.35);
        const imgAspect = vw / vh;
        if (winW / winH < imgAspect) winW = winH * imgAspect;
        else winH = winW / imgAspect;
        winX = cx - winW / 2;
        winY = cy - winH / 2;
      }
    }

    const scale = Math.min(INPUT_SIZE / winW, INPUT_SIZE / winH);
    const drawW = winW * scale;
    const drawH = winH * scale;
    const offsetX = (INPUT_SIZE - drawW) / 2;
    const offsetY = (INPUT_SIZE - drawH) / 2;
    this.inferLb = {
      offsetX,
      offsetY,
      drawW,
      drawH,
      vw: winW,
      vh: winH,
      originX: winX,
      originY: winY,
    };
    this.letterbox = { offsetX: 0, offsetY: 0, drawW: vw, drawH: vh, vw, vh };

    const c2d = this.poseCanvasCtx();
    c2d.fillStyle = '#000';
    c2d.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
    const srcX = Math.max(0, winX);
    const srcY = Math.max(0, winY);
    const srcR = Math.min(vw, winX + winW);
    const srcB = Math.min(vh, winY + winH);
    if (srcR > srcX && srcB > srcY) {
      const dx = offsetX + (srcX - winX) * (drawW / winW);
      const dy = offsetY + (srcY - winY) * (drawH / winH);
      const dw = (srcR - srcX) * (drawW / winW);
      const dh = (srcB - srcY) * (drawH / winH);
      c2d.drawImage(
        input as CanvasImageSource,
        srcX,
        srcY,
        srcR - srcX,
        srcB - srcY,
        dx,
        dy,
        dw,
        dh,
      );
    }
    this.stillPass += 1;
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
    input: PoseEstimateInput,
    options: {
      facingMode: 'user' | 'environment';
      displayWidth: number;
      displayHeight: number;
      temporalSmooth?: boolean;
    },
  ): Promise<DetectorFrameResult | null> {
    if (!this.tf || !this.model) throw new Error('MoveNet adapter not loaded');
    const size = inputSize(input);
    if (!(size.vw > 0 && size.vh > 0)) return null;

    const t0 = performance.now();
    const isStill =
      typeof HTMLImageElement !== 'undefined' && input instanceof HTMLImageElement;
    const trackRoi = options.temporalSmooth !== false && isStill;
    const canvas = this.prepareInput(input, trackRoi);
    const tensorIn = this.tf.tidy(() =>
      this.tf!.expandDims(this.tf!.browser.fromPixels(canvas), 0),
    );
    const out = this.model.execute(tensorIn);
    const tensor = Array.isArray(out) ? out[0] : out;
    const data = tensor.dataSync() as Float32Array;
    tensorIn.dispose();
    if (Array.isArray(out)) out.forEach((t) => t.dispose());
    else out.dispose();
    const inferenceMs = performance.now() - t0;

    const lb = this.inferLb;
    const coverLb = this.letterbox;
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

    const sm =
      options.temporalSmooth === false ? drawRaw : this.smooth(drawRaw);
    this.lastVideoKps = sm.map((k) => ({ xPx: k.xPx, yPx: k.yPx, score: k.score }));
    const videoKeypoints = sm.map((k, i) => ({
      name: COCO_KEYPOINT_NAMES[i],
      xPx: k.xPx,
      yPx: k.yPx,
      score: k.score,
    }));

    const keypoints = videoKeypoints.map((k) => {
      const d = videoToCover(k.xPx, k.yPx, dispW, dispH, coverLb);
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
      letterbox: coverLb,
    };
  }

  /** Clear EMA state (call when the still / clip changes). */
  resetTemporal(): void {
    this.smoothed = null;
    this.lastVideoKps = null;
    this.stillPass = 0;
  }

  dispose(): void {
    try {
      this.model?.dispose();
    } catch {
      /* ignore */
    }
    this.model = null;
    this.smoothed = null;
    this.lastVideoKps = null;
    this.stillPass = 0;
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
