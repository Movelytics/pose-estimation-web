# Changelog

## [0.3.6] — 2026-10-02

### Added

- External frames: `warmupExternal()` and `processFrame()`. The page keeps its own camera. The SDK returns keypoints, placement, and rep events and draws nothing.
- Handshake `sdkVersion` is `0.3.6`.

## [0.3.5] — 2026-10-01

### Changed

- Default placement zone matches the iframe: grayed sides and the PoseTracker frame (`#4DD21D`), replacing the dashed gold box.
- Handshake `sdkVersion` is `0.3.5`.

## [0.3.4] — 2026-09-29

### Changed

- Handshake `sdkVersion` is `0.3.4`, aligned with the React Native SDKs.
- The iOS VisionCamera autolinking fix ships only in the React Native packages. This web package has no native pod.

## [0.3.3] — 2026-09-29

### Added

- `back_flexibility_test` in the V4-only exercise list.
- `analysis` on counter and rep summaries.
- `disclaimer` and `method` on the exercise summary when the movement emits a report.
- Form grade `E`.
- Handshake `sdkVersion` is `0.3.3` (it had stayed at `0.3.1`).

## [0.3.1] — 2026-09-08

### Changed

- Handshake default is now **V4**. Unlabeled `startExercise('squat')` stays on the production V3 FSM inside the V4 bundle.
- `engine: 'v4'` = catalog squat; `engine: 'v3'` = V3 bundle.

### Notes

- 0.3.0 clients still default to V3. 0.2.x omit `engineChannel` and stay on V3.

## [0.3.0] — 2026-08-26

### Added

- Opt-in `engine: 'v4'` on `createPoseTracker` / `PoseTrackerProvider` (default `'v3'`).
- Handshake `engineChannel`; V4 downloads `engine-v4.bundle.js`.
- V4 catalog: `squat`, `shoulder_roll`, `shoulder_deep_breath`, `chair_forward_fold`.
- V4-only ids on V3 throw `Exercise 'x' requires engine: 'v4'`.
- `getEngineChannel()`.

### Notes

- Jumps stay V3-only. V4 does not emit `recommendations`.
- 0.2.x clients remain on V3 when `engineChannel` is omitted.

## [0.2.0] — 2026-08

First public 0.2 line (media sources, BlazePose, exercises via API token).
