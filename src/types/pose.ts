/**
 * Backend-agnostic pose types (COCO-17 MoveNet topology).
 * Same contract as the React Native light SDK.
 */

export type CocoKeypointName =
  | 'nose'
  | 'left_eye'
  | 'right_eye'
  | 'left_ear'
  | 'right_ear'
  | 'left_shoulder'
  | 'right_shoulder'
  | 'left_elbow'
  | 'right_elbow'
  | 'left_wrist'
  | 'right_wrist'
  | 'left_hip'
  | 'right_hip'
  | 'left_knee'
  | 'right_knee'
  | 'left_ankle'
  | 'right_ankle';

export type KeypointName = CocoKeypointName;

export const COCO_KEYPOINT_NAMES: readonly CocoKeypointName[] = [
  'nose',
  'left_eye',
  'right_eye',
  'left_ear',
  'right_ear',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
];

export interface Keypoint {
  name: KeypointName;
  /** Normalized [0, 1] relative to display width (mirrored for user-facing camera). */
  x: number;
  /** Normalized [0, 1] relative to display height. */
  y: number;
  z?: number;
  /** Confidence in [0, 1]. */
  score: number;
}

export interface Pose {
  keypoints: Keypoint[];
  score: number;
  timestampMs: number;
}
