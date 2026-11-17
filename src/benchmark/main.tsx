import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, Download, FlaskConical, LoaderCircle, Play, ShieldCheck } from 'lucide-react';
import { Brand } from '../ui/App';
import { inExtension, openPage, request, size } from '../ui/api';
import { reportCSV, type BenchmarkReport } from './runner';
import '../ui/styles.css';
import './styles.css';

interface Progress { running: boolean; done: number; total: number; phase: string; report: BenchmarkReport | null; error: string }
function download(content: string, mime: string, extension: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a'); link.href = url; link.download = `memtab-benchmark-${new Date().toISOString().slice(0, 10)}.${extension}`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Benchmark() {
  const [state, setState] = useState<Progress>({ running: false, done: 0, total: 280, phase: 'Ready', report: null, error: '' });
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    const poll = () => { void request<Progress>('BENCHMARK_STATUS').then(setState).catch(error => setError(error.message)); };
    poll(); const timer = setInterval(poll, 1000); return () => clearInterval(timer);
  }, []);
  const report = state.report;
  return <div className="benchmark-shell"><header className="benchmark-topbar"><Brand /><button className="text-button" onClick={() => openPage('library.html')}><ArrowLeft size={14} />Back to library</button></header>
    <main className="benchmark-content"><div className="eyebrow">REPRODUCIBLE SYSTEMS EVALUATION</div><h1>Measure the memory.</h1><p className="hero-subtitle">A synthetic browsing trace. Real local inference. Exportable results.</p>
      {!inExtension && <div className="preview-banner">Load the extension in Chrome to run the benchmark.</div>}
      <div className="benchmark-intro"><div className="feature-icon"><FlaskConical size={25} /></div><div><h2>240 pages · 8 topics · 40 judged queries</h2><p>Compare Float32, Int8, and Binary retrieval using the same embeddings. This run uses an isolated in-memory dataset and never modifies your browsing index or calls a cloud provider.</p></div></div>
      <div className="benchmark-actions"><button className="button primary" disabled={starting || state.running} onClick={async () => { setStarting(true); setError(''); try { await request('BENCHMARK_START'); setState(current => ({ ...current, running: true, done: 0, report: null, phase: 'Starting' })); } catch (error) { setError((error as Error).message); } finally { setStarting(false); } }}>{starting || state.running ? <LoaderCircle size={16} className="spin" /> : <Play size={16} />}{state.running ? 'Benchmark running' : 'Run benchmark'}</button><span><ShieldCheck size={13} />{state.running ? 'You can keep this page open or return later.' : 'Pause capture or wait for indexing to finish before running.'}</span></div>
      {(error || state.error) && <div className="toast error" role="alert">{error || state.error}</div>}
      {state.running && <div className="settings-card model-progress"><div><span>{state.phase}</span><strong>{state.done} / {state.total}</strong></div><progress value={state.done} max={state.total} /><p className="settings-description">The first run may download the model. Documents are embedded sequentially to bound memory use.</p></div>}
      {report && <><div className="benchmark-result-header"><h2>Results from this device</h2><span>{new Date(report.timestamp).toLocaleString()}</span><button className="button small" onClick={() => download(JSON.stringify(report, null, 2), 'application/json', 'json')}><Download size={14} />JSON</button><button className="button small" onClick={() => download(reportCSV(report), 'text/csv;charset=utf-8', 'csv')}><Download size={14} />CSV</button></div>
        <div className="metric-grid"><div><span>Model initialization</span><strong>{report.modelInitializationMs.toFixed(1)} <small>ms</small></strong><p>{report.modelAlreadyLoaded ? 'Already loaded · warm' : 'New engine · disk cache may be warm'}</p></div><div><span>Mean document inference</span><strong>{report.documentInference.meanMs.toFixed(1)} <small>ms</small></strong><p>P50 {report.documentInference.p50Ms.toFixed(1)} · P95 {report.documentInference.p95Ms.toFixed(1)} ms</p></div><div><span>Mean query inference</span><strong>{report.queryInference.meanMs.toFixed(1)} <small>ms</small></strong><p>Separate from vector scan time</p></div><div><span>Peak observed JS heap</span><strong>{report.peakObservedJSHeapMB === null ? 'N/A' : report.peakObservedJSHeapMB.toFixed(1)} <small>MB</small></strong><p>JS heap only · WASM may be omitted</p></div></div>
        <div className="table-card"><h3>Retrieval quality and packed vector storage</h3><div className="table-scroll"><table><thead><tr><th>Precision</th><th>Vector size</th><th>Scan P50</th><th>Scan P95</th><th>Recall@1</th><th>Recall@5</th><th>Recall@10</th><th>Hit@1</th><th>MRR@10</th></tr></thead><tbody>{report.modes.map(mode => <tr key={mode.mode}><td>{mode.mode}</td><td>{size(mode.vectorBytes)}</td><td>{mode.scanP50Ms.toFixed(2)} ms</td><td>{mode.scanP95Ms.toFixed(2)} ms</td><td>{(mode.recallAt1 * 100).toFixed(1)}%</td><td>{(mode.recallAt5 * 100).toFixed(1)}%</td><td>{(mode.recallAt10 * 100).toFixed(1)}%</td><td>{(mode.hitAt1 * 100).toFixed(1)}%</td><td>{mode.mrrAt10.toFixed(3)}</td></tr>)}</tbody></table></div><p>Recall uses six judged relevant pages per query; Recall@1 has a maximum of 16.7%. Hit@1 measures whether the first result is relevant. Scan times exclude embedding and messaging.</p></div>
        <div className="metric-grid lower-metrics"><div><span>Clustering agreement</span><strong>{report.clustering.nmi.toFixed(3)} <small>NMI</small></strong><p>{report.clustering.groups} clusters · {report.clustering.latencyMs.toFixed(1)} ms · threshold {report.clustering.threshold}</p></div><div><span>Estimated token reduction</span><strong>{report.tokens.reductionPercent.toFixed(1)}<small>%</small></strong><p>{report.tokens.full.toLocaleString()} → {report.tokens.pruned.toLocaleString()} estimated tokens</p></div></div>
        <div className="benchmark-notes"><h3>How to interpret these measurements</h3>{report.notes.map(note => <p key={note}>{note}</p>)}<p>{report.model} · {report.dtype} · {report.device} · {report.dimensions} dimensions</p></div>
      </>}
      {!report && !state.running && <div className="benchmark-notes"><h3>What this run measures</h3><p>Model initialization, single-document and query inference latency, observed JS heap, vector storage, judged Recall@1/5/10, Hit@1/5, MRR@10, clustering NMI, and estimated cloud payload savings.</p><p>The synthetic trace is an exploratory systems workload. It is not evidence of real-world retrieval quality or a guarantee of any latency, memory, or token-saving target.</p><p>Results stay in the offscreen engine until it closes. Export JSON or CSV after each run to keep a permanent report.</p></div>}
    </main></div>;
}
createRoot(document.getElementById('root')!).render(<Benchmark />);
