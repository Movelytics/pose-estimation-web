/** Ambient stub so optional peer `@tensorflow-models/pose-detection` typechecks. */
declare module '@tensorflow-models/pose-detection' {
  export const SupportedModels: { BlazePose: string };
  export function createDetector(
    model: string,
    config?: Record<string, unknown>,
  ): Promise<{
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
}
