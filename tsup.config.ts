import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    treeshake: true,
    target: 'es2020',
    outDir: 'dist',
    external: ['@tensorflow/tfjs', '@tensorflow-models/pose-detection'],
  },
  {
    entry: { 'pose-tracker': 'src/global.ts' },
    format: ['iife'],
    globalName: 'PoseTracker',
    sourcemap: true,
    minify: true,
    clean: false, // don't wipe ESM/CJS from the first config
    target: 'es2020',
    outDir: 'dist',
    outExtension: () => ({ js: '.global.js' }),
    external: ['@tensorflow/tfjs', '@tensorflow-models/pose-detection'],
    dts: false,
  },
]);
