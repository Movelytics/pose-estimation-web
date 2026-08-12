/**
 * Browser PoseTracker client — DOM camera + TF.js keypoints + remote engine.
 * Public surface mirrors RN light `PoseTrackerClient` where the browser allows.
 */

import { configure as handshake, ConfigureError, type ConfigureOptions } from './api/configure';
import { TrackError, UsageTracker } from './api/track';
import { fetchSkeletonDefinition } from './api/skeleton';
import { deriveCacheSecret, openString, sealString } from './cache/obfuscate';
import { openCameraStream, stopMediaStream } from './camera/getUserMedia';
import {
  EngineLoader,
  createWebFileStore,
  type EngineLoadResult,
  type FileStore,
} from './engine/EngineLoader';
import type { CustomExerciseDescriptor, EngineSession, PoseTrackerEngine } from './engine/types';
import { findExerciseByIdOrAlias } from './exercises/aliases';
import {
  toClassicNativeMessage,
  type ClassicMessageListener,
  type ClassicNativeMessage,
} from './events/classicMessage';
import { createPoseAdapter } from './models/adapters/createAdapter';
import { mapVideoKeypointsToDisplay } from './models/adapters/movenet';
import type { PoseDetectorAdapter } from './models/adapters/types';
import {
  resolvePoseModel,
  type PoseModelAlias,
  type ResolvedPoseModel,
} from './models/poseModels';
import { DEFAULT_LOADING_TEXT } from './brand';
import { mountDomShell, type DomShell } from './overlay/domShell';
import { drawSkeleton as paintSkeleton } from './overlay/skeleton';
import {
  FREE_PLAN_FEATURES_MESSAGE,
  INVALID_TOKEN_MESSAGE,
  featureNotSupportedMessage,
  freeBlockedFeatures,
  resolveFeatures,
  shouldShowWatermark,
  type PoseTrackerFeatures,
  type ResolvedFeatures,
} from './types/features';
import type { ExerciseConfig, SdkManifest } from './types/manifest';
import type { ColdStartMode, PreloadOptions } from './types/preload';
import type { SkeletonDefinition } from './types/skeleton';
import type { AccelerationDiagnostics, AccelerationState } from './types/acceleration';
import type {
  ErrorEvent,
  PoseTrackerEvent,
  PoseTrackerEventListener,
  PoseTrackerMode,
  PoseTrackerStatus,
} from './types/events';
import type { Pose } from './types/pose';

const MANIFEST_CACHE_KEY = 'session.sealed';
const ENGINE_VERSION_KEY = 'engine.version';
const SESSION_ERROR_STREAK_LIMIT = 30;

export interface StartExerciseOptions {
  difficulty?: string;
  userHeightCm?: number;
  devicePitchDeg?: number;
}

export interface PoseTrackerClientOptions extends ConfigureOptions {
  model?: PoseModelAlias;
  modelUrl?: string;
  apiToken?: string;
  facingMode?: 'user' | 'environment';
  /** RN `position` alias: front → user, back → environment. */
  position?: 'front' | 'back';
  drawSkeleton?: boolean;
  drawPlacementBox?: boolean;
  placementPaddingPercent?: number;
  loadingText?: string;
  showWatermark?: boolean;
  debugHud?: boolean;
  features?: PoseTrackerFeatures;
  idealWidth?: number;
  idealHeight?: number;
  skeletonDef?: SkeletonDefinition | null;
  skeletonUuid?: string | null;
  engineLoader?: EngineLoader;
  fileStore?: FileStore | null;
  usageTracker?: UsageTracker;
  onDiagnostic?: (message: string) => void;
  /** Alias of preload coldStart when using start(). Default full on camera screens. */
  coldStart?: ColdStartMode;
}

/** @deprecated Prefer PoseTrackerClientOptions — kept for vanilla DX. */
export type PoseTrackerOptions = PoseTrackerClientOptions;

export type PoseTracker = PoseTrackerClient;

function resolveElement(target: string | HTMLElement): HTMLElement {
  if (typeof target === 'string') {
    const el = document.querySelector(target);
    if (!el) throw new Error(`PoseTracker mount target not found: ${target}`);
    return el as HTMLElement;
  }
  return target;
}

function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? null;
}

function facingFromOptions(opts: PoseTrackerClientOptions): 'user' | 'environment' {
  if (opts.facingMode) return opts.facingMode;
  if (opts.position === 'back') return 'environment';
  return 'user';
}

export class PoseTrackerClient {
  private status: PoseTrackerStatus = 'idle';
  private mode: PoseTrackerMode = 'keypoints-only';
  private lastError: ErrorEvent | null = null;
  private manifest: SdkManifest | null = null;
  private engine: PoseTrackerEngine | null = null;
  private engineSource: EngineLoadResult['source'] | null = null;
  private session: EngineSession | null = null;
  private currentExerciseId: string | null = null;
  private apiToken: string | null;

