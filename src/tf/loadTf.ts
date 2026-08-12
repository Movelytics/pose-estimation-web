/**
 * Resolve TensorFlow.js: peer dependency (bundlers) or global `tf` (CDN script tags).
 */

export const ONLINE_TFJS_VERSION = '4.22.0';

const JSDELIVR = 'https://cdn.jsdelivr.net/npm';

export interface TfjsCdnUrls {
  scriptUrls: string[];
  wasmPath: string;
}

export function defaultTfjsCdnUrls(
  cdnBase: string = JSDELIVR,
  tfjsVersion: string = ONLINE_TFJS_VERSION,
): TfjsCdnUrls {
  const base = cdnBase.replace(/\/$/, '');
  return {
    scriptUrls: [
      `${base}/@tensorflow/tfjs-core@${tfjsVersion}/dist/tf-core.min.js`,
      `${base}/@tensorflow/tfjs-converter@${tfjsVersion}/dist/tf-converter.min.js`,
      `${base}/@tensorflow/tfjs-backend-webgl@${tfjsVersion}/dist/tf-backend-webgl.min.js`,
      `${base}/@tensorflow/tfjs-backend-wasm@${tfjsVersion}/dist/tf-backend-wasm.min.js`,
    ],
    wasmPath: `${base}/@tensorflow/tfjs-backend-wasm@${tfjsVersion}/dist/`,
  };
}

export type TfModule = typeof import('@tensorflow/tfjs');

declare global {
  interface Window {
    tf?: TfModule;
  }
}

let cached: TfModule | null = null;

function applyProductFlags(tf: TfModule): void {
  try {
    tf.env().set('WEBGL_CPU_FORWARD', false);
  } catch {
    /* ignore */
  }
  try {
    tf.env().set('WEBGL_PACK', false);
  } catch {
    /* ignore */
  }
  try {
    tf.env().set('WEBGL_FORCE_F16_TEXTURES', false);
  } catch {
    /* ignore */
  }
  try {
    tf.env().set('WEBGL_RENDER_FLOAT32_ENABLED', false);
  } catch {
    /* ignore */
  }
  try {
    tf.env().set('WEBGL_FLUSH_THRESHOLD', 1.75);
  } catch {
    /* ignore */
  }
}

/**
 * Dynamic import that bundlers (IIFE) must not statically analyze / inline.
 * Peer `@tensorflow/tfjs` stays external; CDN hosts use `window.tf`.
 */
function importTfPeer(): Promise<TfModule> {
  // Indirect import prevents IIFE builds from bundling the ~MB TF.js tree.
  const importer = new Function('s', 'return import(s)') as (s: string) => Promise<TfModule>;
  return importer('@tensorflow/tfjs');
}

/**
 * Load TF.js from `window.tf` (CDN) or npm peer import.
 */
export async function resolveTf(): Promise<TfModule> {
  if (cached) return cached;

  if (typeof window !== 'undefined' && window.tf) {
    cached = window.tf;
    return window.tf;
  }

  try {
    const mod = await importTfPeer();
    cached = mod;
    return mod;
  } catch {
    /* peer not resolved */
  }

  throw new Error(
    'TensorFlow.js not found. Install peer `@tensorflow/tfjs` or load CDN scripts ' +
      '(see README) so `window.tf` is available.',
  );
}

export async function initWebGlBackend(tf: TfModule): Promise<'webgl' | 'cpu'> {
  applyProductFlags(tf);
  try {
    const ok = await tf.setBackend('webgl');
    await tf.ready();
    if (ok !== false && tf.getBackend() === 'webgl') return 'webgl';
  } catch {
    /* fall through */
  }
  await tf.setBackend('cpu');
  await tf.ready();
  return 'cpu';
}

export function getCachedTf(): TfModule | null {
  return cached;
}
