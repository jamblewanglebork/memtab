"""Generate IEEE figures and exact-value LaTeX macros from the supplied CSV.

Run from any directory: python paper/plot_results.py
No benchmark is rerun. Numerical LaTeX macros preserve unchanged CSV strings.
"""
from __future__ import annotations
import csv
import hashlib
import json
import re
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "results.csv"
MODES = ("float32", "int8", "binary")
LABELS = ("Float32", "Int8", "Binary")
COLORS = ("#4477AA", "#228833", "#CCBB44")
FIELDS = {
    "mDocuments": ("environment", "documents", ""),
    "mQueries": ("environment", "queries", ""),
    "mDimensions": ("environment", "dimensions", ""),
    "mConcurrency": ("environment", "hardware_concurrency", ""),
    "mInitialization": ("model", "initialization", ""),
    "mDocMean": ("document_inference", "meanMs", ""),
    "mDocMedian": ("document_inference", "p50Ms", ""),
    "mDocTail": ("document_inference", "p95Ms", ""),
    "mQueryMean": ("query_inference", "meanMs", ""),
    "mQueryMedian": ("query_inference", "p50Ms", ""),
    "mQueryTail": ("query_inference", "p95Ms", ""),
    "mInitialHeap": ("memory", "initial_js_heap", ""),
    "mPeakHeap": ("memory", "peak_observed_js_heap", ""),
    "mThreshold": ("clustering", "threshold", ""),
    "mClusters": ("clustering", "groups", ""),
    "mNMI": ("clustering", "nmi", ""),
    "mClusteringTime": ("clustering", "latencyMs", ""),
    "mFullTokens": ("tokens", "full", ""),
    "mPrunedTokens": ("tokens", "pruned", ""),
    "mTokenReduction": ("tokens", "reductionPercent", ""),
}
for mode, prefix in zip(MODES, ("Float", "Int", "Binary")):
    for suffix, metric in {
        "Bytes": "vectorBytes", "ScanMean": "scanMeanMs", "ScanMedian": "scanP50Ms",
        "ScanTail": "scanP95Ms", "RecallOne": "recallAt1", "RecallFive": "recallAt5",
        "RecallTen": "recallAt10", "HitOne": "hitAt1", "HitFive": "hitAt5", "MRR": "mrrAt10",
    }.items():
        FIELDS[f"m{prefix}{suffix}"] = ("retrieval", metric, mode)

def load():
    with SOURCE.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    values = {}
    for row in rows:
        key = (row["section"], row["metric"], row["mode"])
        if row["section"] != "notes" and key in values:
            raise ValueError(f"Duplicate metric: {key}")
        values[key] = row["value"]
    for key in FIELDS.values():
        if key not in values:
            raise ValueError(f"Missing metric: {key}")
        float(values[key])
    return values

def save(figure, stem):
    figure.savefig(HERE / f"{stem}.pdf", dpi=300)
    figure.savefig(HERE / f"{stem}.png", dpi=300)
    plt.close(figure)