  private readonly engineLoader: EngineLoader;
  private readonly files: FileStore | null;
  private readonly tracker: UsageTracker;
  private readonly listeners = new Set<PoseTrackerEventListener>();
  private readonly typedListeners = new Map<string, Set<PoseTrackerEventListener>>();
  private readonly messageListeners = new Set<ClassicMessageListener>();
  private readonly stateListeners = new Set<() => void>();

  private preloadPromise: Promise<void> | null = null;
  private coldStartMode: ColdStartMode = 'basic';
  private configurePromise: Promise<boolean> | null = null;
  private handshakePromise: Promise<SdkManifest | null> | null = null;
  private meteredSessionState: 'idle' | 'pending' | 'validated' | 'refused' = 'idle';
  private lastCameraStartInfo: { backend: string; profileId: string | null } | null = null;
  private sessionErrorStreak = 0;

  private readonly features: ResolvedFeatures;
  private readonly unsupportedFeatureKeys: string[];
  private featureGateReported = { unsupported: false, freeBlock: false, missingToken: false };
  private keypointsSuppressionLogged = false;

  private opts: PoseTrackerClientOptions;
  private shell: DomShell | null = null;
  private stream: MediaStream | null = null;
  private adapter: PoseDetectorAdapter | null = null;
  private resolved: ResolvedPoseModel;
  private running = false;
  private busy = false;
  private loopToken = 0;
  private cameraRevealed = false;
  private disposed = false;
  private skeletonDef: SkeletonDefinition | null = null;
  private acceleration: AccelerationDiagnostics = {
    state: 'unknown',
    runtime: 'unknown',
    backend: null,
    glRenderer: null,
    medianInferenceMs: null,
  };
  private inferMs: number[] = [];
  private fpsWindow = 0;
  private fpsTimer = 0;

  constructor(apiToken?: string, options: PoseTrackerClientOptions = {}) {
    // Support createPoseTracker(options) where token is inside options.
    const token =
      apiToken ??
      (typeof options.apiToken === 'string' ? options.apiToken : null) ??
      null;
    this.opts = { ...options, onDiagnostic: options.onDiagnostic };
    this.apiToken = token;
    const resolved = resolveFeatures(options.features);
    this.features = resolved.features;
    this.unsupportedFeatureKeys = resolved.unsupportedKeys;
    this.resolved = resolvePoseModel({ model: options.model, modelUrl: options.modelUrl });
    this.skeletonDef = options.skeletonDef ?? null;
    this.coldStartMode = options.coldStart === 'full' ? 'full' : 'basic';
    this.files =
      options.fileStore !== undefined ? options.fileStore : createWebFileStore();
    this.engineLoader =
      options.engineLoader ??
      new EngineLoader({
        fileStore: this.files,
        onDiagnostic: this.opts.onDiagnostic,
      });
    this.tracker = options.usageTracker ?? new UsageTracker({ baseUrl: options.baseUrl });
    this.opts.onDiagnostic?.(
      `[posetracker-web] client created hasApiToken=${Boolean(this.apiToken)} ` +
        `features=${JSON.stringify(this.features)}`,
    );
  }

  // -------------------------------------------------------------------------
  // Introspection
  // -------------------------------------------------------------------------

  getStatus(): PoseTrackerStatus {
    return this.status;
  }

  getMode(): PoseTrackerMode {
    return this.mode;
  }

  getError(): ErrorEvent | null {
    return this.lastError;
  }

  getManifest(): SdkManifest | null {
    return this.manifest;
  }

  getPlanType(): string | null {
    return this.manifest?.plan?.plan ?? null;
  }

  getFeatures(): ResolvedFeatures {
    return { ...this.features };
  }

  getEngineSource(): EngineLoadResult['source'] | null {
    return this.engineSource;
  }

  getAcceleration(): AccelerationState {
    return this.acceleration.state;
  }

  getAccelerationDiagnostics(): AccelerationDiagnostics {
    return { ...this.acceleration };
  }

  getResolvedModel(): ResolvedPoseModel {
    return this.resolved;
  }

  getColdStartMode(): ColdStartMode {
    return this.coldStartMode;
  }

