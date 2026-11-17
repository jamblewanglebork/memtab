# SPEC.md — MemTab: Edge-Cloud Semantic Tab & History Manager

## 1. Product & Research Objective
**MemTab** is a Chrome Extension (Manifest V3) that provides local-first semantic search and automated workspace organization for browser tabs and history, designed to run on low-RAM (8 GB) laptops while serving as a reproducible **Edge-Cloud Web Systems** benchmark.

### Core User Workflow
1. **Passive Local Indexing:** When a webpage finishes loading, a lightweight content script prunes navigation/ads and sends the clean text to a persistent MV3 Offscreen Document. The Offscreen Document embeds the text locally using `Xenova/all-MiniLM-L6-v2` (quantized 8-bit ONNX WASM) and stores quantized vectors in `IndexedDB`.
2. **Instant Semantic Search (`Alt+K`):** Pressing `Alt+K` opens a keyboard-first Command Palette that searches all indexed open and closed tabs by meaning in **under 20 ms** (zero network calls).
3. **One-Click Smart Tab Grouping & Session Briefs:** Clicking **"Organize Workspace"** clusters open tabs locally via agglomerative cosine clustering, selects only the **top-2 medoid snippets per cluster** (cutting cloud token payloads by >85%), calls a user-configured Cloud LLM API (Gemini or OpenAI-compatible) for concise 2-to-3 word group names, and organizes open tabs into native Chrome Tab Groups (`chrome.tabGroups`).
4. **Built-In Systems Benchmark (`/benchmark.html`):** A self-contained evaluation dashboard that replays a synthetic 240-page multi-topic browsing trace inside Chrome's MV3 runtime and exports JSON/CSV metrics (cold/warm latency, peak JS heap RAM, Recall@10 across `float32`/`int8`/`binary` quantization, NMI clustering accuracy, and cloud token reduction).

---

## 2. Tech Stack & 8 GB RAM Constraints
- **Language & Bundler:** TypeScript 5+, Vite 6+, React 19, Tailwind CSS.
- **ML Runtime:** `@huggingface/transformers` (`^4.0.0`) using `Xenova/all-MiniLM-L6-v2` (`dtype: 'q8'`, `device: 'wasm'`).
- **Low-RAM Build & Runtime Rules:**
  - Set `build.sourcemap = false` in `vite.config.ts` to prevent Vite OOM crashes during bundling.
  - Set `env.backends.onnx.wasm.numThreads = 1` in `offscreen.ts` to prevent multi-worker WASM memory duplication.
  - Copy `.wasm` runtime binaries from `node_modules/@huggingface/transformers/dist/` (or `onnxruntime-web/dist/`) into `dist/assets/` via `vite-plugin-static-copy` and point `env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('assets/')` so the extension complies strictly with Manifest V3 CSP (`'wasm-unsafe-eval'`, zero external CDN script fetches).

---

## 3. Repository Structure

```text
memtab-extension/
├── public/
│   ├── manifest.json                 # Chrome Manifest V3 configuration
│   └── icons/                        # icon16.png, icon48.png, icon128.png
├── src/
│   ├── shared/
│   │   ├── types.ts                  # Typed message bus contracts & data models
│   │   ├── quantization.ts           # Float32, Int8, and Binary bit-packing + similarity search
│   │   └── clustering.ts             # Agglomerative cosine clustering, medoid selection, NMI metric
│   ├── content/
│   │   └── extractor.ts              # Heuristic DOM boilerplate pruner
│   ├── offscreen/
│   │   ├── offscreen.html            # Hidden MV3 document hosting ONNX runtime
│   │   ├── offscreen.ts              # Transformers.js singleton + IndexedDB vector search
│   │   └── db.ts                     # IndexedDB wrapper (pages, vectors, settings)
│   ├── background/
│   │   └── service-worker.ts         # MV3 coordinator, offscreen lifecycle, TabGroups, LLM API
│   ├── popup/
│   │   ├── popup.html                # Command Palette entry (Alt+K)
│   │   ├── main.tsx                  # React root
│   │   ├── App.tsx                   # Semantic search UI + Workspace Organizer trigger
│   │   └── Settings.tsx              # API key/provider config + quantization mode switcher
│   └── benchmark/
│       ├── benchmark.html            # Systems evaluation dashboard entry
│       ├── synthetic_dataset.json    # 240 labeled web documents (8 topics x 30 docs) + 40 queries
│       └── runner.ts                 # Automated latency, heap RAM, Recall@K, NMI, & token benchmark
├── vite.config.ts                    # Multi-entry MV3 Vite configuration
├── tsconfig.json
└── package.json
```

---

## 4. Detailed Module Specifications

