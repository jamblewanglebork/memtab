import { env, pipeline } from '@huggingface/transformers';
import wasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url';
import { MemoryEngine } from './engine';
import { runBenchmark } from '../benchmark/runner';
import type { Message, Reply } from '../shared/types';

env.allowLocalModels = false;
env.useBrowserCache = true;
// Packaged runtime files must be imported directly; the library's blob-based WASM cache violates MV3 CSP.
env.useWasmCache = false;
const wasm = env.backends.onnx.wasm!;
wasm.numThreads = 1;
wasm.proxy = false;
wasm.wasmPaths = {
  mjs: chrome.runtime.getURL('assets/ort/ort-wasm-simd-threaded.asyncify.mjs'),
  wasm: wasmUrl,
};
let modelPromise: Promise<any> | null = null;
let serial: Promise<unknown> = Promise.resolve();
let benchmarking = false;
let benchmarkProgress = { running: false, done: 0, total: 280, phase: 'Ready', report: null as any, error: '' };
const engine = new MemoryEngine(embed);

function loadModel(): Promise<any> {
  if (!modelPromise) {
    engine.modelState = 'loading'; engine.error = undefined;
    modelPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      dtype: 'q8', device: 'wasm',
      progress_callback: (event: any) => { if (event.status === 'progress') engine.progress = Math.round(event.progress ?? 0); },
    }).then(model => { engine.modelState = 'ready'; engine.progress = 100; return model; }).catch(error => {
      engine.modelState = 'error'; engine.error = `Model could not load. Check your connection and retry. ${error.message}`;
      modelPromise = null; throw new Error(engine.error);
    });
  }
  return modelPromise;
}
function embed(text: string): Promise<Float32Array> {
  const job = serial.catch(() => {}).then(async () => {
    const model = await loadModel();
    const output = await model(text.slice(0, 1600), { pooling: 'mean', normalize: true });
    return Float32Array.from(output.data as ArrayLike<number>);
  });
  serial = job; return job;
}
async function handle(message: Message) {
  await engine.ready;
  switch (message.type) {
    case 'CONFIGURE': await engine.configure(message.payload); void engine.indexPending(); return engine.status();
    case 'INGEST': { const count = await engine.ingest(message.payload); if (!benchmarking) void engine.indexPending(); return count; }
    case 'SEARCH': return engine.search(message.payload.query, message.payload.topK);
    case 'STATUS': return engine.status();
    case 'ENABLE_MODEL': await loadModel(); engine.modelState = 'ready'; void engine.indexPending(); return engine.status();
    case 'REMOVE': await engine.remove(message.payload); return true;
    case 'REMOVE_SOURCE': await engine.removeSource(message.payload.source, message.payload.urls); return true;
    case 'CLEAR': await engine.clear(); return true;
    case 'TAB_VECTORS': return engine.tabVectors(message.payload);
    case 'BENCHMARK_STATUS': return benchmarkProgress;
    case 'BENCHMARK_START': {
      if (benchmarking || engine.indexing) throw new Error('Wait for background indexing to finish, or pause capture before running the benchmark.');
      benchmarking = true;
      benchmarkProgress = { running: true, done: 0, total: 280, phase: 'Loading local model', report: null, error: '' };
      const wasLoaded = engine.modelState === 'ready';
      void runBenchmark(embed, loadModel, wasLoaded, update => Object.assign(benchmarkProgress, update))
        .then(report => { benchmarkProgress.report = report; })
        .catch(error => { benchmarkProgress.error = error.message; })
        .finally(() => { benchmarking = false; benchmarkProgress.running = false; void engine.indexPending(); });
      return true;
    }
    default: throw new Error(`Unknown local engine operation: ${message.type}`);
  }
}
chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  if (message.target !== 'offscreen' || sender.id !== chrome.runtime.id || sender.tab) return;
  handle(message).then(data => sendResponse({ ok: true, data } satisfies Reply<unknown>))
    .catch(error => sendResponse({ ok: false, error: error.message } satisfies Reply<unknown>));
  return true;
});
