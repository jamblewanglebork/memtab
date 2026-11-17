export type QuantizationMode = 'float32' | 'int8' | 'binary';
export type Source = 'history' | 'bookmark' | 'tab';
export type Vector = Float32Array | Int8Array | Uint32Array;

export interface PageRecord {
  url: string;
  title: string;
  text: string;
  snippet: string;
  sources: Source[];
  updatedAt: number;
  captured: boolean;
  vector?: Vector;
  mode?: QuantizationMode;
  embeddedText?: string;
}
export interface PageInput {
  url: string;
  title: string;
  text: string;
  source: Source;
  captured?: boolean;
  updatedAt?: number;
}
export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  sources: Source[];
  score: number;
  semantic: boolean;
  captured: boolean;
  updatedAt: number;
  isOpen: boolean;
  tabId?: number;
  windowId?: number;
}
export interface Settings {
  indexingEnabled: boolean;
  semanticEnabled: boolean;
  mode: QuantizationMode;
  excludedHosts: string[];
  maxPages: number;
  cloudEnabled: boolean;
  provider: 'openai' | 'gemini';
  endpoint: string;
  model: string;
  apiKey: string;
}
export const DEFAULT_SETTINGS: Settings = {
  indexingEnabled: true,
  semanticEnabled: false,
  mode: 'int8',
  excludedHosts: [],
  maxPages: 5000,
  cloudEnabled: false,
  provider: 'openai',
  endpoint: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4o-mini',
  apiKey: '',
};
export interface EngineStatus {
  count: number;
  bookmarks: number;
  captured: number;
  embedded: number;
  pending: number;
  vectorBytes: number;
  model: 'disabled' | 'idle' | 'loading' | 'ready' | 'error';
  progress: number;
  error?: string;
  indexing: boolean;
}
export interface TabVector {
  tabId: number;
  windowId: number;
  url: string;
  title: string;
  snippet: string;
  vector: number[];
}
export interface GroupPlan {
  id: number;
  title: string;
  color: chrome.tabGroups.ColorEnum;
  tabs: TabVector[];
  representatives: TabVector[];
}
export interface WorkspacePlan {
  groups: GroupPlan[];
  ungrouped: number;
  summary: string;
  cloudUsed: boolean;
  tokenReduction: number;
  inputTokens: number;
  prunedTokens: number;
}
export type Filter = 'all' | 'tabs' | 'bookmarks' | 'history';
export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };
export type Message = { target?: 'background' | 'offscreen'; type: string; payload?: any };

export function canonicalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}
export function excluded(url: string, settings: Settings): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return settings.excludedHosts.some(host => hostname === host || hostname.endsWith(`.${host}`));
  } catch { return true; }
}
