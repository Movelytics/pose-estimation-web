/**
 * Host-selectable tracking features — same plan gating / messages as RN light
 * and PoseTracker WebView `TrackingAppV3`.
 *
 * Web delta: `model: 'blazepose'` is a first-class model option (separate from
 * the unsupported WebView `features.blazepose` query-param key).
 */

import type { MinGrade } from './events';

export interface PoseTrackerFeatures {
  angles?: boolean;
  recommendations?: boolean;
  progression?: boolean;
  keypoints?: boolean;
  minGrade?: MinGrade;
}

export interface ResolvedFeatures {
  angles: boolean;
  recommendations: boolean;
  progression: boolean;
  keypoints: boolean;
  minGrade: MinGrade | null;
}

export const DEFAULT_FEATURES: ResolvedFeatures = {
  angles: false,
  recommendations: false,
  progression: false,
  keypoints: false,
  minGrade: null,
};

const KNOWN_FEATURE_KEYS = new Set<string>([
  'angles',
  'recommendations',
  'progression',
  'keypoints',
  'minGrade',
]);

/**
 * WebView-only keys that are NOT feature flags on web either.
 * Note: selecting BlazePose via `options.model = 'blazepose'` is supported;
 * passing `{ blazepose: true }` inside `features` is rejected (WebView parity).
 */
const UNSUPPORTED_FEATURE_HINTS: Record<string, string> = {
  blazepose: 'BlazePose as a features flag (use options.model = "blazepose" instead)',
  poseEngine: 'pose engine selection (MediaPipe/PoseLandmarker)',
  mediapipeModel: 'MediaPipe model selection',
  poseBackend: 'pose backend selection',
  runInWorker: 'worker thread selection',
};

export const FREE_PLAN_FEATURES_MESSAGE =
  'You cannot use developer features. (visit: https://posetracker.gitbook.io/posetracker-api/tracking-endpoint)';

export const INVALID_TOKEN_MESSAGE =
  'Invalid params. Please refer to the documentation and set token=YOUR API_KEY et exercise=A correct exercise. (visit: https://posetracker.gitbook.io/posetracker-api/tracking-endpoint)';

export const COMBINED_REFERENCE_EXERCISE_MESSAGE =
  'You cannot combine reference & exercise. Please check the documentation.';

export function featureNotSupportedMessage(key: string): string {
  const hint = UNSUPPORTED_FEATURE_HINTS[key] ?? `'${key}'`;
  return (
    `The '${key}' option (${hint}) is not available as a features flag. ` +
    'Remove the option, or use options.model / modelUrl for model selection. ' +
    '(visit: https://posetracker.gitbook.io/posetracker-api/tracking-endpoint)'
  );
}

export function resolveFeatures(input: PoseTrackerFeatures | undefined): {
  features: ResolvedFeatures;
  unsupportedKeys: string[];
} {
  if (!input) {
    return { features: { ...DEFAULT_FEATURES }, unsupportedKeys: [] };
  }
  const unsupportedKeys = Object.keys(input).filter((k) => !KNOWN_FEATURE_KEYS.has(k));
  return {
    features: {
      angles: input.angles === true,
      recommendations: input.recommendations === true,
      progression: input.progression === true,
      keypoints: input.keypoints === true,
      minGrade: input.minGrade ?? null,
    },
    unsupportedKeys,
  };
}

export function freeBlockedFeatures(
  features: ResolvedFeatures,
  options: { withExercise: boolean },
): string[] {
  const blocked: string[] = [];
  if (features.angles) blocked.push('angles');
  if (features.recommendations) blocked.push('recommendations');
  if (features.progression) blocked.push('progression');
  if (features.keypoints && options.withExercise) blocked.push('keypoints');
  return blocked;
}

export function isPaidPlan(planType: string | null | undefined): boolean {
  return typeof planType === 'string' && planType.length > 0 && planType !== 'free';
}

export function shouldShowWatermark(planType: string | null | undefined): boolean {
  return !isPaidPlan(planType);
}
