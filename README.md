# MemTab

A Manifest V3 Chrome extension that remembers visited pages, bookmarks, and browsing history. Find pages by meaning using a local MiniLM embedding model, organize open tabs into native Chrome groups, and measure the system with a built-in benchmark.

## Install in Chrome

The built extension is in **`dist/`**.

1. Open `chrome://extensions` in Chrome 116 or newer.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select this project's **`dist`** folder, not the project root.
4. Pin MemTab from Chrome's extensions menu. Its full library opens on installation.
5. Open **Settings** and import your **bookmarks** and/or **history**.
6. Click **Enable semantic search** to download the local model. Wait for loading and indexing to finish.
7. Press **Alt+K** or click the toolbar icon to search. Use arrows and Enter to open results.

If Chrome already assigns Alt+K elsewhere, set a shortcut at `chrome://extensions/shortcuts`. The library also supports Ctrl+K (Command+K on macOS) to focus search.

Pages visited after installation are captured automatically. Existing open pages are initially indexed by title and URL; refresh a page or navigate within it to capture its main text. Imported bookmarks and history also start with title and URL metadata. MemTab **does not fetch old pages in bulk**. Their full content becomes searchable after you visit them. History import covers the most recent 90 days, capped at the configured page limit.

After changing the source, run `npm run build`, then click **Reload** on MemTab at `chrome://extensions`. Refresh existing web tabs so their content scripts use the new version.

## Optional LLM API integration

Go to **Settings → Optional cloud naming**:

- **OpenAI-compatible:** enter a complete chat-completions endpoint (default `https://api.openai.com/v1/chat/completions`), a model name, and your API key. HTTPS endpoints and HTTP localhost endpoints are supported. The server must accept the chat-completions JSON format, including JSON response mode.
- **Google Gemini:** enter your key and model name (default `gemini-2.5-flash`). The Gemini REST endpoint is constructed automatically; the key is sent in the `x-goog-api-key` header.
- Turn on **Use cloud names in workspace previews** and click **Save settings**.

The API is called **only when you click Preview tab groups**, and only if cloud naming is enabled and local clustering finds related groups. It receives up to two representative snippets per cluster and the titles of the remaining clustered tabs. Page URLs and singleton/unrelated tabs are omitted. It returns short group names and a session brief. Review the preview, then click **Apply tab groups** to create native Chrome Tab Groups. Pinned tabs are skipped; closed or navigated tabs are revalidated before application.

The default organizer uses local clustering and local names without a provider. Cloud naming is optional. Keys are stored in `chrome.storage.local`, limited to trusted extension contexts; **this storage is not encrypted**. The extension has no backend.

## Run and export the benchmark

1. Open **Benchmark** from the library sidebar or popup footer.
2. Wait for background indexing to finish, or disable **Capture pages as you browse** and save settings.
3. Click **Run benchmark**. The first run can download the model if it is not cached.
4. Watch progress through 240 documents and 40 queries.
5. Inspect the results table, then click **CSV** or **JSON** to download a report.

The dataset covers eight topics with 30 documents each and five judged queries per topic. Each query has six relevant document IDs. The run uses a separate in-memory index and does not modify your saved browsing data or call a cloud API. A benchmark can continue if you close its UI; reopen the page to see progress. Export before the offscreen engine closes, because reports are held in that engine's memory.

Measurements include:

- Model initialization and whether the model was already loaded in this engine.
- Mean/P50/P95 document inference and query inference latency.
- Observed JS heap samples, when Chrome exposes `performance.memory`.
- Packed-vector bytes, scan P50/P95, judged Recall@1/5/10, Hit@1/5, and MRR@10 for Float32, Int8, and Binary.
- Average-linkage clustering time and NMI against topic labels.
- Estimated full versus representative-only prompt tokens, using `ceil(characters / 4)`.

**Interpretation:** query embedding is separate from vector scan time. A sub-15ms scan does not imply sub-15ms end-to-end semantic search. JS heap is not total process RAM and can omit WASM/native allocations. Vector storage excludes metadata and model weights. Recall@1 is at most 1/6 (16.7%) on this six-relevant-document dataset; Hit@1 is the fraction of queries with a relevant first result. Token savings are estimates, not billed provider tokens. The synthetic workload is exploratory, not a validated measure of real browsing quality. No latency, RAM, recall, or token-reduction target is hard-coded as a result.

A download-cold run requires clearing the extension's model cache in DevTools **Application → Cache Storage** and restarting the offscreen engine or reloading the extension. This intentionally triggers another download. A newly initialized engine can still use cached files, so the report does not label every initialization a cold download.

