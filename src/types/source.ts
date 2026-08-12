/**
 * Input source for pose estimation (camera / uploaded video / still image).
 * Default remains camera for quickstart compatibility.
 */

export type PoseSourceType = 'camera' | 'video' | 'image';

export type CameraFacingMode = 'user' | 'environment';

export interface CameraPoseSource {
  type: 'camera';
  facingMode?: CameraFacingMode;
}

/**
 * Uploaded or remote video. `src` may be a URL string, File/Blob (object URL),
 * or an existing HTMLVideoElement (SDK uses it as the frame source).
 */
export interface VideoPoseSource {
  type: 'video';
  src: string | File | Blob | HTMLVideoElement;
  /** Autoplay when attached. Default true. */
  autoplay?: boolean;
  /** Loop the file. Default true for continuous inference demos. */
  loop?: boolean;
  muted?: boolean;
}

/**
 * Still image — single-shot estimate (re-run via `analyze()`).
 */
export interface ImagePoseSource {
  type: 'image';
  src: string | File | Blob | HTMLImageElement | ImageBitmap;
}

export type PoseSource = CameraPoseSource | VideoPoseSource | ImagePoseSource;

/** Narrow helper for prop-style APIs (`source` + `sourceUrl` / `sourceFile`). */
export interface PoseSourceProps {
  source?: PoseSourceType;
  sourceUrl?: string;
  sourceFile?: File | Blob;
  facingMode?: CameraFacingMode;
}

/** Frame types accepted by detector adapters. */
export type PoseEstimateInput =
  | HTMLVideoElement
  | HTMLImageElement
  | HTMLCanvasElement
  | ImageBitmap;

export function normalizePoseSource(
  source?: PoseSource | PoseSourceType | null,
  extras?: { sourceUrl?: string; sourceFile?: File | Blob; facingMode?: CameraFacingMode },
): PoseSource {
  if (source && typeof source === 'object' && 'type' in source) {
    return source;
  }
  const kind: PoseSourceType =
    source === 'video' || source === 'image' || source === 'camera' ? source : 'camera';
  if (kind === 'camera') {
    return { type: 'camera', facingMode: extras?.facingMode };
  }
  const src = extras?.sourceFile ?? extras?.sourceUrl;
  if (!src) {
    throw new Error(
      `PoseSource type "${kind}" requires sourceUrl or sourceFile (or pass a full PoseSource object)`,
    );
  }
  if (kind === 'video') {
    return { type: 'video', src };
  }
  return { type: 'image', src };
}
