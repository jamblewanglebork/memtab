# MemTab IEEE manuscript

Upload memtab_overleaf.zip through Overleaf's **New Project → Upload Project**, then set main.tex as the main document and use pdfLaTeX. IEEEtran and the required packages are available in Overleaf.

You can also upload **main.tex alone**. It includes an embedded BibTeX bibliography and native TikZ/PGFPlots fallbacks for both charts. The ZIP uses the generated publication figures instead.

Files:

- main.tex: complete IEEE conference manuscript with placeholder author/affiliation.
- references.bib: bibliography with DOI or official-resource identifiers.
- fig_quantization_tradeoff.pdf: full-width representation comparison.
- fig_token_compression.pdf: single-column estimated-token comparison.
- results.csv: byte-for-byte copy of the supplied root results file.
- plot_results.py: regenerates both figures, PNG previews, and verbatim metric macros.
- metrics.tex and provenance.json: generated data lineage; macros are also embedded in the manuscript.
- package_overleaf.py: synchronizes embedded bibliography and packages the upload.

Run **python paper/plot_results.py**, followed by **python paper/package_overleaf.py**, after changing the CSV or bibliography. Review interpretations whenever measurements change.

All manuscript measurement values preserve raw CSV strings. The vector-size PDF plot explicitly converts bytes to KiB; the single-file fallback uses bytes. Code constants, dataset structure, bibliographic years, and mathematical definitions are grounded in their respective sources rather than claimed as benchmark observations.

The manuscript describes the actual implementation and evidence. It does not claim zero lexical overlap, confirmed 8 GB physical RAM, a cold-download duration, provider billing savings, or end-to-end search timings. The supplied CSV records a fresh-engine initialization, single-thread WASM, a foreground Chrome user agent, and a synthetic representation comparison. The earlier headless test report in artifacts is not mixed into this paper.

The text is written for the requested six-to-seven-page IEEE format. Pagination should be checked after Overleaf compiles it; the paper has not been locally typeset. Replace the placeholder author block before sharing the manuscript.