## Development and checks

Requires Node.js 22+ and npm. No Python or server is needed to run the extension. Generated icons and the dataset are checked into the source tree.

```powershell
npm install
$env:NODE_OPTIONS = '--max-old-space-size=3072'
npm run build
npm test
```

`npm run dev` opens a Vite preview at `http://127.0.0.1:5173`. It shows explicitly labeled sample data for UI development; Chrome APIs and semantic inference require the installed extension.

```powershell
npm run test:browser
npm run test:model
```

Browser checks launch an isolated **headless** Chrome profile under `.test-profile/`, serve local test pages, and test real extension capture, imports, search, privacy boundaries, and UI. `test:model` also downloads MiniLM, verifies actual semantic inference and offline search, tests tab grouping against a local mock provider, runs the complete benchmark, and tests CSV export. The test loader uses Chrome's browser-level extension debugging API; a recent Chrome supporting `Extensions.loadUnpacked` is required for this automated check. The default Chrome path is `C:\Program Files\Google\Chrome\Application\chrome.exe`; override it with `$env:CHROME_PATH`. Screenshots and exported reports go in `artifacts/`. No existing Chrome profile is modified.

`npm run typecheck` checks TypeScript. Regenerate source assets with `node scripts/create-dataset.mjs` and (optionally) `python scripts/create-icons.py`.

## Architecture and deliberate spec changes

```text
Webpage extractor ──→ MV3 service worker ──→ offscreen document
                         │                    │
                         │                    ├─ single-thread local ONNX embeddings
                         │                    └─ IndexedDB + compressed vector scan
                         │
                         ├─ bookmarks/history import and live tab state
                         ├─ local clustering → optional cloud naming → preview → Chrome groups
                         └─ popup, library, settings, benchmark message routing
```

- React 19 + TypeScript + Vite 6, with native CSS. Transformers.js 4.3.2, `Xenova/all-MiniLM-L6-v2`, q8, WASM, one thread.
- Runtime JavaScript and WASM are bundled locally. The ONNX module factory is imported directly rather than through a blob cache to comply with MV3 CSP. No external executable scripts are loaded. Model weights/tokenizer data come from Hugging Face and are browser-cached.
- Only the selected vector representation is persisted: Float32 **1,536 bytes**, Int8 **384 bytes**, or Binary **48 bytes** per 384-dimensional vector. Storing all three would negate the compressed-storage goal. Precision changes re-embed saved text in a bounded sequential queue.
- The default cap is 5,000 pages, configurable from 100 to 20,000. Eviction prioritizes bookmarks over older history. Metadata, snippets, and embedded-text signatures consume additional memory; the entire extension is not claimed to fit in 2 MB.
- Canonical HTTP(S) URLs deduplicate records and strip fragments. Open/closed state is derived from Chrome at query time, avoiding stale stored tab IDs across restarts. Multiple tabs for the same URL share one memory.
- The queue is reconstructed from IndexedDB after the offscreen document restarts. Offscreen documents are not treated as guaranteed to live forever. A five-minute alarm resumes pending work.
- Search combines semantic similarity and lexical relevance when the model is ready. Keyword search remains available during setup or model-loading failures. Inference and indexing share a sequential queue; query embeddings are cached within the engine.
- Content extraction excludes navigation, footer, forms, inputs, editable areas, scripts, and common boilerplate. It is a heuristic, capped at 1,200 characters, not a full article archiver. SPAs are observed for DOM and URL changes.
- Bookmark creation/change/removal and Chrome history deletion synchronize into the local index. A per-page **Forget** action removes its MemTab record; revisiting or explicitly re-importing it can restore it.
- Browser-restricted pages (e.g. `chrome://`, the Chrome Web Store), local files, credentials in URLs, and incognito tabs are not captured. The extension declares `incognito: not_allowed`.
- Excluded domains include subdomains and remove existing matching memories on save. **Clear memory** pauses capture and deletes MemTab pages/vectors while preserving Chrome bookmarks/history and cached model files.

## Permission purposes

`tabs` reads current titles/URLs and focuses results; `tabGroups` creates groups; `storage` stores settings and pending previews; `offscreen` hosts the local engine; `scripting` captures already-open tabs on navigation; `bookmarks` and `history` support imports and deletion synchronization; `alarms` resumes indexing. HTTP(S) host access supports passive webpage capture, model-file downloads, and user-configured API endpoints. Content scripts can only submit their own top-level page and cannot read settings/API keys or run administrative commands.

