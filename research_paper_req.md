You are a senior systems researcher writing a standard **IEEE Conference (`\documentclass[conference]{IEEEtran}`)** two-column paper (target venue: IEEE International Conference on Edge Computing / IEEE BigData / IEEE ICDE Systems Track) based on the **MemTab** codebase in this repository and the empirical benchmark measurements in `paper/results.csv`.

### Step 1: Grounding & Codebase Inspection
Before writing any prose, inspect:
1. `SPEC.md`, `src/offscreen/offscreen.ts`, `src/shared/quantization.ts`, `src/shared/clustering.ts`, and `src/background/service-worker.ts` so every architectural claim matches our exact implementation (Chrome Manifest V3 Offscreen Document, `Xenova/all-MiniLM-L6-v2` 8-bit quantized ONNX WASM single-threaded inference, IndexedDB in-memory linear scan, `Float32`/`Int8`/`Binary` SWAR popcount quantization, and average-linkage agglomerative clustering with top-2 medoid cloud pruning).
2. `paper/results.csv` and `src/benchmark/runner.ts` to extract the exact measured numbers, hardware/browser test environment details, and dataset parameters (240 documents across 8 categories, 40 zero-keyword-overlap queries).

### Step 2: Generate IEEE-Formatted Figures & Tables from `paper/results.csv`
Create a `paper/` directory containing:
- `paper/plot_results.py`: A Python (`matplotlib`) script using clean serif/sans-serif IEEE publication styling (300 DPI PDF/PNG, column width `3.5in` for single-column or `7.16in` for full-width figures) that reads `paper/results.csv` and generates:
  1. `fig_quantization_tradeoff.pdf`: Multi-panel chart comparing `Float32`, `Int8`, and `Binary` modes across **Index Size (KB)**, **Query Search Latency (ms)**, and **Recall@5 / MRR@10**.
  2. `fig_token_compression.pdf`: Bar chart comparing **Full-Corpus Cloud Prompt Tokens** vs. **Centroid-Pruned Cluster Tokens** (annotating the exact % token reduction and NMI clustering score).
- Run `python3 paper/plot_results.py` to generate the figures.
- Generate LaTeX `booktabs` tables following strict **IEEE caption style** (`\caption{...}` placed **above** tables in small-caps/centered format, and `\caption{...}` placed **below** figures), populated **strictly** with the exact numbers from `paper/results.csv`.

### Step 3: Write `paper/main.tex` and `paper/references.bib` (IEEEtran Format)
Write a complete, 6-to-7 page IEEE conference manuscript in `paper/main.tex` using `\documentclass[conference]{IEEEtran}` and `\bibliographystyle{IEEEtran}`:
1. **Title, Author Block & Abstract:**
   - Crisp systems title + `\IEEEauthorblockN` / `\IEEEauthorblockA` placeholder block.
   - 150–200 word `\begin{abstract}` stating the MV3 browser memory problem, the edge-cloud architecture, and exact headline metrics from `paper/results.csv`, followed immediately by `\begin{IEEEkeywords} ... \end{IEEEkeywords}`.
2. **Section I: Introduction:** Start with `\IEEEPARstart{B}{rowser}...`, motivate client-side semantic memory under Manifest V3 lifecycle and RAM constraints, and enumerate 3 concrete systems contributions.
3. **Section II: Background and Related Work:** Contrast server-side RAG pipelines, cloud-only tab organizers, and client-side WebAssembly ML (`Transformers.js`, ONNX Runtime Web, scalar/binary vector quantization).
4. **Section III: System Architecture:** Include a clean TikZ or block diagram (`\begin{figure*}`) and subsections:
   - *A. Heuristic DOM Boilerplate Pruning*
   - *B. MV3 Offscreen Document Persistence & Mutex Lifecycle*
   - *C. Sub-20 ms Quantized Vector Engine (`Float32`, `Int8`, `Binary` SWAR Popcount)*
   - *D. Local Agglomerative Clustering & Top-2 Medoid Cloud Pruning*
5. **Section IV: Experimental Methodology:** Describe the 8 GB RAM hardware environment, Chrome MV3 runtime, the 240-document / 8-topic zero-lexical-overlap benchmark, and evaluation metrics (`Recall@K`, `MRR@10`, `NMI`, P50/P95 latency, JS heap footprint, cloud token reduction).
6. **Section V: Evaluation and Ablation Results:** Present the exact IEEE tables and figures from `paper/results.csv`. Analyze the memory-vs-accuracy Pareto trade-off across `Float32`, `Int8`, and `Binary` modes, cold-start vs. warm WASM inference latency, and cloud token savings.
7. **Section VI: Limitations and Future Work:** Discuss single-threaded WASM throughput bounds, distance threshold sensitivity in agglomerative clustering, and WebGPU acceleration.
8. **Section VII: Conclusion** and **`paper/references.bib`** (using `\bibliographystyle{IEEEtran}` with real, verifiable BibTeX citations for Sentence-BERT / Reimers & Gurevych 2019, ONNX Runtime, WebAssembly, Binary/Product Quantization, and Chrome Manifest V3).

### Strict IEEE & Grounding Rules
- **Zero Hallucinated Metrics:** Every number in the text, abstract, tables, and captions must match `paper/results.csv` verbatim.
- **IEEE Formatting Compliance:** Use standard IEEE section numbering (`\section{Introduction}` -> renders as `I. INTRODUCTION`), place table captions *above* `\begin{tabular}`, place figure captions *below* `\includegraphics`, and avoid `acmart`-specific macros.
- **Systems Tone:** Concise, objective engineering prose—no marketing adjectives.