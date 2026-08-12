/**
 * Resolve `@tensorflow-models/pose-detection` for BlazePose:
 * 1. Global `window.poseDetection` (CDN / IIFE)
 * 2. Optional npm peer (bundlers)
 * 3. Dynamic jsDelivr script inject in the browser when peer is missing
 */

export const ONLINE_POSE_DETECTION_VERSION = '2.1.3';

const JSDELIVR = 'https://cdn.jsdelivr.net/npm';

export type PoseDetectionModule = {
  SupportedModels: { BlazePose: string };
  createDetector: (
    model: string,
    config?: Record<string, unknown>,
  ) => Promise<{
    estimatePoses: (
      input: HTMLVideoElement,
      opts?: Record<string, unknown>,
    ) => Promise<
      Array<{
        keypoints: Array<{ name?: string; x: number; y: number; score?: number }>;
      }>
    >;
    dispose?: () => void;
  }>;
};

declare global {
  interface Window {
    poseDetection?: PoseDetectionModule;
  }
}

let cached: PoseDetectionModule | null = null;
let injectPromise: Promise<PoseDetectionModule> | null = null;

export function defaultPoseDetectionCdnUrl(
  cdnBase: string = JSDELIVR,
  version: string = ONLINE_POSE_DETECTION_VERSION,
): string {
  const base = cdnBase.replace(/\/$/, '');
  return `${base}/@tensorflow-models/pose-detection@${version}/dist/pose-detection.min.js`;
}

function importPoseDetectionPeer(): Promise<PoseDetectionModule> {
  const importer = new Function('s', 'return import(s)') as (
    s: string,
  ) => Promise<PoseDetectionModule>;
  return importer('@tensorflow-models/pose-detection');
}

function readGlobal(): PoseDetectionModule | null {
  if (typeof window === 'undefined') return null;
  const g = window.poseDetection;
  if (g && typeof g.createDetector === 'function' && g.SupportedModels?.BlazePose) {
    return g;
  }
  return null;
}

function injectCdnScript(url: string): Promise<PoseDetectionModule> {
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('Cannot inject pose-detection outside a browser document'));
  }
  const existing = readGlobal();
  if (existing) return Promise.resolve(existing);

  if (injectPromise) return injectPromise;

  injectPromise = new Promise<PoseDetectionModule>((resolve, reject) => {
    const selector = 'script[data-pt-pose-detection="1"]';
    const prior = document.querySelector(selector) as HTMLScriptElement | null;
    const finish = () => {
      const mod = readGlobal();
      if (mod) {
        resolve(mod);
        return;
      }
      reject(
        new Error(
          'pose-detection CDN script loaded but `window.poseDetection` is missing. ' +
            'Check script order (TF.js first) and network.',
        ),
      );
    };

    if (prior) {
      if (prior.dataset.ptLoaded === '1') {
        finish();
        return;
      }
      prior.addEventListener('load', finish, { once: true });
      prior.addEventListener(
        'error',
        () => reject(new Error(`Failed to load pose-detection from ${prior.src}`)),
        { once: true },
      );
      return;
    }

    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.dataset.ptPoseDetection = '1';
    script.onload = () => {
      script.dataset.ptLoaded = '1';
      finish();
    };
    script.onerror = () => {
      injectPromise = null;
      reject(new Error(`Failed to load pose-detection from ${url}`));
    };
    document.head.appendChild(script);
  });

  return injectPromise;
}

/**
 * Load pose-detection from `window.poseDetection`, npm peer, or CDN inject.
 */
export async function resolvePoseDetection(options?: {
  cdnBase?: string;
  version?: string;
  /** Skip CDN inject (tests / Node). Default false. */
  allowCdn?: boolean;
}): Promise<PoseDetectionModule> {
  if (cached) return cached;

  const fromWindow = readGlobal();
  if (fromWindow) {
    cached = fromWindow;
    return fromWindow;
  }

  try {
    const mod = await importPoseDetectionPeer();
    cached = mod;
    return mod;
  } catch {
    /* peer not resolved — try CDN in browser */
  }

  const allowCdn = options?.allowCdn !== false;
  if (allowCdn && typeof window !== 'undefined' && typeof document !== 'undefined') {
    const url = defaultPoseDetectionCdnUrl(options?.cdnBase, options?.version);
    const mod = await injectCdnScript(url);
    cached = mod;
    return mod;
  }

  throw new Error(
    'BlazePose requires optional peer `@tensorflow-models/pose-detection`. ' +
      'Install it, load the CDN script so `window.poseDetection` exists, ' +
      'or use model="movenet" / pass a TF.js modelUrl.',
  );
}

export function getCachedPoseDetection(): PoseDetectionModule | null {
  return cached;
}

/** Test helper — clears module cache between smoke tests. */
export function __resetPoseDetectionCacheForTests(): void {
  cached = null;
  injectPromise = null;
}
