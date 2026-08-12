/**
 * Usage tracking — `POST /api/sdk/track` (same contract as RN light).
 * Browser: platform = 'web'; anonymous queue → localStorage.
 */

import { DEFAULT_BASE_URL, SDK_VERSION } from './configure';
import {
  createLocalKeyValueStore,
  type KeyValueStore,
} from '../engine/EngineLoader';

const QUEUE_KEY = 'posetracker.track.queue';
const QUEUE_LIMIT = 100;

export class TrackError extends Error {
  constructor(
    readonly code: 'invalid_token' | 'quota_exceeded' | 'network' | 'internal',
    message: string,
  ) {
    super(message);
    this.name = 'TrackError';
  }
}

export interface TrackRequest {
  event?: string;
  apiToken?: string | null;
  params?: Record<string, unknown>;
}

export interface TrackResponse {
  tracked: boolean;
  anonymous?: boolean;
  monthly_usage_counter?: number;
  remainingCalls?: number;
  type?: string;
}

interface QueuedEvent {
  event: string;
  platform: string;
  sdkVersion: string;
  params: Record<string, unknown> | undefined;
  queuedAtMs: number;
}

export interface UsageTrackerOptions {
  baseUrl?: string;
  keyValueStore?: KeyValueStore | null;
  fetchFn?: typeof fetch;
}

export class UsageTracker {
  private readonly baseUrl: string;
  private readonly kv: KeyValueStore | null;
  private readonly fetchFn: typeof fetch;

  constructor(options: UsageTrackerOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.kv =
      options.keyValueStore !== undefined
        ? options.keyValueStore
        : createLocalKeyValueStore();
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async trackMetered(request: TrackRequest & { apiToken: string }): Promise<TrackResponse> {
    return this.post({
      event: request.event ?? 'camera_start',
      apiToken: request.apiToken,
      platform: 'web',
      sdkVersion: SDK_VERSION,
      params: request.params,
    });
  }

  async trackAnonymous(request: TrackRequest = {}): Promise<void> {
    const payload: QueuedEvent = {
      event: request.event ?? 'camera_start',
      platform: 'web',
      sdkVersion: SDK_VERSION,
      params: request.params,
      queuedAtMs: Date.now(),
    };
    try {
      await this.post({ ...payload });
      void this.flushQueue();
    } catch {
      await this.enqueue(payload);
    }
  }

  async flushQueue(): Promise<void> {
    const queue = await this.readQueue();
    if (queue.length === 0) return;
    const remaining: QueuedEvent[] = [];
    for (const item of queue) {
      try {
        await this.post({
          ...item,
          params: { ...(item.params ?? {}), queuedAtMs: item.queuedAtMs },
        });
      } catch {
        remaining.push(item);
      }
    }
    await this.writeQueue(remaining);
  }

  private async post(body: Record<string, unknown>): Promise<TrackResponse> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}/api/sdk/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new TrackError('network', `Usage tracking request failed: ${String(err)}`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new TrackError('invalid_token', 'Invalid, revoked or unauthorized API token.');
    }
    if (response.status === 429) {
      throw new TrackError('quota_exceeded', 'API call quota exceeded for the current plan.');
    }
    if (!response.ok) {
      throw new TrackError('internal', `Usage tracking failed with HTTP ${response.status}.`);
    }
    return (await response.json()) as TrackResponse;
  }

  private async readQueue(): Promise<QueuedEvent[]> {
    try {
      const raw = await this.kv?.getItem(QUEUE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as QueuedEvent[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async writeQueue(queue: QueuedEvent[]): Promise<void> {
    try {
      if (queue.length === 0) {
        await this.kv?.removeItem(QUEUE_KEY);
      } else {
        await this.kv?.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-QUEUE_LIMIT)));
      }
    } catch {
      /* best-effort */
    }
  }

  private async enqueue(item: QueuedEvent): Promise<void> {
    const queue = await this.readQueue();
    queue.push(item);
    await this.writeQueue(queue);
  }
}
