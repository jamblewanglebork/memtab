import { DEFAULT_SETTINGS, type EngineStatus, type Filter, type Reply, type SearchResult, type Settings } from '../shared/types';

export const inExtension = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
const sample = [
  ['Valgrind Memcheck: finding memory leaks', 'https://valgrind.org/docs/manual/mc-manual.html', 'Track down heap allocations that never get freed. A practical guide to debugging C and C++ programs with Memcheck.', ['history'], true],
  ['The Illustrated Transformer', 'https://jalammar.github.io/illustrated-transformer/', 'A visual introduction to attention, language models, and the architecture that changed natural language processing.', ['bookmark', 'history'], false],
  ['Building better habits, one small step at a time', 'https://jamesclear.com/atomic-habits', 'How small, consistent improvements compound over time. Designing your environment to make good habits easier.', ['bookmark'], false],
  ['A practical guide to vector search', 'https://www.pinecone.io/learn/vector-search/', 'Embeddings turn ideas into coordinates. Find similar documents by meaning using cosine similarity and approximate nearest neighbors.', ['history'], true],
  ['The perfect weeknight tomato pasta', 'https://www.seriouseats.com/tomato-pasta', 'Slowly simmered tomatoes, garlic, olive oil, and a little pasta water come together in a simple twenty-minute dinner.', ['history'], false],
  ['Chrome Extensions: offscreen documents', 'https://developer.chrome.com/docs/extensions/reference/api/offscreen', 'Keep background work running with a hidden extension document. A guide to Manifest V3 and the offscreen API.', ['bookmark', 'history'], true],
  ['How to think about index funds', 'https://www.bogleheads.org/wiki/Index_fund', 'Build a diversified portfolio with low-cost passive investing. Understand expense ratios and long-term returns.', ['bookmark'], false],
  ['Understanding Formula 1 aerodynamics', 'https://www.formula1.com/en/latest/technical', 'Downforce, drag, and the ground effect. The engineering decisions behind a faster lap.', ['history'], false],
] as const;
let demoSettings = { ...DEFAULT_SETTINGS };
let demoPages: SearchResult[] = sample.map(([title, url, snippet, sources, isOpen], i) => ({ title, url, snippet, sources: [...sources], isOpen,
  score: 0.9 - i * 0.04, captured: true, semantic: false, updatedAt: Date.now() - i * 3600000 }));
export async function request<T>(type: string, payload?: unknown): Promise<T> {
  if (!inExtension) return demo(type, payload) as T;
  const response: Reply<T> = await chrome.runtime.sendMessage({ target: 'background', type, payload });
  if (!response?.ok) throw new Error(response?.error || 'MemTab could not connect to its local engine. Try reopening the extension.');
  return response.data;
}
function demo(type: string, payload: any): unknown {
  switch (type) {
    case 'GET_SETTINGS': return demoSettings;
    case 'SAVE_SETTINGS': demoSettings = { ...demoSettings, ...payload }; return demoSettings;
    case 'GET_STATUS': return { count: demoPages.length, bookmarks: demoPages.filter(p => p.sources.includes('bookmark')).length, captured: demoPages.length,
      embedded: 0, pending: demoPages.length, vectorBytes: 0, model: 'disabled', progress: 0, indexing: false } satisfies EngineStatus;
    case 'SEARCH_QUERY': {
      const filter = payload.filter as Filter;
      return demoPages.filter(page => (!payload.query || `${page.title} ${page.snippet} ${page.url}`.toLowerCase().includes(payload.query.toLowerCase()))
        && (filter === 'all' || filter === 'tabs' && page.isOpen || filter === 'bookmarks' && page.sources.includes('bookmark') || filter === 'history' && page.sources.includes('history')));
    }
    case 'FORGET_PAGE': demoPages = demoPages.filter(page => page.url !== payload); return true;
    case 'CLEAR_MEMORY': demoPages = []; demoSettings.indexingEnabled = false; return true;
    case 'IMPORT': throw new Error('Import is available after loading the extension in Chrome.');
    case 'ENABLE_MODEL': throw new Error('Load the extension in Chrome to download and run the local model.');
    case 'PREVIEW_WORKSPACE': throw new Error('Load the extension in Chrome to organize your real tabs.');
    case 'SYNC_TABS': return true;
    case 'OPEN_RESULT': window.open(payload.url, '_blank', 'noopener'); return true;
    case 'BENCHMARK_STATUS': return { running: false, done: 0, total: 280, phase: 'Ready', report: null, error: '' };
    case 'BENCHMARK_START': throw new Error('The benchmark runs inside the installed Chrome extension.');
    default: throw new Error('This action requires the installed extension.');
  }
}
export function openPage(path: string) {
  if (inExtension) void chrome.tabs.create({ url: chrome.runtime.getURL(path) });
  else window.open(`/${path}`, '_blank', 'noopener');
}
export async function getWindowId(): Promise<number | undefined> {
  return inExtension ? (await chrome.windows.getCurrent()).id : undefined;
}
export function domain(url: string) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } }
export function relativeTime(time: number) {
  const hours = (Date.now() - time) / 3600000;
  return hours < 1 ? 'Just now' : hours < 24 ? `${Math.floor(hours)}h ago` : hours < 48 ? 'Yesterday' : `${Math.floor(hours / 24)}d ago`;
}
export function size(bytes: number) { return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`; }
