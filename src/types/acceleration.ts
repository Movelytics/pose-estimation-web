/**
 * Acceleration diagnostics — web stub (browser TF.js WebGL vs WASM).
 * Full AdaptiveChoice / Vision reports live in the RN light SDK.
 */

export type AccelerationState = 'unknown' | 'gpu' | 'cpu-fallback' | 'unavailable';

export type InferenceRuntime = 'tfjs-webgl' | 'tfjs-wasm' | 'tfjs-cpu' | 'unknown';

export interface AccelerationDiagnostics {
  state: AccelerationState;
  runtime: InferenceRuntime;
  backend: string | null;
  glRenderer: string | null;
  medianInferenceMs: number | null;
  detail?: string;
}

export type DiagnosticListener = (message: string) => void;
