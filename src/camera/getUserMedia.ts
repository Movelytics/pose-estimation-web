export interface CameraOptions {
  facingMode?: 'user' | 'environment';
  idealWidth?: number;
  idealHeight?: number;
  idealFrameRate?: number;
}

export async function openCameraStream(options: CameraOptions = {}): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('getUserMedia is not available in this environment');
  }
  const facingMode = options.facingMode ?? 'user';
  const constraints: MediaStreamConstraints = {
    audio: false,
    video: {
      facingMode,
      width: options.idealWidth ? { ideal: options.idealWidth } : undefined,
      height: options.idealHeight ? { ideal: options.idealHeight } : undefined,
      frameRate: options.idealFrameRate ? { ideal: options.idealFrameRate } : undefined,
    },
  };
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch {
    // Retry facingMode-only (device-native) if constrained request fails
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode },
    });
  }
}

export function stopMediaStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* ignore */
    }
  }
}
