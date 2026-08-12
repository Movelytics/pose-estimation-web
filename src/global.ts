/**
 * IIFE / script-tag entry. Exposes `PoseTracker` global with createPoseTracker, etc.
 * Hosts must load TF.js via CDN script tags before this file (see README).
 */
export {
  createPoseTracker,
  PoseCamera,
  resolvePoseModel,
  DEFAULT_MOVENET_LIGHTNING_URL,
  defaultTfjsCdnUrls,
  ONLINE_TFJS_VERSION,
  SDK_VERSION,
  SDK_NAME,
  configure,
  shouldShowWatermark,
  COCO_KEYPOINT_NAMES,
} from './index';
