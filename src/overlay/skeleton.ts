import type { SkeletonDefinition } from '../types/skeleton';
import { DEFAULT_SKELETON_DEFINITION } from '../types/skeleton';

/** @deprecated Prefer DEFAULT_SKELETON_DEFINITION */
export const DEFAULT_SKELETON = DEFAULT_SKELETON_DEFINITION;

const SKELETON_SCORE = 0.3;

export interface DrawKeypoint {
  name: string;
  dx: number;
  dy: number;
  score: number;
}

export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  kps: DrawKeypoint[],
  dispW: number,
  dispH: number,
  enabled = true,
  def?: SkeletonDefinition | null,
): void {
  if (ctx.canvas.width !== dispW) ctx.canvas.width = dispW;
  if (ctx.canvas.height !== dispH) ctx.canvas.height = dispH;
  ctx.clearRect(0, 0, dispW, dispH);
  if (!enabled) return;

  const sk = def ?? DEFAULT_SKELETON_DEFINITION;
  const byName: Record<string, DrawKeypoint> = {};
  for (const kp of kps) byName[kp.name] = kp;

  const lineStroke = sk.lines.lineStrokeColor;
  const lineWidth = Number(sk.lines.strokeWidth);
  for (const edge of sk.keypoint_lines) {
    const [aName, bName] = String(edge).split('||');
    const a = byName[aName!];
    const b = byName[bName!];
    if (!a || !b || a.score <= SKELETON_SCORE || b.score <= SKELETON_SCORE) continue;
    ctx.beginPath();
    ctx.moveTo(a.dx, a.dy);
    ctx.lineTo(b.dx, b.dy);
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = lineStroke;
    ctx.stroke();
  }

  const fill = sk.circles.circleFillColor;
  const stroke = sk.circles.circleStrokeColor;
  const circleStrokeW = Number(sk.circles.strokeWidth);
  const radius = Number(sk.circles.radius);
  const allowed = new Set<string>(sk.keypoints);
  for (const kp of kps) {
    if (!allowed.has(kp.name) || kp.score <= SKELETON_SCORE) continue;
    ctx.beginPath();
    ctx.arc(kp.dx, kp.dy, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = circleStrokeW;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}
