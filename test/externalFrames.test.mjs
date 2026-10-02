/**
 * External frames API (warmupExternal / processFrame) against the built
 * package. Run: npm run build && npm test
 *
 * The detector and the exercise engine are fakes: these tests check the
 * orchestration (warmup, drop rule, one engine session across frames, events
 * on the promise and on listeners, camera path untouched), not MoveNet.
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { createPoseTracker } from '../dist/index.js';

const KEYPOINT_NAMES = [
  'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
  'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
];

let getUserMediaCalls = 0;

beforeEach(() => {
  getUserMediaCalls = 0;
  globalThis.fetch = async () => {
    throw new Error('offline (test)');
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => {
          getUserMediaCalls += 1;
          throw new Error('getUserMedia must not be called');
        },
      },
    },
  });
});

function fakeTracker() {
  return {
    flushQueue: async () => {},
    trackAnonymous: async () => {},
    trackMetered: async () => {},
  };
}

function fakeAdapter({ delayMs = 0 } = {}) {
  const calls = [];
  return {
    calls,
    modelId: 'fake-movenet',
    async load() {},
    async estimate(input, options) {
      calls.push({ input, options });
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      const keypoints = KEYPOINT_NAMES.map((name) => ({ name, x: 0.5, y: 0.5, score: 0.9 }));
      return {
        keypoints,
        score: 0.9,
        inferenceMs: 5,
        videoKeypoints: [],
        letterbox: { offsetX: 0, offsetY: 0, drawW: 192, drawH: 192, vw: 192, vh: 192 },
      };
    },
    resetTemporal() {
      throw new Error('processFrame must not reset temporal state');
    },
    dispose() {},
  };
}

function fakeEngine() {
  const state = { sessions: 0, ended: 0 };
  return {
    state,
    version: 'test',
    listExercises: () => [{ id: 'squat', displayName: 'Squat', type: 'dynamic' }],
    createSession(_opts, sink) {
      state.sessions += 1;
      let count = 0;
      return {
        processPose(pose) {
          count += 1;
          sink({ type: 'counter', count, timestampMs: pose.timestampMs });
          sink({ type: 'posture', ready: true, timestampMs: pose.timestampMs });
        },
        end() {
          state.ended += 1;
        },
      };
    },
  };
}

function makeClient(adapter = fakeAdapter()) {
  const client = createPoseTracker({
    engine: 'v4',
    fileStore: null,
    usageTracker: fakeTracker(),
  });
  // Skip the CDN model download: the adapter is what preload() would load.
  client.adapter = adapter;
  return client;
}

const frame = (timestampMs) => ({
  image: { width: 192, height: 144 },
  width: 192,
  height: 144,
  timestampMs,
});

test('processFrame before warmupExternal throws', async () => {
  const client = makeClient();
  await assert.rejects(() => client.processFrame(frame(1)), /warmupExternal/);
});

test('warmupExternal loads the model without camera or mount', async () => {
  const client = makeClient();
  await client.warmupExternal();
  assert.equal(client.getStatus(), 'ready');
  assert.equal(getUserMediaCalls, 0);
  // Idempotent.
  await client.warmupExternal();
  assert.equal(getUserMediaCalls, 0);
});

test('keypoints-only frame returns pose + keypoints event, normalized to the frame', async () => {
  const adapter = fakeAdapter();
  const client = makeClient(adapter);
  await client.warmupExternal();
  const seen = [];
  client.on('keypoints', (e) => seen.push(e));
  const result = await client.processFrame(frame(1000));
  assert.equal(result.dropped, false);
  assert.equal(result.pose.timestampMs, 1000);
  assert.deepEqual(result.events.map((e) => e.type), ['keypoints']);
  assert.equal(seen.length, 1);
  assert.equal(adapter.calls[0].options.displayWidth, 192);
  assert.equal(adapter.calls[0].options.displayHeight, 144);
  assert.equal(adapter.calls[0].options.facingMode, 'user');
  assert.equal(adapter.calls[0].options.temporalSmooth, true);
});

test('mirrored: false maps to an unmirrored (environment) frame', async () => {
  const adapter = fakeAdapter();
  const client = makeClient(adapter);
  await client.warmupExternal();
  await client.processFrame({ ...frame(1), mirrored: false });
  assert.equal(adapter.calls[0].options.facingMode, 'environment');
});

test('overlapping calls drop the second frame without inferring it', async () => {
  const adapter = fakeAdapter({ delayMs: 20 });
  const client = makeClient(adapter);
  await client.warmupExternal();
  const first = client.processFrame(frame(1));
  const second = await client.processFrame(frame(2));
  assert.equal(second.dropped, true);
  assert.deepEqual(second.events, []);
  const firstResult = await first;
  assert.equal(firstResult.dropped, false);
  assert.equal(adapter.calls.length, 1);
});

test('one exercise session runs across frames: counter advances, engine not reset', async () => {
  const client = makeClient();
  await client.warmupExternal();
  const engine = fakeEngine();
  client.engine = engine;
  client.mode = 'full-engine';
  client.startExercise('squat');

  const counters = [];
  client.on('counter', (e) => counters.push(e.count));

  const r1 = await client.processFrame(frame(1000));
  const r2 = await client.processFrame(frame(1033));

  assert.equal(engine.state.sessions, 1);
  assert.equal(engine.state.ended, 0);
  assert.deepEqual(counters, [1, 2]);
  assert.deepEqual(
    r1.events.filter((e) => e.type === 'counter').map((e) => e.count),
    [1],
  );
  assert.deepEqual(
    r2.events.filter((e) => e.type === 'counter').map((e) => e.count),
    [2],
  );
  assert.ok(r2.events.some((e) => e.type === 'posture'));
});

test('processFrame refuses to mix with a running SDK camera/media session', async () => {
  const client = makeClient();
  await client.warmupExternal();
  client.running = true;
  await assert.rejects(() => client.processFrame(frame(1)), /cannot run together/);
});

test('camera path is untouched: analyze() still requires mount()', async () => {
  const client = makeClient();
  await assert.rejects(() => client.analyze(), /Call mount\(\) before analyze\(\)/);
  await assert.rejects(() => client.start(), /Call mount\(\) before start\(\)/);
  assert.equal(client.externalReady, false);
});
