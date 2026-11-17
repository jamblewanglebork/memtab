import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      input: {
        popup: resolve('popup.html'),
        library: resolve('library.html'),
        benchmark: resolve('benchmark.html'),
        offscreen: resolve('offscreen.html'),
        background: resolve('src/background/service-worker.ts'),
      },
      output: {
        entryFileNames: chunk => chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
