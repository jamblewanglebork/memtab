import dataset from './synthetic_dataset.json';
import { clusterVectors, nmi, representativeIndices } from '../shared/clustering';
import { compress, normalize, similarity } from '../shared/quantization';
import type { QuantizationMode } from '../shared/types';

export interface ModeMetrics {
  mode: QuantizationMode; vectorBytes: number; scanMeanMs: number; scanP50Ms: number; scanP95Ms: number;
  recallAt1: number; recallAt5: number; recallAt10: number; hitAt1: number; hitAt5: number; mrrAt10: number;
}
export interface BenchmarkReport {
  version: number; timestamp: string; model: string; dtype: string; device: string;
  documentCount: number; queryCount: number; dimensions: number; userAgent: string; hardwareConcurrency: number;
  modelAlreadyLoaded: boolean; modelInitializationMs: number;
  documentInference: { meanMs: number; p50Ms: number; p95Ms: number };
  queryInference: { meanMs: number; p50Ms: number; p95Ms: number };
  initialJSHeapMB: number | null; peakObservedJSHeapMB: number | null;
  modes: ModeMetrics[]; clustering: { threshold: number; groups: number; nmi: number; latencyMs: number };
  tokens: { full: number; pruned: number; reductionPercent: number; estimated: true };
  notes: string[];
}
export function percentiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { meanMs: values.reduce((sum, value) => sum + value, 0) / (values.length || 1),
    p50Ms: sorted[Math.max(0, Math.ceil(sorted.length * 0.5) - 1)] ?? 0,
    p95Ms: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0 };
}
export function retrievalMetrics(ranked: string[], relevant: string[]) {
  const set = new Set(relevant);
  const hits = (k: number) => ranked.slice(0, k).filter(id => set.has(id)).length;
  const first = ranked.slice(0, 10).findIndex(id => set.has(id));
  return { recallAt1: hits(1) / (set.size || 1), recallAt5: hits(5) / (set.size || 1), recallAt10: hits(10) / (set.size || 1),
    hitAt1: Number(hits(1) > 0), hitAt5: Number(hits(5) > 0), mrrAt10: first === -1 ? 0 : 1 / (first + 1) };
}
function heapMB(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? memory.usedJSHeapSize / 1048576 : null;
}
export async function runBenchmark(embed: (text: string) => Promise<Float32Array>, load: () => Promise<unknown>, modelAlreadyLoaded: boolean,
  progress: (update: { done?: number; phase?: string }) => void): Promise<BenchmarkReport> {
  const initialHeap = heapMB();
  let peak = initialHeap;
  const sampleHeap = () => { const value = heapMB(); if (value !== null) peak = Math.max(peak ?? 0, value); };
  const start = performance.now(); await load(); const initialization = performance.now() - start;
  const vectors: Float32Array[] = [], inference: number[] = [], queryInference: number[] = [], queryVectors: Float32Array[] = [];
  const heapTimer = setInterval(sampleHeap, 25);
  try {
    for (let i = 0; i < dataset.documents.length; i++) {
      const doc = dataset.documents[i];
      progress({ done: i, phase: `Embedding document ${i + 1} / 240` });
      const started = performance.now(); vectors.push(normalize(await embed(`${doc.title}\n${doc.snippet}`)));
      inference.push(performance.now() - started); sampleHeap();
    }
    for (let i = 0; i < dataset.queries.length; i++) {
      progress({ done: 240 + i, phase: `Embedding query ${i + 1} / 40` });
      const started = performance.now(); queryVectors.push(normalize(await embed(dataset.queries[i].text)));
      queryInference.push(performance.now() - started); sampleHeap();
    }
    const modes: ModeMetrics[] = [];
    for (const mode of ['float32', 'int8', 'binary'] as QuantizationMode[]) {
      progress({ phase: `Evaluating ${mode} retrieval`, done: 280 });
      const packed = vectors.map(vector => compress(vector, mode));
      const scans: number[] = [];
      const total = { recallAt1: 0, recallAt5: 0, recallAt10: 0, hitAt1: 0, hitAt5: 0, mrrAt10: 0 };
      for (let i = 0; i < queryVectors.length; i++) {
        const query = compress(queryVectors[i], mode);
        const scan = () => packed.map((vector, index) => ({ index, score: similarity(vector, query, mode) })).sort((a, b) => b.score - a.score);
        scan(); // Untimed warm-up; query inference is excluded from scan timings.
        let ranked = scan();
        for (let repeat = 0; repeat < 5; repeat++) {
          const started = performance.now(); ranked = scan(); scans.push(performance.now() - started);
        }
        const metrics = retrievalMetrics(ranked.map(item => dataset.documents[item.index].id), dataset.queries[i].relevantIds);
        for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += metrics[key] / queryVectors.length;
      }
      const timings = percentiles(scans);
      modes.push({ mode, vectorBytes: packed.reduce((sum, vector) => sum + vector.byteLength, 0),
        scanMeanMs: timings.meanMs, scanP50Ms: timings.p50Ms, scanP95Ms: timings.p95Ms, ...total });
      sampleHeap();
    }
    progress({ phase: 'Measuring clustering and payload savings' });
    const clusterStart = performance.now(); const clusters = clusterVectors(vectors, 0.45); const clusterMs = performance.now() - clusterStart;
    const labels = new Array<number>(vectors.length);
    clusters.forEach((cluster, label) => cluster.forEach(index => { labels[index] = label; }));
    const fullTokens = Math.ceil(JSON.stringify(dataset.documents.map(doc => ({ title: doc.title, snippet: doc.snippet }))).length / 4);
    const pruned = clusters.filter(cluster => cluster.length >= 2).map((cluster, clusterId) => {
      const representatives = representativeIndices(vectors, cluster);
      return { clusterId, representatives: representatives.map(index => ({ title: dataset.documents[index].title.slice(0, 180), snippet: dataset.documents[index].snippet.slice(0, 600) })),
        otherTitles: cluster.filter(index => !representatives.includes(index)).map(index => dataset.documents[index].title.slice(0, 100)) };
    });
    const prunedTokens = Math.ceil(JSON.stringify(pruned).length / 4);
    sampleHeap(); progress({ phase: 'Complete', done: 280 });
    return {
      version: 1, timestamp: new Date().toISOString(), model: 'Xenova/all-MiniLM-L6-v2', dtype: 'q8', device: 'wasm (1 thread)',
      documentCount: vectors.length, queryCount: queryVectors.length, dimensions: vectors[0]?.length ?? 384,
      userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
      modelAlreadyLoaded, modelInitializationMs: initialization, documentInference: percentiles(inference), queryInference: percentiles(queryInference),
      initialJSHeapMB: initialHeap, peakObservedJSHeapMB: peak, modes,
      clustering: { threshold: 0.45, groups: clusters.length, nmi: nmi(dataset.documents.map(doc => doc.topic), labels), latencyMs: clusterMs },
      tokens: { full: fullTokens, pruned: prunedTokens, reductionPercent: (1 - prunedTokens / fullTokens) * 100, estimated: true },
      notes: [
        dataset.description,
        'Model initialization is cold for this offscreen engine only if modelAlreadyLoaded=false. Cached downloads may still make it warm; a true download-cold run requires clearing extension model cache.',
        'Vector scan timings exclude query embedding and use five repeats per query after a warm-up. End-to-end search also includes embedding, IPC, filtering, and UI time.',
        'Recall@K counts judged relevant documents retrieved divided by all six relevant documents. Hit@K measures queries with at least one relevant result; MRR@10 measures the first relevant rank.',
        'Observed performance.memory samples describe JS heap only, include preexisting engine allocations, and can omit WASM/native memory. Null means unavailable. These values are not total process RAM.',
        'Vector bytes describe packed vectors only, not metadata, model weights, database overhead, or the total extension footprint.',
        'Token counts are character-length / 4 estimates, omit fixed prompt overhead, and are not provider billing measurements. Singleton clusters are omitted from the pruned payload, as in the organizer.',
      ],
    };
  } finally { clearInterval(heapTimer); }
}
export function reportCSV(report: BenchmarkReport): string {
  const rows: (string | number | boolean | null)[][] = [['section', 'metric', 'mode', 'value', 'unit']];
  const row = (section: string, metric: string, value: string | number | boolean | null, unit = '', mode = '') => rows.push([section, metric, mode, value, unit]);
  row('environment', 'timestamp', report.timestamp); row('environment', 'model', report.model); row('environment', 'dtype', report.dtype); row('environment', 'device', report.device);
  row('environment', 'user_agent', report.userAgent); row('environment', 'hardware_concurrency', report.hardwareConcurrency); row('environment', 'documents', report.documentCount); row('environment', 'queries', report.queryCount); row('environment', 'dimensions', report.dimensions);
  row('model', 'already_loaded', report.modelAlreadyLoaded); row('model', 'initialization', report.modelInitializationMs, 'ms');
  for (const [key, value] of Object.entries(report.documentInference)) row('document_inference', key, value, 'ms');
  for (const [key, value] of Object.entries(report.queryInference)) row('query_inference', key, value, 'ms');
  row('memory', 'initial_js_heap', report.initialJSHeapMB, 'MB'); row('memory', 'peak_observed_js_heap', report.peakObservedJSHeapMB, 'MB');
  for (const mode of report.modes) for (const [key, value] of Object.entries(mode)) if (key !== 'mode') row('retrieval', key, value, key === 'vectorBytes' ? 'bytes' : key.includes('Ms') ? 'ms' : 'ratio', mode.mode);
  for (const [key, value] of Object.entries(report.clustering)) row('clustering', key, value, key === 'latencyMs' ? 'ms' : '');
  for (const [key, value] of Object.entries(report.tokens)) row('tokens', key, value, key === 'reductionPercent' ? '%' : '');
  for (const note of report.notes) row('notes', 'limitation', note);
  return rows.map(values => values.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
}