  addEventListener(listener: PoseTrackerEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  on(type: PoseTrackerEvent['type'] | '*', listener: PoseTrackerEventListener): () => void {
    if (type === '*') {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    let set = this.typedListeners.get(type);
    if (!set) {
      set = new Set();
      this.typedListeners.set(type, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  }

  addMessageListener(listener: ClassicMessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStateChange(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  // -------------------------------------------------------------------------
  // DOM mount / camera / inference
  // -------------------------------------------------------------------------

  mount(target: string | HTMLElement): void {
    if (this.disposed) throw new Error('PoseTracker disposed');
    if (this.shell) this.shell.destroy();
    const host = resolveElement(target);
    host.innerHTML = '';
    this.shell = mountDomShell(host, {
      loadingText: this.opts.loadingText ?? DEFAULT_LOADING_TEXT,
    });
    this.shell.setCameraVisible(false);
    this.cameraRevealed = false;
    void this.resolveSkeletonFromOptions();
  }

  /**
   * Warm model (and optionally camera). Default coldStart = basic (no gUM).
   * Alias: {@link warmup}.
   */
  preload(options?: PreloadOptions): Promise<void> {
    const mode: ColdStartMode = options?.coldStart === 'full' ? 'full' : 'basic';
    this.coldStartMode = mode;

    if (this.status === 'ready' && this.preloadPromise) {
      return this.preloadPromise.then(() => this.ensureColdStartMode(mode));
    }

    if (!this.preloadPromise) {
      this.preloadPromise = this.doPreload()
        .then(() => this.ensureColdStartMode(mode))
        .catch((err) => {
          this.preloadPromise = null;
          throw err;
        });
    } else if (mode === 'full') {
      return this.preloadPromise.then(() => this.ensureColdStartMode('full'));
    }
    return this.preloadPromise;
  }

  warmup(options?: PreloadOptions): Promise<void> {
    return this.preload(options);
  }

  /** Mount + load model + open camera + start loop (camera-screen convenience). */
  async start(): Promise<void> {
    if (this.disposed) throw new Error('PoseTracker disposed');
    if (!this.shell) throw new Error('Call mount() before start()');
    await this.preload({ coldStart: this.opts.coldStart === 'basic' ? 'basic' : 'full' });
    if (this.coldStartMode === 'basic') {
      await this.ensureColdStartMode('full');
    }
    this.beginLoop();
  }

  stop(): void {
    this.running = false;
    this.loopToken += 1;
    this.busy = false;
    stopMediaStream(this.stream);
    this.stream = null;
    if (this.shell) {
      this.shell.video.srcObject = null;
      this.shell.setCameraVisible(false);
      this.shell.setPlacementVisible(false);
      this.cameraRevealed = false;
      this.applyWatermark();
    }
    if (this.status !== 'error') this.setStatus('idle');
  }

  async dispose(): Promise<void> {
    this.stopExercise();
    this.stop();
    this.adapter?.dispose();
    this.adapter = null;
    this.shell?.destroy();
    this.shell = null;
    this.listeners.clear();
    this.typedListeners.clear();
    this.messageListeners.clear();
    this.stateListeners.clear();
    this.preloadPromise = null;
    this.configurePromise = null;
    this.handshakePromise = null;
    this.meteredSessionState = 'idle';
    this.lastCameraStartInfo = null;
    this.featureGateReported = { unsupported: false, freeBlock: false, missingToken: false };
    this.keypointsSuppressionLogged = false;
    this.engine = null;
    this.engineSource = null;
    this.manifest = null;
    this.mode = 'keypoints-only';
    this.setStatus('idle');
    this.disposed = true;
  }

  // -------------------------------------------------------------------------
  // Configure / engine
  // -------------------------------------------------------------------------

  configure(apiToken?: string): Promise<boolean> {
    if (apiToken !== undefined && apiToken !== this.apiToken) {
      this.apiToken = apiToken;
      this.opts.apiToken = apiToken;
      this.configurePromise = null;
      this.handshakePromise = null;
      this.featureGateReported.freeBlock = false;
      this.featureGateReported.missingToken = false;
    }
    if (this.mode !== 'full-engine') {
      this.configurePromise = null;
    }
    if (!this.configurePromise) {
      this.configurePromise = this.tryConfigure({
        silentStatus: this.status === 'ready',
        forceEngineRetry: true,
      })
        .then((ok) => {
          if (!ok) this.configurePromise = null;
          this.retryMeteredSessionIfRefused();
          return ok;
        })
        .catch(() => {
          this.configurePromise = null;
          return false;
        });
    }
    return this.configurePromise;
  }

  getAvailableExercises(): ExerciseConfig[] {
    return this.mode === 'full-engine' ? this.manifest?.exercises ?? [] : [];
  }

  getAvailableCustomExercises(): CustomExerciseDescriptor[] {
    if (this.mode !== 'full-engine' || !this.engine?.listCustomExercises) return [];
    return this.engine.listCustomExercises();
  }

  startExercise(exerciseId: string, options: StartExerciseOptions = {}): void {
    if (this.status !== 'ready') {
      throw new Error(`Cannot start exercise while status is '${this.status}' — call preload()/start() first.`);
    }
    if (this.mode !== 'full-engine' || !this.engine) {
      throw new Error(
        "Exercises require full-engine mode (validated API key). The SDK is running keypoints-only — call configure(apiToken) first.",
      );
    }
    if (this.meteredSessionState === 'refused') {
      throw new Error(
        'API-key features are not available offline: PoseTracker could not track this session. Reconnect and retry.',
      );
    }
    if (this.unsupportedFeatureKeys.length > 0) {
      const message = featureNotSupportedMessage(this.unsupportedFeatureKeys[0]!);
      this.reportError({ type: 'error', code: 'feature_not_supported', message });
      throw new Error(message);
    }
    if (this.getPlanType() === 'free') {
      const blocked = freeBlockedFeatures(this.features, { withExercise: true });
      if (blocked.length > 0) {
        this.reportError({
          type: 'error',
          code: 'free_plan_feature_blocked',
          message: FREE_PLAN_FEATURES_MESSAGE,
        });
        throw new Error(FREE_PLAN_FEATURES_MESSAGE);
      }
    }
    const available = this.getAvailableExercises();
    const exercise = findExerciseByIdOrAlias(exerciseId, available);
    if (!exercise) {
      const customs = this.getAvailableCustomExercises();
      const custom =
        customs.find((e) => e.id === exerciseId) ??
        findExerciseByIdOrAlias(exerciseId, customs);
      if (custom) {
        this.startCustomExercise(custom, options);
        return;
      }
      const message = `Exercise '${exerciseId}' is not available in V3 engine`;
      this.reportError({ type: 'error', code: 'invalid_exercise', message });
      throw new Error(message);
    }
    this.stopExercise();
    this.currentExerciseId = exerciseId;
    this.keypointsSuppressionLogged = false;
    this.session = this.engine.createSession(
      {
        exercise,
        locale: this.opts.locale ?? 'en',
        difficulty: options.difficulty,
        minGrade: this.features.minGrade ?? undefined,
        features: {
          angles: this.features.angles,
          recommendations: this.features.recommendations,
          progression: this.features.progression,
        },
      },
      (event) => this.emitFromSession(event),
    );
  }

  private startCustomExercise(custom: CustomExerciseDescriptor, options: StartExerciseOptions): void {
    if (!this.engine?.createCustomSession) {
      throw new Error(
        `The cached engine bundle is too old for custom exercise '${custom.id}' — reconnect so the SDK can update it.`,
      );
    }
    if (custom.id === 'jump_analysis' && (!options.userHeightCm || options.userHeightCm <= 0)) {
      const message = 'User height (userHeightCm) must be provided for jump_analysis exercise';
      this.reportError({ type: 'error', code: 'jump_analysis_missing_height', message });
      throw new Error(message);
    }
    this.stopExercise();
    this.currentExerciseId = custom.id;
    this.keypointsSuppressionLogged = false;
    this.session = this.engine.createCustomSession(
      {
        exerciseId: custom.id,
        locale: this.opts.locale ?? 'en',
        userHeightCm: options.userHeightCm,
        devicePitchDeg: options.devicePitchDeg,
      },
      (event) => this.emitFromSession(event),
    );
  }

  stopExercise(): void {
    try {
      this.session?.end();
    } catch (err) {
      this.opts.onDiagnostic?.(
        '[posetracker-web] engine session end() threw: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }
    this.session = null;
    this.currentExerciseId = null;
    this.sessionErrorStreak = 0;
    this.shell?.setPlacementVisible(false);
  }

  getCurrentExerciseId(): string | null {
    return this.currentExerciseId;
  }

  fetchSkeleton(uuid: string): Promise<SkeletonDefinition> {
    return fetchSkeletonDefinition(uuid, { baseUrl: this.opts.baseUrl });
  }

  async setModel(model?: PoseModelAlias, modelUrl?: string): Promise<void> {
    const wasRunning = this.running;
    if (wasRunning) {
      this.running = false;
      this.loopToken += 1;
      this.busy = false;
    }
    this.adapter?.dispose();
    this.adapter = null;
    if (model !== undefined) this.opts.model = model;
    if (modelUrl !== undefined) this.opts.modelUrl = modelUrl;
    this.resolved = resolvePoseModel({ model: this.opts.model, modelUrl: this.opts.modelUrl });
    await this.ensureAdapter();
    if (wasRunning) this.beginLoop();
  }

  updateOptions(partial: Partial<PoseTrackerClientOptions>): void {
    this.opts = { ...this.opts, ...partial };
    if (partial.skeletonDef !== undefined) this.skeletonDef = partial.skeletonDef;
    if (partial.skeletonUuid) void this.resolveSkeletonFromOptions();
    this.applyWatermark();
    if (this.shell && (partial.facingMode || partial.position)) {
      this.shell.applyMirror(facingFromOptions(this.opts));
    }
  }

  ingestPose(pose: Pose): void {
    if (!this.session || this.features.keypoints) {
      this.emit({
        type: 'keypoints',
        keypoints: pose.keypoints,
        score: pose.score,
        timestampMs: pose.timestampMs,
      });
    } else if (!this.keypointsSuppressionLogged) {
      this.keypointsSuppressionLogged = true;
      this.opts.onDiagnostic?.(
        '[posetracker-web] keypoints events paused during exercise (features.keypoints=false)',
      );
    }
    if (this.session) {
      try {
        this.session.processPose(pose);
        this.sessionErrorStreak = 0;
      } catch (err) {
        this.sessionErrorStreak += 1;
        const message = err instanceof Error ? err.message : String(err);
        if (this.sessionErrorStreak === 1) {
          this.opts.onDiagnostic?.(`[posetracker-web] processPose threw: ${message}`);
        }
        if (this.sessionErrorStreak >= SESSION_ERROR_STREAK_LIMIT) {
          const exerciseId = this.currentExerciseId;
          this.session = null;
          this.currentExerciseId = null;
          this.sessionErrorStreak = 0;
          this.reportError({
            type: 'error',
            code: 'internal',
            message:
              `Exercise session '${exerciseId ?? '?'}' failed repeatedly (${message}) — session stopped.`,
          });
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async doPreload(): Promise<void> {
    this.setStatus('configuring');
    await this.resolveManifestOnce();

    this.setStatus('downloading');
    await this.tryConfigure({ silentStatus: true });
    void this.tracker.flushQueue();

    try {
      this.setStatus('warming');
      await this.ensureAdapter();
      // Warm with a dummy path: adapter.load already ran; mark GPU if WebGL.
      this.acceleration = {
        ...this.acceleration,
        state: 'gpu',
        runtime: 'tfjs-webgl',
        backend: 'webgl',
      };
    } catch (err) {
      this.reportError({
        type: 'error',
        code: 'model_load_failed',
        message: err instanceof Error ? err.message : String(err),
      });
      this.setStatus('error');
      throw err;
    }

    this.setStatus('ready');
    this.emit({
      type: 'initialization',
      step: 'ready',
      message: 'running',
      ready: true,
      mode: this.mode,
      acceleration: this.getAcceleration(),
    });
  }

  private async ensureColdStartMode(mode: ColdStartMode): Promise<void> {
    if (mode !== 'full') return;
    if (!this.shell) return;
    await this.ensureCamera();
  }

  private async ensureAdapter(): Promise<void> {
    if (this.adapter) return;
    this.resolved = resolvePoseModel({ model: this.opts.model, modelUrl: this.opts.modelUrl });
    if (this.resolved.kind === 'unsupported') {
      throw new Error(this.resolved.unsupportedReason ?? 'Unsupported model');
    }
    this.emit({
      type: 'initialization',
      step: 'loading_pose_model',
      message: 'loading pose model',
      ready: false,
    });
    this.adapter = createPoseAdapter({ resolved: this.resolved });
    await this.adapter.load();
  }

  private async ensureCamera(): Promise<void> {
    if (!this.shell) throw new Error('Call mount() before opening the camera');
    if (this.stream) return;
    this.emit({
      type: 'initialization',
      step: 'accessing_webcam',
      message: 'accessing webcam',
      ready: false,
    });
    try {
      this.stream = await openCameraStream({
        facingMode: facingFromOptions(this.opts),
        idealWidth: this.opts.idealWidth,
        idealHeight: this.opts.idealHeight,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const denied = /NotAllowed|Permission|denied/i.test(msg);
      this.reportError({
        type: 'error',
        code: denied ? 'camera_denied' : 'camera_unavailable',
        message: msg,
      });
      this.shell.setBootMessage(
        denied
          ? 'Camera permission denied — allow access in the browser'
          : 'Camera unavailable',
        true,
      );
      throw err;
    }
    this.shell.video.srcObject = this.stream;
    this.shell.applyMirror(facingFromOptions(this.opts));
    try {
      await this.shell.video.play();
    } catch {
      /* autoplay */
    }
    const started = Date.now();
    const tick = (): void => {
      this.revealCamera();
      if (this.cameraRevealed) return;
      if (Date.now() - started > 8000) {
        this.shell?.setBootMessage(
          'camera started but preview is empty — check permissions',
          true,
        );
        return;
      }
      setTimeout(tick, 120);
    };
    setTimeout(tick, 60);

    void this.handleCameraStart({
      backend: this.acceleration.backend ?? 'webgl',
      profileId: null,
    });
  }

  private beginLoop(): void {
    this.running = true;
    this.fpsTimer = performance.now();
    void this.loop(++this.loopToken);
  }

  private async loop(token: number): Promise<void> {
    if (token !== this.loopToken || !this.running || !this.adapter || !this.shell || this.disposed) {
      return;
    }
    const video = this.shell.video;
    if (!this.busy && video.readyState >= 2 && video.videoWidth > 0) {
      this.busy = true;
      try {
        const dispW = this.shell.canvas.clientWidth || this.shell.root.clientWidth || 1;
        const dispH = this.shell.canvas.clientHeight || this.shell.root.clientHeight || 1;
        const result = await this.adapter.estimate(video, {
          facingMode: facingFromOptions(this.opts),
          displayWidth: dispW,
          displayHeight: dispH,
        });
        if (result) {
          const ctx = this.shell.canvas.getContext('2d');
          if (ctx && this.opts.drawSkeleton !== false) {
            const mapped = mapVideoKeypointsToDisplay(
              result.videoKeypoints,
              result.letterbox,
              dispW,
              dispH,
            );
            paintSkeleton(ctx, mapped, dispW, dispH, true, this.skeletonDef);
          } else if (ctx && this.opts.drawSkeleton === false) {
            ctx.clearRect(0, 0, dispW, dispH);
          }
          const pose: Pose = {
            keypoints: result.keypoints,
            score: result.score,
            timestampMs: Date.now(),
          };
          this.ingestPose(pose);
          this.inferMs.push(result.inferenceMs);
          if (this.inferMs.length > 30) this.inferMs.shift();
          this.fpsWindow += 1;
          const now = performance.now();
          if (now - this.fpsTimer >= 1000) {
            const fps = this.fpsWindow;
            this.fpsWindow = 0;
            this.fpsTimer = now;
            const med = median(this.inferMs);
            this.acceleration.medianInferenceMs = med;
            const above = result.keypoints.filter((k) => k.score >= 0.3).length;
            const backend =
              'getBackend' in this.adapter &&
              typeof (this.adapter as { getBackend?: () => string | null }).getBackend ===
                'function'
                ? (this.adapter as { getBackend: () => string | null }).getBackend()
                : null;
            this.acceleration.backend = backend;
            if (this.opts.debugHud) {
              this.shell.setHud(
                `${this.resolved.modelId} · ${backend ?? '?'} · ${fps} fps · ${
                  med != null ? Math.round(med) + ' ms' : '?'
                } · kp≥0.3=${above}/17`,
                true,
              );
            }
            this.emit({
              type: 'stats',
              fps,
              medianInferenceMs: med,
              backend,
              keypointsAbove03: above,
              meanScore: result.score,
              videoSize: `${video.videoWidth}x${video.videoHeight}`,
              timestampMs: Date.now(),
            });
          }
        }
        this.revealCamera();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.emit({ type: 'error', code: 'internal', message: `inference: ${message}` });
      }
      this.busy = false;
    }
    requestAnimationFrame(() => {
      void this.loop(token);
    });
  }

  private async resolveSkeletonFromOptions(): Promise<void> {
    if (this.opts.skeletonDef) {
      this.skeletonDef = this.opts.skeletonDef;
      return;
    }
    const uuid = this.opts.skeletonUuid?.trim();
    if (!uuid || uuid === 'true' || uuid === 'false') {
      this.skeletonDef = null;
      return;
    }
    try {
      this.skeletonDef = await this.fetchSkeleton(uuid);
    } catch {
      this.skeletonDef = null;
    }
  }

  private resolveManifestOnce(): Promise<SdkManifest | null> {
    if (!this.handshakePromise) {
      this.handshakePromise = this.doResolveManifestOnce().then((manifest) => {
        if (!manifest) this.handshakePromise = null;
        return manifest;
      });
    }
    return this.handshakePromise;
  }

  private async doResolveManifestOnce(): Promise<SdkManifest | null> {
    const localVersions = {
      poseRuntime: null as string | null,
      engine: (await this.files?.read(ENGINE_VERSION_KEY).catch(() => null)) ?? null,
    };

    if (this.apiToken) {
      const manifest = await this.resolveManifest(this.apiToken, localVersions);
      if (manifest) {
        this.manifest = manifest;
        if (manifest.revoked === true) {
          await this.handleRevocation('Access revoked by the backend.');
        }
      }
      return manifest;
    }

    try {
      const manifest = await handshake(null, { ...this.opts, localVersions });
      this.manifest = manifest;
      return manifest;
    } catch {
      return null;
    }
  }

  private async handleRevocation(message: string): Promise<void> {
    const engineVersion = await this.files?.read(ENGINE_VERSION_KEY).catch(() => null);
    if (engineVersion) {
      await this.files?.remove(`engine-${engineVersion}.sealed`).catch(() => {});
      await this.files?.remove(ENGINE_VERSION_KEY).catch(() => {});
    }
    await this.files?.remove(MANIFEST_CACHE_KEY).catch(() => {});
    this.engine = null;
    this.engineSource = null;
    this.stopExercise();
    this.setMode('keypoints-only');
    this.reportError({ type: 'error', code: 'invalid_token', message });
    this.applyWatermark();
  }

  private async handleCameraStart(info: {
    backend: string;
    profileId: string | null;
  }): Promise<void> {
    this.lastCameraStartInfo = info;
    const params = {
      backend: info.backend,
      profileId: info.profileId,
      poseModelProfile: this.opts.poseModelProfile ?? 'AdaptiveChoice',
      mode: this.mode,
      exercise: this.currentExerciseId,
      model: this.opts.model ?? 'movenet',
      modelUrl: this.opts.modelUrl ?? null,
    };

    if (!this.apiToken) {
      void this.tracker.trackAnonymous({ event: 'camera_start', params });
      return;
    }

    this.meteredSessionState = 'pending';
    try {
      await this.tracker.trackMetered({
        event: 'camera_start',
        apiToken: this.apiToken,
        params,
      });
      this.meteredSessionState = 'validated';
      this.opts.onDiagnostic?.('[posetracker-web] camera_start tracked (metered)');
    } catch (err) {
      this.meteredSessionState = 'refused';
      if (err instanceof TrackError && err.code === 'network') {
        this.reportError({
          type: 'error',
          code: 'offline_metered',
          message:
            'API-key features are not available offline: PoseTracker cannot count their usage. Keypoints-only keeps running.',
        });
      } else if (err instanceof TrackError && err.code === 'invalid_token') {
        await this.handleRevocation('API key invalid or revoked — engine cache purged.');
      } else if (err instanceof TrackError && err.code === 'quota_exceeded') {
        this.reportError({ type: 'error', code: 'quota_exceeded', message: err.message });
      } else {
        this.reportError({
          type: 'error',
          code: 'internal',
          message: `Usage tracking failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  private retryMeteredSessionIfRefused(): void {
    if (this.meteredSessionState === 'refused' && this.apiToken && this.lastCameraStartInfo) {
      void this.handleCameraStart(this.lastCameraStartInfo);
    }
  }

  private async tryConfigure({
    silentStatus,
    forceEngineRetry = false,
  }: {
    silentStatus: boolean;
    forceEngineRetry?: boolean;
  }): Promise<boolean> {
    if (this.mode === 'full-engine') return true;
    if (!this.apiToken) {
      this.validateRequestedFeatures();
      this.setMode('keypoints-only');
      this.applyWatermark();
      return false;
    }

    const manifest = await this.resolveManifestOnce();
    if (!manifest || manifest.revoked === true) {
      this.setMode('keypoints-only');
      this.applyWatermark();
      return false;
    }
    this.manifest = manifest;
    this.validateRequestedFeatures();

    if (!silentStatus) this.setStatus('downloading');
    const secret = deriveCacheSecret(this.apiToken);
    if (forceEngineRetry && manifest.engine) {
      await this.engineLoader.clearGuard(manifest.engine);
    }
    const result = await this.engineLoader.load(manifest.engine ?? null, secret, {
      forceRetry: forceEngineRetry,
    });
    if (!result) {
      const detail = this.engineLoader.lastError;
      this.reportError({
        type: 'error',
        code: 'engine_load_failed',
        message: detail
          ? `Engine bundle unavailable — ${detail}`
          : 'Engine bundle unavailable — running keypoints-only.',
      });
      this.setMode('keypoints-only');
      this.applyWatermark();
      return false;
    }

    this.engine = result.engine;
    this.engineSource = result.source;
    if (manifest.engine?.version) {
      await this.files?.write(ENGINE_VERSION_KEY, manifest.engine.version).catch(() => {});
    }
    this.setMode('full-engine');
    this.applyWatermark();
    return true;
  }

  private async resolveManifest(
    apiToken: string,
    localVersions?: ConfigureOptions['localVersions'],
  ): Promise<SdkManifest | null> {
    const secret = deriveCacheSecret(apiToken);
    try {
      const manifest = await handshake(apiToken, { ...this.opts, localVersions });
      await this.files
        ?.write(MANIFEST_CACHE_KEY, sealString(JSON.stringify(manifest), secret))
        .catch(() => {});
      return manifest;
    } catch (err) {
      if (err instanceof ConfigureError && err.code === 'invalid_token') {
        await this.handleRevocation(err.message);
        return null;
      }
      if (err instanceof ConfigureError && err.code === 'quota_exceeded') {
        this.reportError({ type: 'error', code: 'quota_exceeded', message: err.message });
        return null;
      }

      const sealed = await this.files?.read(MANIFEST_CACHE_KEY);
      if (sealed) {
        const plain = openString(sealed, secret);
        if (plain) {
          try {
            return JSON.parse(plain) as SdkManifest;
          } catch {
            await this.files?.remove(MANIFEST_CACHE_KEY).catch(() => {});
          }
        }
      }
      this.reportError({
        type: 'error',
        code: 'network',
        message: 'Handshake unreachable and no cached session — running keypoints-only.',
      });
      return null;
    }
  }

  private validateRequestedFeatures(): void {
    if (this.unsupportedFeatureKeys.length > 0 && !this.featureGateReported.unsupported) {
      this.featureGateReported.unsupported = true;
      this.reportError({
        type: 'error',
        code: 'feature_not_supported',
        message: featureNotSupportedMessage(this.unsupportedFeatureKeys[0]!),
      });
    }

    const f = this.features;
    const requestsDevFeatures = f.angles || f.recommendations || f.progression || f.keypoints;
    if (!requestsDevFeatures) return;

    if (!this.apiToken) {
      if (!this.featureGateReported.missingToken) {
        this.featureGateReported.missingToken = true;
        this.reportError({ type: 'error', code: 'invalid_token', message: INVALID_TOKEN_MESSAGE });
      }
      return;
    }

    if (this.getPlanType() === 'free') {
      const blocked = freeBlockedFeatures(f, { withExercise: false });
      if (blocked.length > 0 && !this.featureGateReported.freeBlock) {
        this.featureGateReported.freeBlock = true;
        this.reportError({
          type: 'error',
          code: 'free_plan_feature_blocked',
          message: FREE_PLAN_FEATURES_MESSAGE,
        });
      }
    }
  }

  private emitFromSession(event: PoseTrackerEvent): void {
    if (event.type === 'angles' && !this.features.angles) return;
    if (event.type === 'recommendations' && !this.features.recommendations) return;
    if (event.type === 'progression' && !this.features.progression) return;
    if (event.type === 'posture') {
      const draw = this.opts.drawPlacementBox !== false;
      this.shell?.setPlacementVisible(draw && !event.ready, this.opts.placementPaddingPercent ?? 10);
    } else if (event.type === 'exercise_summary') {
      this.shell?.setPlacementVisible(false);
    }
    this.emit(event);
  }

  private watermarkOn(): boolean {
    if (typeof this.opts.showWatermark === 'boolean') return this.opts.showWatermark;
    if (this.coldStartMode === 'basic' && !this.stream) return false;
    return shouldShowWatermark(this.getPlanType());
  }

  private applyWatermark(): void {
    this.shell?.setWatermarkVisible(this.watermarkOn() && this.cameraRevealed);
  }

  private revealCamera(): void {
    if (!this.shell || this.cameraRevealed) return;
    const v = this.shell.video;
    if (!(v.videoWidth > 0 && v.videoHeight > 0)) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (this.cameraRevealed || !this.shell) return;
        if (!(this.shell.video.videoWidth > 0)) return;
        this.cameraRevealed = true;
        this.shell.setCameraVisible(true);
        this.applyWatermark();
      });
    });
  }

  private setStatus(status: PoseTrackerStatus): void {
    this.status = status;
    if (status === 'configuring' || status === 'downloading' || status === 'warming') {
      this.emit({
        type: 'initialization',
        step: status,
        message:
          status === 'configuring'
            ? 'checking you plan and access'
            : status === 'downloading'
              ? 'downloading engine'
              : 'loading pose model',
        ready: false,
      });
    }
    this.notifyState();
  }

  private setMode(mode: PoseTrackerMode): void {
    if (this.mode !== mode) {
      this.mode = mode;
      this.notifyState();
    }
  }

  private reportError(error: ErrorEvent): void {
    this.lastError = error;
    this.emit(error);
    this.notifyState();
  }

  private notifyState(): void {
    this.stateListeners.forEach((l) => {
      try {
        l();
      } catch {
        /* ignore */
      }
    });
  }

  private emit(event: PoseTrackerEvent): void {
    this.listeners.forEach((l) => {
      try {
        l(event);
      } catch (err) {
        this.opts.onDiagnostic?.(
          `[posetracker-web] listener threw on '${event.type}': ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    });
    const typed = this.typedListeners.get(event.type);
    typed?.forEach((l) => {
      try {
        l(event);
      } catch {
        /* ignore */
      }
    });
    const any = this.typedListeners.get('*');
    any?.forEach((l) => {
      try {
        l(event);
      } catch {
        /* ignore */
      }
    });
    if (this.messageListeners.size === 0) return;
    const classic: ClassicNativeMessage = toClassicNativeMessage(event);
    this.messageListeners.forEach((l) => {
      try {
        l(classic);
      } catch {
        /* ignore */
      }
    });
  }
}

/** Factory — `createPoseTracker({ model: 'movenet' })`. */
export function createPoseTracker(options: PoseTrackerClientOptions = {}): PoseTrackerClient {
  return new PoseTrackerClient(options.apiToken, options);
}

export function PoseCamera_mount(
  target: string | HTMLElement,
  options: PoseTrackerClientOptions = {},
): PoseTrackerClient {
  const pt = createPoseTracker(options);
  pt.mount(target);
  return pt;
}

export const PoseCamera = {
  mount: PoseCamera_mount,
};