### 4.1 `public/manifest.json`
```json
{
  "manifest_version": 3,
  "name": "MemTab — Semantic Tab & History Memory",
  "version": "1.0.0",
  "description": "Local-first semantic tab search and token-pruned AI workspace grouping.",
  "permissions": [
    "tabs",
    "tabGroups",
    "storage",
    "offscreen",
    "scripting"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_popup": "popup.html",
    "default_title": "MemTab Semantic Search (Alt+K)"
  },
  "commands": {
    "_execute_action": {
      "suggested_key": {
        "default": "Alt+K",
        "mac": "MacCtrl+K"
      },
      "description": "Open MemTab Command Palette"
    }
  },
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["extractor.js"],
      "run_at": "document_idle"
    }
  ],
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
  }
}
```

### 4.2 `src/shared/types.ts`
Define strict TypeScript interfaces for all extension messaging and storage:
- `QuantizationMode = 'float32' | 'int8' | 'binary'`
- `PageRecord`: `{ url: string; title: string; snippet: string; tabId?: number; isOpen: boolean; updatedAt: number; float32: number[]; int8: number[]; binary: number[] }`
- `SearchResult`: `{ url: string; title: string; snippet: string; score: number; isOpen: boolean; tabId?: number; updatedAt: number }`
- `RuntimeMessage` union type:
  - `{ type: 'INGEST_PAGE'; payload: { url: string; title: string; text: string; tabId?: number } }`
  - `{ type: 'SEARCH_QUERY'; payload: { query: string; topK: number; mode: QuantizationMode } }`
  - `{ type: 'EMBED_BATCH'; payload: { texts: string[] } }`
  - `{ type: 'GET_OPEN_TAB_VECTORS'; payload: { tabIds: number[] } }`
  - `{ type: 'ORGANIZE_TABS' }`

### 4.3 `src/shared/quantization.ts`
Implement deterministic vector compression and similarity functions for 384-dimensional unit-normalized vectors:
1. **`quantizeInt8(vec: Float32Array): Int8Array`**: Clamp each element to `[-1, 1]` and map `Math.round(val * 127)`. Storage: **384 bytes/doc**.
2. **`cosineInt8(a: Int8Array, b: Int8Array): number`**: Compute dot product divided by `(norm(a) * norm(b))`.
3. **`quantizeBinary(vec: Float32Array): Uint32Array`**: Pack 384 sign bits (`vec[i] >= 0 ? 1 : 0`) into a `Uint32Array(12)`. Storage: **48 bytes/doc** (32x compression vs Float32).
4. **`hammingSimilarity(a: Uint32Array, b: Uint32Array): number`**: Compute `1 - (hammingDistance(a, b) / 384)` using 32-bit SWAR popcount on `a[i] ^ b[i]`.

### 4.4 `src/content/extractor.ts`
- Debounce execution by **1,500 ms** after `document_idle` so Single-Page Apps (React/Next.js) finish hydrating.
- Clone `document.body`, remove `<script>, <style>, <noscript>, <nav>, <footer>, <aside>, [role="banner"], [role="navigation"], [aria-hidden="true"]`.
- Extract `document.title`, concatenated `h1, h2, h3` text (up to 300 chars), and main content text (`<main>` or `<article>` fallback to `body.innerText`), collapse whitespace, and truncate to **1,200 characters**.
- Dispatch `{ type: 'INGEST_PAGE', payload }` via `chrome.runtime.sendMessage`.

### 4.5 `src/offscreen/offscreen.ts` & `src/offscreen/db.ts`
- **Singleton Pipeline (`Xenova/all-MiniLM-L6-v2`):**
  ```ts
  import { pipeline, env } from '@huggingface/transformers';
  env.allowLocalModels = false;
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('assets/');
  ```
- Load with `pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8', device: 'wasm' })`.
- Run inference with `{ pooling: 'mean', normalize: true }`.
- **IndexedDB (`memtab_db`):** Maintain an in-memory `Map<string, PageRecord>` synced with IndexedDB (`idb`) on startup so semantic search across 2,000+ pages executes via an in-memory linear scan in **< 15 ms**.

