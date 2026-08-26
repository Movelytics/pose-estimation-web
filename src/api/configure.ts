/**
 * Handshake client: `configure(apiToken)` → Strapi `SdkManifest`.
 * Same endpoint as RN light; `targetPlatform: 'web'`, `sdkName: posetracker-web`.
 */

import { SDK_NAME, SDK_VERSION } from '../version';
import type { ConfigureRequest, PoseModelProfile, SdkManifest } from '../types/manifest';
import type { EngineChannel } from '../engineChannel';

export { SDK_VERSION };
export { SDK_NAME };

export const DEFAULT_BASE_URL =
  'https://movelytics-strapi-c78a339b7070.herokuapp.com';

export interface ConfigureOptions {
  baseUrl?: string;
  poseModelProfile?: PoseModelProfile;
  locale?: string;
  localVersions?: ConfigureRequest['localVersions'];
  /**
   * Opt-in V4 heuristic engine. Default `'v3'` (production FSM).
   * Set `'v4'` at init — the handshake downloads `engine-v4.bundle.js`.
   */
  engine?: EngineChannel;
}

export class ConfigureError extends Error {
  constructor(
    readonly code: 'invalid_token' | 'quota_exceeded' | 'network' | 'internal',
    message: string,
  ) {
    super(message);
    this.name = 'ConfigureError';
  }
}

export async function configure(
  apiToken: string | null,
  options: ConfigureOptions = {},
): Promise<SdkManifest> {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const body = {
    ...(apiToken ? { apiToken } : {}),
    sdkName: SDK_NAME,
    sdkVersion: SDK_VERSION,
    targetPlatform: 'web' as const,
    poseModelProfile: options.poseModelProfile ?? 'AdaptiveChoice',
    locale: options.locale,
    localVersions: options.localVersions,
    engineChannel: options.engine === 'v4' ? 'v4' : 'v3',
  };

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/sdk/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ConfigureError('network', `Handshake request failed: ${String(err)}`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new ConfigureError('invalid_token', 'Invalid, revoked or unauthorized API token.');
  }
  if (response.status === 429) {
    throw new ConfigureError('quota_exceeded', 'API call quota exceeded for the current plan.');
  }
  if (!response.ok) {
    throw new ConfigureError('internal', `Handshake failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as SdkManifest;
}
