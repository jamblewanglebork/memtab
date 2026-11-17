import { build } from 'vite';
import { cp, mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

await build();
// A content script is a classic script: it cannot import Rollup's shared ES modules.
await build({ configFile: false, publicDir: false, build: {
  emptyOutDir: false, sourcemap: false, target: 'es2022',
  lib: { entry: resolve('src/content/extractor.ts'), name: 'MemTabExtractor', formats: ['iife'], fileName: () => 'extractor.js' },
}});
await mkdir('dist/assets/ort', { recursive: true });
const runtime = 'node_modules/onnxruntime-web/dist';
const files = (await readdir(runtime)).filter(name => name === 'ort-wasm-simd-threaded.asyncify.mjs');
if (!(await readdir('dist/assets')).some(name => name.endsWith('.wasm'))) throw new Error('Missing bundled ONNX WASM binaries');
for (const file of files) await cp(`${runtime}/${file}`, `dist/assets/ort/${file}`);
console.log('Bundled local ONNX WASM and module factory. Load the dist folder in Chrome.');
