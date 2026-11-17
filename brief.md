# Project Brief: What We Are Building & Why

## 1. The Core Problem
Browser users regularly accumulate 50+ open tabs and thousands of history entries. Native browser search (`Ctrl+F` / `Ctrl+H`) only matches exact keywords in page titles or URLs—so if you forget the exact wording of an article you read three days ago, it is effectively lost. Meanwhile, sending 50 full web pages to a cloud LLM API to organize them is slow, expensive, and leaks private browsing data.

## 2. What MemTab Does (User Experience)
**MemTab** is a lightweight Chrome Extension (Manifest V3) that acts as a local-first semantic memory for your browser:
1. **Passive Background Indexing:** Whenever you visit or read a webpage, MemTab quietly extracts the core text (ignoring ads/navbars), converts it into a compact mathematical vector (embedding) *directly inside your browser*, and saves it locally in IndexedDB.
2. **Instant Semantic Search (`Alt+K`):** Pressing `Alt+K` opens a fast Command Palette. You can search by *concept* rather than exact keywords (e.g., typing *"that guide on fixing memory leaks in C"* instantly finds a closed tab titled *"Valgrind Memcheck Quickstart"*).
3. **One-Click Smart Tab Grouping & Session Briefs:** When your browser gets cluttered, clicking **"Organize Workspace"** groups your open tabs by topic using local vector clustering, asks a Cloud LLM API to generate short 2-word group names and a session summary, and automatically sorts your tabs into native Chrome Tab Groups (`chrome.tabGroups`).

## 3. How the Edge-Cloud Architecture Works (And Why)
To run smoothly on low-RAM (8GB) laptops without backend servers while remaining publishable as a **Web/Edge-Cloud Systems** architecture:
- **Edge (In-Browser ONNX Runtime):** Runs a quantized 8-bit `all-MiniLM-L6-v2` model (~23 MB) via `@huggingface/transformers` inside a Chrome MV3 **Offscreen Document** (which avoids MV3 Service Worker idle-termination bugs and supports WebAssembly cleanly).
- **Compressed Vector Storage (IndexedDB):** Stores embeddings in selectable precision modes (`Float32`, `Int8`, and 32x-compressed `Binary` bit-vectors) so thousands of pages take less than 2 MB of RAM and search in under 15ms.
- **Token-Pruned Cloud Offloading:** Instead of sending 50 full pages to the Cloud LLM API, MemTab clusters tabs locally first and sends *only* the top-2 representative centroid snippets per cluster—cutting cloud API token usage by >85% and keeping unrelated tabs private.
- **Built-In Systems Benchmark (`/benchmark.html`):** Includes a self-contained evaluation page that replays a synthetic 240-page multi-topic browsing trace to measure cold/warm latency, peak JS heap RAM, Recall@10 across quantization modes, and token savings.