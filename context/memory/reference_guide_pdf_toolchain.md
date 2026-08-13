---
name: reference-guide-pdf-toolchain
description: How to read and regenerate the GamepadOS notes PDFs in D:\AKHIL\HP\projects\gamepados\docs\notes
metadata: 
  node_type: memory
  type: reference
  originSessionId: 12d121c6-7d61-4f8f-a207-e54f4bcbb541
  modified: 2026-07-26T05:18:57.537Z
---

**Reading the notes PDFs.** `pdftoppm` is NOT installed, so the Read tool cannot render
PDF pages. Use instead:
- `pdftotext` — on PATH at `C:\Program Files\Git\mingw64\bin\pdftotext.exe`
- **PyMuPDF (`import fitz`)** — installed; best option. Extract text per page, and
  `page.get_pixmap(dpi=…).save(png)` to rasterise for visual checks.
- `pypdf` 6.13.3 also installed. `reportlab` 5.0.0 installed. **No** weasyprint, no
  `markdown`, no `pdfplumber`.

**The three PDFs** (2026-07-04/07): `GamepadOS_The_Complete_Guide.pdf` (213 pages,
70.6k words, ReportLab-generated, Parts I–V + Language Primer + War Stories),
`GamepadOS_Interdisciplinary_Analysis.pdf` (77 pages), `GamepadOS_Complete_Book.pdf`
(58 pages, WeasyPrint). **No markdown source exists for the Complete Guide** — only
`GamepadOS_Study_Plan.md` (93 KB), which is the Complete_Book's source.

**Writing new Parts:** `D:\AKHIL\HP\projects\gamepados\apps\docs\make_guide_part.py` (written 2026-07-26)
renders Markdown-with-callouts → a PDF matching the guide exactly. Usage:
`python make_guide_part.py <src.md> <out.pdf> "Running Header"`.
Source conventions: `> DEFINITION | Term — gloss`, `> NOTE |`, `> WATCH OUT |`,
`> EXPERT DETAIL |`, `> PRIMER |`, and fenced code as
```` ```lang | path · lines N-M ````. Standard md otherwise (#/##/###, bullets, tables,
`---`, **bold**, `code`).

**The guide's visual DNA** (sampled from the original, reproduced by the script):
Letter 612×792; body **Georgia** 10.3pt `#1e2530`; headings SegoeUI-Semibold; code
**Consolas** 7.1pt on `#0e1423` with a `#1b2740` header strip, line numbers `#3d4a63`,
keywords `#ff7ba6`, strings/numbers `#9ece6a`; DEFINITION teal `#0e7b92`/`#ebfafd`;
NOTE amber `#b45208`/`#fdf6ea`; page `#fafbfd`.

**Gotchas found the hard way:** ReportLab's `Paragraph` collapses leading whitespace —
convert code indentation to `&nbsp;` or all indentation is lost. Never run a
string-colouring regex over markup a keyword pass already emitted (it matches the hex
colours inside the `<font>` tags and produces nested-tag parse errors) — split the line
into string/non-string segments first. `ParagraphStyle(name, parent=…)` conflicts with
`getSampleStyleSheet()['Normal']` passed positionally; use `kw.setdefault("parent", …)`.
