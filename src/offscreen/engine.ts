import { clearPages, deletePages, getPages, savePages } from './db';
import { compress, expand, similarity } from '../shared/quantization';
import { lexicalScore } from '../shared/retrieval';
import { canonicalUrl, excluded, DEFAULT_SETTINGS, type EngineStatus, type PageInput, type PageRecord, type SearchResult, type Settings, type Vector } from '../shared/types';

export type Embedder = (text: string) => Promise<Float32Array>;
export class MemoryEngine {
  pages = new Map<string, PageRecord>();
  settings: Settings = DEFAULT_SETTINGS;
  modelState: EngineStatus['model'] = 'disabled';
  progress = 0;
  error?: string;
  indexing = false;
  private generation = 0;
  private queryCache = new Map<string, Float32Array>();
  readonly ready: Promise<void>;

  constructor(private embed: Embedder) {
    this.ready = getPages().then(pages => { for (const page of pages) this.pages.set(page.url, page); });
  }
  async configure(settings: Settings) {
    await this.ready;
    this.settings = settings;
    if (!settings.semanticEnabled) this.modelState = 'disabled';
    else if (this.modelState === 'disabled') this.modelState = 'idle';
    await this.remove([...this.pages.keys()].filter(url => excluded(url, settings)));
    await this.prune();
  }
  async ingest(inputs: PageInput[]) {
    await this.ready;
    const changes: PageRecord[] = [];
    for (const input of inputs) {
      const url = canonicalUrl(input.url);
      if (!url || excluded(url, this.settings)) continue;
      const previous = this.pages.get(url);
      // Importing metadata must not replace already captured article text.
      const captured = Boolean(input.captured || previous?.captured);
      const text = (previous?.captured && !input.captured ? previous.text : input.text).slice(0, 1200);
      const title = (input.title || previous?.title || new URL(url).hostname).slice(0, 300);
      const page: PageRecord = {
        ...previous, url, title, text, snippet: text.slice(0, 1200), captured,
        sources: [...new Set([...(previous?.sources ?? []), input.source])],
        updatedAt: Math.max(previous?.updatedAt ?? 0, input.updatedAt ?? Date.now()),
      };
      this.pages.set(url, page); changes.push(page);
    }
    if (changes.length) await savePages(changes);
    await this.prune();
    return changes.length;
  }
  private async prune() {
    if (this.pages.size <= this.settings.maxPages) return;
    const ordered = [...this.pages.values()].sort((a, b) => Number(a.sources.includes('bookmark')) - Number(b.sources.includes('bookmark')) || a.updatedAt - b.updatedAt);
    await this.remove(ordered.slice(0, this.pages.size - this.settings.maxPages).map(page => page.url));
  }
  async remove(urls: string[]) {
    for (const url of urls) this.pages.delete(url);
    if (urls.length) await deletePages(urls);
  }
  async removeSource(source: 'bookmark' | 'history', urls?: string[]) {
    await this.ready;
    const selected = urls ? new Set(urls.map(canonicalUrl).filter(Boolean)) : null;
    const changes: PageRecord[] = [], deletes: string[] = [];
    for (const page of this.pages.values()) {
      if (selected && !selected.has(page.url)) continue;
      if (!page.sources.includes(source)) continue;
      const sources = page.sources.filter(s => s !== source);
      if (!sources.length) { deletes.push(page.url); continue; }
      const next: PageRecord = source === 'history'
        ? { ...page, sources, captured: false, text: `${page.title} ${page.url}`, snippet: '', vector: undefined, mode: undefined, embeddedText: undefined }
        : { ...page, sources };
      this.pages.set(page.url, next); changes.push(next);
    }
    if (changes.length) await savePages(changes);
    await this.remove(deletes);
  }
  async clear() {
    await this.ready;
    this.generation++; this.pages.clear(); this.queryCache.clear();
    await clearPages();
  }
  private needsEmbedding(page: PageRecord) {
    return !page.vector || page.mode !== this.settings.mode || page.embeddedText !== `${page.title}\n${page.text}`;
  }
  async indexPending() {
    await this.ready;
    if (this.indexing || !this.settings.semanticEnabled || !this.settings.indexingEnabled) return;
    this.indexing = true;
    const generation = this.generation;
    try {
      // A single sequential loop bounds WASM memory and lets queries run between documents.
      while (generation === this.generation && this.settings.semanticEnabled && this.settings.indexingEnabled) {
        const page = [...this.pages.values()].find(p => this.needsEmbedding(p));
        if (!page) break;
        const text = `${page.title}\n${page.text}`;
        const vector = await this.embed(text);
        if (generation !== this.generation || this.pages.get(page.url) !== page) continue;
        const next = { ...page, vector: compress(vector, this.settings.mode), mode: this.settings.mode, embeddedText: text };
        this.pages.set(page.url, next);
        await savePages([next]);
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Local indexing failed';
      this.modelState = 'error';
    } finally { this.indexing = false; }
  }
  status(): EngineStatus {
    const pages = [...this.pages.values()];
    return {
      count: pages.length, bookmarks: pages.filter(p => p.sources.includes('bookmark')).length,
      captured: pages.filter(p => p.captured).length, embedded: pages.filter(p => p.vector && !this.needsEmbedding(p)).length,
      pending: pages.filter(p => this.needsEmbedding(p)).length,
      vectorBytes: pages.reduce((sum, page) => sum + (page.vector?.byteLength ?? 0), 0),
      model: this.modelState, progress: this.progress, error: this.error, indexing: this.indexing,
    };
  }
  async search(query: string, topK = 30): Promise<SearchResult[]> {
    await this.ready;
    query = query.trim().slice(0, 300);
    let queryVector: Float32Array | undefined;
    if (query && this.settings.semanticEnabled && this.modelState === 'ready') {
      try {
        queryVector = this.queryCache.get(query) ?? await this.embed(query);
        this.queryCache.set(query, queryVector);
        if (this.queryCache.size > 32) this.queryCache.delete(this.queryCache.keys().next().value!);
      } catch (error) { this.error = error instanceof Error ? error.message : 'Search inference failed'; }
    }
    const packed = new Map<string, Vector>();
    const results: SearchResult[] = [];
    for (const page of this.pages.values()) {
      let score = lexicalScore(query, page), semantic = false;
      if (queryVector && page.vector && page.mode) {
        if (!packed.has(page.mode)) packed.set(page.mode, compress(queryVector, page.mode));
        const meaning = similarity(page.vector, packed.get(page.mode)!, page.mode);
        score = 0.85 * meaning + 0.15 * score; semantic = true;
      }
      if (query && !semantic && score === 0) continue;
      results.push({ url: page.url, title: page.title, snippet: page.snippet, sources: page.sources, score,
        semantic, captured: page.captured, updatedAt: page.updatedAt, isOpen: false });
    }
    return results.sort((a, b) => query ? b.score - a.score || b.updatedAt - a.updatedAt : b.updatedAt - a.updatedAt).slice(0, Math.max(1, Math.min(topK, 5000)));
  }
  async tabVectors(tabs: { id: number; windowId: number; url: string; title: string }[]) {
    await this.ready;
    const output = [];
    for (const tab of tabs) {
      const page = this.pages.get(canonicalUrl(tab.url) ?? '');
      // Re-embed binary records for grouping: sign reconstruction has lower clustering fidelity.
      const vector = page?.vector && page.mode !== 'binary' && !this.needsEmbedding(page)
        ? expand(page.vector, page.mode!) : await this.embed(`${tab.title}\n${page?.text || tab.url}`);
      output.push({ tabId: tab.id, windowId: tab.windowId, url: tab.url, title: tab.title, snippet: page?.snippet || tab.title, vector: Array.from(vector) });
    }
    return output;
  }
}
