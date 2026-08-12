import { BlazePoseAdapter } from './blazepose';
import { MoveNetGraphAdapter } from './movenet';
import type { CreateAdapterContext, PoseDetectorAdapter } from './types';

export function createPoseAdapter(ctx: CreateAdapterContext): PoseDetectorAdapter {
  const { resolved } = ctx;
  if (resolved.kind === 'unsupported' || (!resolved.modelUrl && resolved.kind !== 'blazepose')) {
    throw new Error(
      resolved.unsupportedReason ?? `Model "${resolved.modelId}" is unavailable.`,
    );
  }
  if (resolved.kind === 'blazepose') {
    return new BlazePoseAdapter(ctx);
  }
  return new MoveNetGraphAdapter(ctx);
}
