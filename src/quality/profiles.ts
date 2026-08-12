/**
 * Minimal quality profile types for event parity with RN light.
 * Full AdaptiveChoice ladder is RN/WebView-oriented; web uses getUserMedia
 * idealWidth/idealHeight from host options instead.
 */

export type QualityProfileId =
  | 'ultra'
  | 'high'
  | 'balanced'
  | 'performance'
  | 'low'
  | 'minimal';

export type CapturePriority = 'performance' | 'quality';

export type QualityChoice = QualityProfileId | 'AdaptiveChoice';

export interface QualityProfile {
  id: QualityProfileId;
  idealWidth: number;
  idealHeight: number;
  idealFrameRate: number;
}

export const QUALITY_PROFILES: Record<QualityProfileId, QualityProfile> = {
  ultra: { id: 'ultra', idealWidth: 1280, idealHeight: 720, idealFrameRate: 30 },
  high: { id: 'high', idealWidth: 960, idealHeight: 540, idealFrameRate: 30 },
  balanced: { id: 'balanced', idealWidth: 640, idealHeight: 480, idealFrameRate: 30 },
  performance: { id: 'performance', idealWidth: 480, idealHeight: 360, idealFrameRate: 24 },
  low: { id: 'low', idealWidth: 320, idealHeight: 240, idealFrameRate: 20 },
  minimal: { id: 'minimal', idealWidth: 240, idealHeight: 180, idealFrameRate: 15 },
};

export function isQualityProfileId(id: string): id is QualityProfileId {
  return id in QUALITY_PROFILES;
}

export function getQualityProfile(id: QualityProfileId): QualityProfile {
  return QUALITY_PROFILES[id];
}