def figures(values):
    plt.rcParams.update({
        "font.family": "serif", "font.serif": ["DejaVu Serif"],
        "font.size": 8, "axes.labelsize": 8, "axes.titlesize": 8,
        "xtick.labelsize": 8, "ytick.labelsize": 7, "legend.fontsize": 7,
        "axes.linewidth": .6, "lines.linewidth": 1, "pdf.fonttype": 42,
        "ps.fonttype": 42, "savefig.dpi": 300,
    })
    x = np.arange(3)
    figure, axes = plt.subplots(2, 2, figsize=(7.16, 3.75), layout="constrained")
    specs = [
        ("vectorBytes", "(a) Packed vector storage", "KiB", 1024),
        ("scanP50Ms", "(b) Warm vector scan and sort", "Latency (ms)", 1),
        ("recallAt5", "(c) Judged Recall@5", "Recall@5 (ratio)", 1),
        ("mrrAt10", "(d) Reciprocal-rank quality", "MRR@10 (ratio)", 1),
    ]
    for axis, (metric, title, ylabel, divisor) in zip(axes.flat, specs):
        data = [float(values[("retrieval", metric, mode)]) / divisor for mode in MODES]
        axis.bar(x, data, width=.55, color=COLORS, edgecolor="black", linewidth=.4, zorder=3)
        axis.set_xticks(x, LABELS)
        axis.set_ylabel(ylabel)
        axis.set_title(title, loc="left", pad=7)
        axis.spines[["top", "right"]].set_visible(False)
        axis.grid(axis="y", color="#dddddd", linewidth=.5, zorder=0)
        axis.set_axisbelow(True)
        if metric in ("recallAt5", "mrrAt10"):
            axis.set_ylim(0, 1)
        elif metric == "scanP50Ms":
            tails = [float(values[("retrieval", "scanP95Ms", mode)]) for mode in MODES]
            axis.plot(x, tails, "kD", markersize=3.5, label="P95", zorder=4)
            axis.set_ylim(0, max(tails) * 1.2)
            axis.legend(loc="upper right", frameon=False)
            axis.text(.01, .97, "Bars: P50", transform=axis.transAxes, va="top", fontsize=7)
        else:
            axis.set_ylim(0, max(data) * 1.24)
            for index, value in enumerate(data):
                raw = values[("retrieval", "vectorBytes", MODES[index])]
                axis.text(index, value + max(data) * .035, f"{raw} B", ha="center", fontsize=7)
    save(figure, "fig_quantization_tradeoff")
    figure, axis = plt.subplots(figsize=(3.5, 2.6), layout="constrained")
    full = int(values[("tokens", "full", "")])
    pruned = int(values[("tokens", "pruned", "")])
    axis.bar([0, 1], [full, pruned], color=[COLORS[0], COLORS[1]], width=.5,
             edgecolor="black", linewidth=.4, zorder=3)
    axis.set_xticks([0, 1], ["Full-corpus\npayload", "Centroid-pruned\npayload"])
    axis.set_ylabel("Estimated prompt tokens")
    axis.spines[["top", "right"]].set_visible(False)
    axis.grid(axis="y", color="#dddddd", linewidth=.5, zorder=0)
    axis.set_axisbelow(True)
    axis.set_ylim(0, full * 1.23)
    for index, value in enumerate([full, pruned]):
        axis.text(index, value + full * .03, str(value), ha="center", fontsize=8)
    axis.set_title(
        f"Reduction: {values[('tokens', 'reductionPercent', '')]}%\n"
        f"NMI: {values[('clustering', 'nmi', '')]}", fontsize=7.5, loc="left", pad=10,
    )
    save(figure, "fig_token_compression")

def macros(values):
    commands = [f"\\newcommand{{\\{name}}}{{{values[key]}}}" for name, key in FIELDS.items()]
    text = "\n".join(commands)
    (HERE / "metrics.tex").write_text("% Generated verbatim from results.csv.\n" + text + "\n", encoding="utf-8")
    main = HERE / "main.tex"
    if main.exists():
        source = main.read_text(encoding="utf-8")
        source, count = re.subn(
            r"(?s)% BEGIN CSV METRICS\n.*?% END CSV METRICS",
            lambda _: "% BEGIN CSV METRICS\n" + text + "\n% END CSV METRICS", source,
        )
        if count != 1:
            raise ValueError("main.tex must have exactly one generated metric block")
        main.write_text(source, encoding="utf-8")
    provenance = {
        "source": "results.csv", "sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        "timestamp": values[("environment", "timestamp", "")],
        "modelAlreadyLoaded": values[("model", "already_loaded", "")],
        "userAgent": values[("environment", "user_agent", "")],
        "rawMetricMacros": {name: {"key": list(key), "value": values[key]} for name, key in FIELDS.items()},
        "figureConversions": {"storage": "bytes / 1024, axis labeled KiB", "latencies": "ms unchanged", "quality": "ratios unchanged"},
        "physicalRAM": "not recorded in the supplied CSV",
        "cpuModel": "not recorded in the supplied CSV",
        "coldDownloadCacheState": "not recorded in the supplied CSV",
    }
    (HERE / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")

if __name__ == "__main__":
    values = load()
    macros(values)
    figures(values)
    print("Generated both PDF/PNG figures, exact LaTeX metrics, and provenance.json from results.csv.")