### 4.6 `src/background/service-worker.ts` & `src/shared/clustering.ts`
- **Offscreen Lifecycle Guard:** Before forwarding any embedding/search message, check `chrome.offscreen.hasDocument()` (or `chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })`). If absent, call `chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['WORKERS'], justification: 'Run persistent local ONNX embeddings' })` using a mutex lock to prevent duplicate creation race conditions.
- **Tab Lifecycle Sync:** Listen to `chrome.tabs.onRemoved` and `chrome.tabs.onUpdated` to update `isOpen` and `tabId` flags in IndexedDB.
- **Centroid-Pruned Workspace Grouping (`ORGANIZE_TABS`):**
  1. Query all open tabs via `chrome.tabs.query({ currentWindow: true })`.
  2. Fetch their `Float32` embeddings from the Offscreen Document (for any tab missing an embedding, ingest its `title + url` on the fly).
  3. Run **Average-Linkage Agglomerative Clustering** (`cosineDistanceThreshold = 0.45`).
  4. For each cluster with $\ge 2$ tabs, compute the normalized centroid vector and select the **top-2 medoid tabs** (highest cosine similarity to centroid) plus the titles of remaining tabs in that cluster.
  5. Send a single JSON prompt to the configured Cloud LLM API (supports **Google Gemini REST API** `generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent` and **OpenAI-compatible** `/v1/chat/completions`) requesting `{ "groups": [{ "clusterId": number, "title": "2-3 Word Label", "color": "blue|red|yellow|green|pink|purple|cyan|orange" }] }`.
  6. Call `chrome.tabs.group({ tabIds })` and `chrome.tabGroups.update(groupId, { title, color })` for each returned group.

### 4.7 `src/popup/App.tsx` (Command Palette UI)
- Auto-focused search input on open (`Alt+K`).
- Debounced (50 ms) live semantic search showing:
  - Page title, domain badge, cosine similarity score (`%`), and status badge (`OPEN TAB` vs `HISTORY`).
  - Pressing `Enter` or clicking an `OPEN TAB` result switches focus to that tab (`chrome.tabs.update(tabId, { active: true })`); clicking a `HISTORY` result opens the URL in a new tab.
- Top action bar with:
  - **"Organize Open Tabs"** button (triggers local clustering + centroid-pruned LLM grouping).
  - **"Benchmark"** link (opens `chrome.runtime.getURL('benchmark.html')` in a new tab).
  - **Settings gear** (`Settings.tsx`) to save LLM Provider (`Gemini` / `OpenAI`), API Key, and Quantization Mode (`float32` / `int8` / `binary`) in `chrome.storage.local`.

### 4.8 `src/benchmark/runner.ts` & `synthetic_dataset.json`
- **`synthetic_dataset.json`:** Include 240 realistic web page title+snippet records distributed evenly across **8 ground-truth categories** (30 docs each: `Systems_C_CPP`, `ML_Quantization`, `Web_Architecture`, `Personal_Finance`, `Cooking_Nutrition`, `Motorsport_Engineering`, `Cloud_DevOps`, `Linear_Algebra`) plus **40 semantic search queries** (5 per category) phrased without exact keyword overlap to test true semantic retrieval.
- **`runner.ts` Execution Flow (triggered from `benchmark.html`):**
  1. Measure **Cold-Start Model Load Time (ms)**.
  2. Embed all 240 documents and log **Mean / P50 / P95 Single-Doc Inference Latency (ms)** and **Peak JS Heap (`performance.memory.usedJSHeapSize` in MB)**.
  3. Run all 40 test queries across `float32`, `int8`, and `binary` modes, computing **Index Size (KB)**, **Query Search Latency (ms)**, **Recall@1**, **Recall@5**, and **MRR@10**.
  4. Run local agglomerative clustering on the 240 documents and compute **Normalized Mutual Information (NMI)** against the 8 ground-truth labels, alongside **Token Reduction (%)** comparing full-corpus prompt tokens vs. centroid-pruned cluster tokens (`Math.ceil(chars / 4)`).
  5. Display results in a clean HTML table and provide a **"Download JSON / CSV Report"** button for direct inclusion in a research paper.

---

## 5. Build & Verification Checklist for Agent
1. Create `package.json` with exact dependencies:
   - `dependencies`: `react`, `react-dom`, `@huggingface/transformers`, `idb`, `lucide-react`
   - `devDependencies`: `@types/chrome`, `@types/react`, `@types/react-dom`, `autoprefixer`, `postcss`, `tailwindcss`, `typescript`, `vite`, `vite-plugin-static-copy`
2. Configure `vite.config.ts` so:
   - `popup.html`, `offscreen.html`, and `benchmark.html` are built as HTML entry points, and `src/background/service-worker.ts` -> `background.js` and `src/content/extractor.ts` -> `extractor.js` emit at the root of `dist/` with no hashed filenames.
   - `viteStaticCopy` copies `node_modules/@huggingface/transformers/dist/*.wasm` (and `*.mjs` worker helpers if present) into `dist/assets/`.
   - `build.sourcemap` is set to `false` to keep bundler peak memory under 1.5 GB.
3. Run `npm install` and `NODE_OPTIONS="--max-old-space-size=3072" npm run build` and verify that `dist/` compiles cleanly with zero TypeScript or Rollup errors.