/**
 * Remote engine distribution for the browser (same contract as RN light):
 * signed URL → SHA-256 → evaluate via `new Function` → sealed localStorage cache.
 */

import { sha256 } from 'js-sha256';

import type { EngineBundleDescriptor } from '../types/manifest';
import type { EngineModuleExports, PoseTrackerEngine } from './types';
import { openString, sealString } from '../cache/obfuscate';

export interface FileStore {
  read(key: string): Promise<string | null>;
  write(key: string, contents: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const LS_PREFIX = 'posetracker.web.';

/** localStorage-backed KV (guard + track queue). */
export function createLocalKeyValueStore(): KeyValueStore | null {
  if (typeof localStorage === 'undefined') return null;
  return {
    async getItem(key) {
      try {
        return localStorage.getItem(LS_PREFIX + key);
      } catch {
        return null;
      }
    },
    async setItem(key, value) {
      try {
        localStorage.setItem(LS_PREFIX + key, value);
      } catch {
        /* quota */
      }
    },
    async removeItem(key) {
      try {
        localStorage.removeItem(LS_PREFIX + key);
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * localStorage file store for sealed engine bundles.
 * Large engines may exceed ~5 MB quota — download still works; cache is best-effort.
 */
export function createLocalFileStore(): FileStore | null {
  const kv = createLocalKeyValueStore();
  if (!kv) return null;
  return {
    read: (key) => kv.getItem(`file.${key}`),
    write: (key, contents) => kv.setItem(`file.${key}`, contents),
    remove: (key) => kv.removeItem(`file.${key}`),
  };
}

export function createMemoryFileStore(): FileStore {
  const entries = new Map<string, string>();
  return {
    async read(key) {
      return entries.has(key) ? (entries.get(key) as string) : null;
    },
    async write(key, contents) {
      entries.set(key, contents);
    },
    async remove(key) {
      entries.delete(key);
    },
  };
}

/** Best available browser store: localStorage → memory. */
export function createWebFileStore(): FileStore {
  return createLocalFileStore() ?? createMemoryFileStore();
}

const GUARD_KEY_PREFIX = 'posetracker.engine.guard.';
type GuardState = 'probing' | 'passed' | 'failed';

export interface EngineLoadResult {
  engine: PoseTrackerEngine;
  source: 'remote-cache' | 'remote-download';
}

export interface EngineLoaderOptions {
  fileStore?: FileStore | null;
  keyValueStore?: KeyValueStore | null;
  fetchFn?: typeof fetch;
  onDiagnostic?: (message: string) => void;
}

export class EngineLoader {
  private readonly files: FileStore | null;
  private readonly kv: KeyValueStore | null;
  private readonly fetchFn: typeof fetch;
  private readonly onDiagnostic: ((message: string) => void) | undefined;
  lastError: string | null = null;

  constructor(options: EngineLoaderOptions = {}) {
    this.files =
      options.fileStore !== undefined ? options.fileStore : createWebFileStore();
    this.kv =
      options.keyValueStore !== undefined
        ? options.keyValueStore
        : createLocalKeyValueStore();
    this.fetchFn = options.fetchFn ?? fetch;
    this.onDiagnostic = options.onDiagnostic;
    this.onDiagnostic?.(
      `[posetracker-web] EngineLoader fileStore=${this.files ? 'yes' : 'none'} ` +
        `kv=${this.kv ? 'localStorage' : 'none'}`,
    );
  }

  async clearGuard(descriptor: EngineBundleDescriptor | null): Promise<void> {
    if (!descriptor || !this.kv) return;
    const guardKey = `${GUARD_KEY_PREFIX}${descriptor.version}.${descriptor.sha256}`;
    await this.kv.removeItem(guardKey).catch(() => {});
  }

  async load(
    descriptor: EngineBundleDescriptor | null,
    cacheSecret: string,
    options?: { forceRetry?: boolean },
  ): Promise<EngineLoadResult | null> {
    this.lastError = null;
    if (!descriptor) {
      this.lastError = 'manifest has no engine descriptor';
      return null;
    }

    const guardKey = `${GUARD_KEY_PREFIX}${descriptor.version}.${descriptor.sha256}`;
    if (options?.forceRetry) {
      await this.kv?.removeItem(guardKey).catch(() => {});
    }
    const guardState = (await this.kv?.getItem(guardKey)) as GuardState | null | undefined;
    if (guardState === 'probing' || guardState === 'failed') {
      await this.kv?.setItem(guardKey, 'failed');
      this.lastError =
        `engine crash-guard blocked version=${descriptor.version} ` +
        `(state=${guardState}) — call configure() again to force retry`;
      this.onDiagnostic?.(`[posetracker-web] ${this.lastError}`);
      return null;
    }

    const cacheKey = `engine-${descriptor.version}.sealed`;

    const sealed = await this.files?.read(cacheKey);
    if (sealed !== null && sealed !== undefined) {
      const code = openString(sealed, cacheSecret);
      if (code !== null && sha256(code) === descriptor.sha256) {
        const engine = await this.evaluate(code, guardKey);
        if (engine) {
          this.onDiagnostic?.(
            `[posetracker-web] engine loaded from cache version=${descriptor.version}`,
          );
          return { engine, source: 'remote-cache' };
        }
      } else {
        this.onDiagnostic?.(
          `[posetracker-web] engine cache purged (unseal/integrity mismatch) key=${cacheKey}`,
        );
        await this.files?.remove(cacheKey);
      }
    }

    try {
      this.onDiagnostic?.(
        `[posetracker-web] downloading engine version=${descriptor.version}…`,
      );
      const response = await this.fetchFn(descriptor.signedUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const code = await response.text();
      const digest = sha256(code);
      if (digest !== descriptor.sha256) {
        throw new Error(
          `integrity check failed (got ${digest.slice(0, 12)}… expected ${descriptor.sha256.slice(0, 12)}…, ` +
            `bytes=${code.length})`,
        );
      }
      const engine = await this.evaluate(code, guardKey);
      if (engine) {
        try {
          await this.files?.write(cacheKey, sealString(code, cacheSecret));
        } catch (err) {
          this.onDiagnostic?.(
            `[posetracker-web] engine cache write failed (non-fatal): ` +
              (err instanceof Error ? err.message : String(err)),
          );
        }
        this.onDiagnostic?.(
          `[posetracker-web] engine loaded from download version=${descriptor.version} bytes=${code.length}`,
        );
        return { engine, source: 'remote-download' };
      }
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.onDiagnostic?.(`[posetracker-web] engine download/load failed: ${this.lastError}`);
    }

    if (!this.lastError) {
      this.lastError = 'engine evaluate returned null';
    }
    return null;
  }

  private async evaluate(code: string, guardKey: string): Promise<PoseTrackerEngine | null> {
    await this.kv?.setItem(guardKey, 'probing');
    try {
      const moduleRef: { exports: Partial<EngineModuleExports> } = { exports: {} };
      // eslint-disable-next-line no-new-func
      const run = new Function('module', 'exports', code);
      run(moduleRef, moduleRef.exports);
      const factory = moduleRef.exports.createEngine;
      if (typeof factory !== 'function') {
        throw new Error(
          `engine bundle does not export createEngine() (got ${typeof factory}, keys=${Object.keys(moduleRef.exports).join(',')})`,
        );
      }
      const engine = factory();
      await this.kv?.setItem(guardKey, 'passed');
      return engine;
    } catch (err) {
      this.lastError =
        'engine evaluate failed: ' + (err instanceof Error ? err.message : String(err));
      this.onDiagnostic?.(`[posetracker-web] ${this.lastError}`);
      await this.kv?.setItem(guardKey, 'failed');
      return null;
    }
  }
}
