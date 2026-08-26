# Changelog

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
