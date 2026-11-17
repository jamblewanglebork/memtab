"""Embed the bibliography and create a direct Overleaf upload."""
from pathlib import Path
import re
import zipfile

HERE = Path(__file__).resolve().parent
main = HERE / "main.tex"
text = main.read_text(encoding="utf-8")
bib = (HERE / "references.bib").read_text(encoding="utf-8").rstrip()
block = (
    "% BEGIN EMBEDDED BIBLIOGRAPHY\n"
    "\\begin{filecontents*}{references.bib}\n"
    + bib + "\n\\end{filecontents*}\n"
    "% END EMBEDDED BIBLIOGRAPHY"
)
text, count = re.subn(
    r"(?s)% BEGIN EMBEDDED BIBLIOGRAPHY\n.*?% END EMBEDDED BIBLIOGRAPHY",
    lambda _: block, text,
)
if count != 1:
    raise ValueError("Expected exactly one bibliography block")
main.write_text(text, encoding="utf-8")
files = [
    "main.tex", "references.bib", "fig_quantization_tradeoff.pdf",
    "fig_token_compression.pdf", "results.csv", "plot_results.py",
    "metrics.tex", "provenance.json", "README.md", "package_overleaf.py",
]
with zipfile.ZipFile(HERE / "memtab_overleaf.zip", "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(HERE / name, arcname=name)
print("Created paper/memtab_overleaf.zip; main.tex also works as a single-file upload.")
