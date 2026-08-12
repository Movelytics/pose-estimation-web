/**
 * @pose-tracker/pose-estimation-web — vanilla browser pose estimation SDK.
 *
 * Online / light: TF.js (peer or CDN) + remote model URL. No bundled weights.
 * Keypoints free without API key; exercise engine via configure(apiToken).
 */

export { SDK_NAME, SDK_VERSION } from './version';

export {
  createPoseTracker,
  PoseTrackerClient,
  PoseCamera,
  PoseCamera_mount,
} from './createPoseTracker';
export type {
  PoseTracker,
  PoseTrackerOptions,
  PoseTrackerClientOptions,
  StartExerciseOptions,
} from './createPoseTracker';

export {
  DEFAULT_MOVENET_LIGHTNING_URL,
  resolvePoseModel,
} from './models/poseModels';
export type {
  PoseModelAlias,
  PoseModelKind,
  ResolvePoseModelOptions,
  ResolvedPoseModel,
} from './models/poseModels';

export { createPoseAdapter } from './models/adapters/createAdapter';
export type { PoseDetectorAdapter, DetectorFrameResult } from './models/adapters/types';
export { MoveNetGraphAdapter, mapVideoKeypointsToDisplay } from './models/adapters/movenet';
export { BlazePoseAdapter } from './models/adapters/blazepose';

export {
  ONLINE_TFJS_VERSION,
  defaultTfjsCdnUrls,
  resolveTf,
  initWebGlBackend,
} from './tf/loadTf';
export type { TfjsCdnUrls, TfModule } from './tf/loadTf';

export {
  ONLINE_POSE_DETECTION_VERSION,
  defaultPoseDetectionCdnUrl,
  resolvePoseDetection,
} from './tf/loadPoseDetection';
export type { PoseDetectionModule } from './tf/loadPoseDetection';
export type { BlazePoseModelType } from './models/adapters/blazepose';

export { openCameraStream, stopMediaStream } from './camera/getUserMedia';
export type { CameraOptions } from './camera/getUserMedia';

export { normalizePoseSource } from './types/source';
export type {
  CameraFacingMode,
  CameraPoseSource,
  ImagePoseSource,
  PoseEstimateInput,
  PoseSource,
  PoseSourceProps,
  PoseSourceType,
  VideoPoseSource,
} from './types/source';

export { DEFAULT_LOADING_TEXT, POSETRACKER_LOGO_URL, BRAND_COLORS } from './brand';
export { DEFAULT_SKELETON, drawSkeleton } from './overlay/skeleton';
export { mountDomShell } from './overlay/domShell';

export {
  configure,
  ConfigureError,
  DEFAULT_BASE_URL,
} from './api/configure';
export type { ConfigureOptions } from './api/configure';

export { UsageTracker, TrackError } from './api/track';
export type { TrackRequest, TrackResponse, UsageTrackerOptions } from './api/track';

export { fetchSkeletonDefinition, SkeletonFetchError } from './api/skeleton';
export type { FetchSkeletonOptions } from './api/skeleton';
export { DEFAULT_SKELETON_DEFINITION } from './types/skeleton';
export type {
  SkeletonDefinition,
  SkeletonAnglesStyle,
  SkeletonCirclesStyle,
  SkeletonLinesStyle,
} from './types/skeleton';

export {
  EngineLoader,
  createWebFileStore,
  createLocalFileStore,
  createLocalKeyValueStore,
  createMemoryFileStore,
} from './engine/EngineLoader';
export type {
  EngineLoadResult,
  EngineLoaderOptions,
  FileStore,
  KeyValueStore,
} from './engine/EngineLoader';
export type {
  CustomExerciseDescriptor,
  CustomSessionOptions,
  EngineSession,
  EngineSessionFeatures,
  EngineSessionOptions,
  EventSink,
  PoseTrackerEngine,
} from './engine/types';

export {
  EXERCISE_ALIASES,
  findExerciseByIdOrAlias,
  resolveExerciseName,
} from './exercises/aliases';

export { toClassicNativeMessage } from './events/classicMessage';
export type { ClassicMessageListener, ClassicNativeMessage } from './events/classicMessage';

export {
  DEFAULT_FEATURES,
  FREE_PLAN_FEATURES_MESSAGE,
  INVALID_TOKEN_MESSAGE,
  COMBINED_REFERENCE_EXERCISE_MESSAGE,
  featureNotSupportedMessage,
  freeBlockedFeatures,
  isPaidPlan,
  shouldShowWatermark,
  resolveFeatures,
} from './types/features';
export type { PoseTrackerFeatures, ResolvedFeatures } from './types/features';

export { COCO_KEYPOINT_NAMES } from './types/pose';
export type { CocoKeypointName, Keypoint, KeypointName, Pose } from './types/pose';

export type { ColdStartMode, PreloadOptions } from './types/preload';
export type * from './types/events';
export type * from './types/manifest';
export type {
  AccelerationDiagnostics,
  AccelerationState,
  DiagnosticListener,
  InferenceRuntime,
} from './types/acceleration';
