/**
 * Online pose-model catalog (web) — mirrors RN light `poseModels.ts`.
 *
 * Default: MoveNet SinglePose Lightning at app.posetracker.com.
 * BlazePose: handled by the pose-detection adapter (no graph modelUrl).
 */

/** Production MoveNet SinglePose Lightning topology (Front / RN light default). */
export const DEFAULT_MOVENET_LIGHTNING_URL =
  'https://app.posetracker.com/scripts/tmp_model_to_remove.json';

export type PoseModelAlias =
  | 'movenet'
  | 'movenet-singlepose-lightning'
  | 'lightning'
  | 'blazepose'
  | (string & {});

export interface ResolvePoseModelOptions {
  model?: PoseModelAlias;
  /** Explicit TF.js graph-model topology URL (weights resolve as siblings). */
  modelUrl?: string;
}

export type PoseModelKind = 'movenet-graph' | 'blazepose' | 'custom-graph' | 'unsupported';

export interface ResolvedPoseModel {
  modelId: string;
  kind: PoseModelKind;
  /** TF.js `loadGraphModel` URL when kind is movenet-graph or custom-graph. */
  modelUrl: string | null;
  unsupportedReason?: string;
}

export function resolvePoseModel(options: ResolvePoseModelOptions = {}): ResolvedPoseModel {
  const explicit =
    typeof options.modelUrl === 'string' && options.modelUrl.trim().length > 0
      ? options.modelUrl.trim()
      : null;
  if (explicit) {
    const alias =
      typeof options.model === 'string' && options.model.trim().length > 0
        ? options.model.trim()
        : 'custom';
    return { modelId: alias, kind: 'custom-graph', modelUrl: explicit };
  }

  const key = (options.model ?? 'movenet').trim().toLowerCase();
  if (key === 'movenet' || key === 'movenet-singlepose-lightning' || key === 'lightning') {
    return {
      modelId: 'movenet-singlepose-lightning',
      kind: 'movenet-graph',
      modelUrl: DEFAULT_MOVENET_LIGHTNING_URL,
    };
  }
  if (key === 'blazepose') {
    return {
      modelId: 'blazepose',
      kind: 'blazepose',
      modelUrl: null,
    };
  }
  return {
    modelId: key,
    kind: 'unsupported',
    modelUrl: null,
    unsupportedReason:
      `Unknown model "${options.model}". Use "movenet" (default), "blazepose", or pass modelUrl.`,
  };
}
