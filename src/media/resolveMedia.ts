/**
 * Resolve File / Blob / URL / element inputs into playable DOM media.
 */

export function isVideoElement(v: unknown): v is HTMLVideoElement {
  return typeof HTMLVideoElement !== 'undefined' && v instanceof HTMLVideoElement;
}

export function isImageElement(v: unknown): v is HTMLImageElement {
  return typeof HTMLImageElement !== 'undefined' && v instanceof HTMLImageElement;
}

export function isImageBitmap(v: unknown): v is ImageBitmap {
  return typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap;
}

export function mediaSize(el: HTMLVideoElement | HTMLImageElement | ImageBitmap): {
  width: number;
  height: number;
} {
  if (isImageBitmap(el)) {
    return { width: el.width || 0, height: el.height || 0 };
  }
  if (isVideoElement(el)) {
    return { width: el.videoWidth || 0, height: el.videoHeight || 0 };
  }
  return {
    width: el.naturalWidth || el.width || 0,
    height: el.naturalHeight || el.height || 0,
  };
}

export async function resolveObjectUrl(
  src: string | File | Blob,
): Promise<{ url: string; revoke: () => void }> {
  if (typeof src === 'string') {
    return { url: src, revoke: () => undefined };
  }
  const url = URL.createObjectURL(src);
  return {
    url,
    revoke: () => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    },
  };
}

export function waitForVideoReady(video: HTMLVideoElement, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 2 && video.videoWidth > 0) {
      resolve();
      return;
    }
    const onReady = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new Error('Failed to load video source'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for video metadata'));
    }, timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('error', onError);
  });
}

export function waitForImageReady(img: HTMLImageElement, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (img.complete && img.naturalWidth > 0) {
      resolve();
      return;
    }
    const onReady = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new Error('Failed to load image source'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for image'));
    }, timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      img.removeEventListener('load', onReady);
      img.removeEventListener('error', onError);
    };
    img.addEventListener('load', onReady);
    img.addEventListener('error', onError);
  });
}

/** Draw ImageBitmap into a temporary HTMLImageElement via canvas data URL (overlay). */
export async function imageBitmapToObjectUrl(bitmap: ImageBitmap): Promise<{
  url: string;
  revoke: () => void;
}> {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.drawImage(bitmap, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
  return resolveObjectUrl(blob);
}
