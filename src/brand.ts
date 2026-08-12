/**
 * Brand assets for boot overlay / watermark.
 * Remote logo keeps the npm package small (light philosophy).
 */
export const DEFAULT_LOADING_TEXT = 'AI Loading';

/** Public PoseTracker logo (docs site). Falls back to text if offline. */
export const POSETRACKER_LOGO_URL = 'https://docs.posetracker.com/logo/light.png';

export const BRAND_COLORS = {
  navy: '#010A73',
  gold: '#FFC300',
  bootBg: '#0a0a0a',
  logoPad: '#3a3a3a',
} as const;
