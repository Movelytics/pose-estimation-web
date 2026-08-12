# `@pose-tracker/pose-estimation-web`

Vanilla browser pose estimation (MoveNet / BlazePose / custom `modelUrl`) +
remote exercise engine after `configure(apiToken)`.

Default model:
`https://app.posetracker.com/scripts/tmp_model_to_remove.json`

## Install (npm)

```bash
npm install @pose-tracker/pose-estimation-web @tensorflow/tfjs
# Optional — BlazePose in bundlers (React / Vite). Vanilla IIFE can use CDN.
npm install @tensorflow-models/pose-detection
```

```ts
import { createPoseTracker } from '@pose-tracker/pose-estimation-web';

const pt = createPoseTracker({ model: 'movenet' });
pt.mount('#root');
await pt.start(); // default source = camera (webcam)
pt.on('keypoints', (e) => console.log(e.keypoints));

// BlazePose (peer or CDN window.poseDetection / auto-inject):
await pt.setModel('blazepose');

// Uploaded video / still image:
await pt.setSource({ type: 'video', src: videoFile }); // File | Blob | URL | HTMLVideoElement
await pt.start();
await pt.setSource({ type: 'image', src: imageFile });
await pt.start();       // single-shot keypoints
await pt.analyze();     // re-run on the same image
```

## Input sources

| `PoseSource` | Behavior |
|---|---|
| `{ type: 'camera', facingMode? }` | Live `getUserMedia` (default) |
| `{ type: 'video', src }` | File / blob URL / `<video>` — stream while playing |
| `{ type: 'image', src }` | File / blob URL / `<img>` / ImageBitmap — one shot (+ `analyze()`) |

## Script tag (CDN)

The IIFE build exposes a **`PoseTracker`** global (`PoseTracker.createPoseTracker`, …).

**Load TensorFlow.js first**, then the SDK. Order matters.

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PoseTracker</title>
    <!-- 1) TensorFlow.js (peer — required before PoseTracker) -->
    <script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js"></script>
    <!-- 2) PoseTracker IIFE (jsDelivr / unpkg both work) -->
    <script src="https://cdn.jsdelivr.net/npm/@pose-tracker/pose-estimation-web@0.2.0/dist/pose-tracker.global.js"></script>
  </head>
  <body>
    <div id="root" style="width: 100%; height: 100vh; background: #111"></div>
    <script>
      const pt = PoseTracker.createPoseTracker({
        model: 'movenet',
        drawSkeleton: true,
        // source defaults to camera; also: { type:'video'|'image', src }
      });
      pt.mount('#root');
      pt.start().catch(console.error); // webcam
      // pt.setSource({ type: 'image', src: file }).then(() => pt.start());
      pt.on('keypoints', (e) => console.log(e.keypoints.length));
    </script>
  </body>
</html>
```

Equivalent unpkg URL:

```text
https://unpkg.com/@pose-tracker/pose-estimation-web@0.2.0/dist/pose-tracker.global.js
```

Omitting `/dist/...` also works — `package.json` `jsdelivr` / `unpkg` fields point at the IIFE.

### Optional BlazePose (CDN)

Preload pose-detection after TF.js (or omit — the SDK can inject the same CDN URL):

```html
<script src="https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js"></script>
```

### Global API (IIFE)

| Global | Notes |
|--------|--------|
| `PoseTracker.createPoseTracker(options?)` | Main factory |
| `PoseTracker.PoseCamera` / mount helpers | Camera helper |
| `PoseTracker.configure` | Standalone configure helper |
| `PoseTracker.DEFAULT_MOVENET_LIGHTNING_URL` | Default model URL |
| `PoseTracker.SDK_VERSION` / `SDK_NAME` | Package identity |

BlazePose maps to the same COCO-17 `keypoints` event shape as MoveNet (extra
face/hand/foot landmarks dropped). It is heavier than MoveNet Lightning.

See monorepo root README for exercises + examples.
