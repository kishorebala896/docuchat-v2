"""Parser A/B eval: classic PyMuPDF chunks vs PyMuPDF Layout chunks.

The fair-fight rules:
    VARIED:   the parser only (block extraction + chunking strategy)
    CONSTANT: embedding model, vector DB, top-k, BM25, RRF, LLM,
              temperature, judge, eval questions

Usage (diagnostics A/B -- fully offline, no API keys):
    python -m backend.eval_parsers --docs ./pdfs

Usage (full A/B with retrieval + generation):
    python -m backend.eval_parsers --docs ./pdfs --evals parser_evals.jsonl \\
        --models gpt4o-mini --judge gpt4o-mini
    # full mode indexes each parser's chunks into temp collections and runs
    # backend.eval_harness.run_case per case; see _real_evaluate_fn().

LayoutParser is a thin adapter over pymupdf4llm.to_json() (verified against
pymupdf4llm 1.28.2): boxes carry boxclass ('section-header'|'text'|'table'|
'page-footer'|...), header_level for headings, and table.markdown for tables.
All chunking intelligence lives in semantic_chunk(), which is pure and tested.
"""
import argparse
import glob
import json
import os
from dataclasses import dataclass, field


# ------------------------------------------------------------------ blocks
@dataclass
class Block:
    text: str
    page: int
    block_type: str          # heading|paragraph|table|figure|header|footer
    level: int = 0           # heading level (1, 2, ...)
    table_id: str | None = None
    bbox: tuple | None = None


@dataclass
class Chunk:
    text: str
    page: int
    block_type: str          # table|paragraph|mixed
    heading_path: str = ""
    table_id: str | None = None


def _tokens(text: str) -> int:
    return int(len(text.split()) * 1.3)


def _box_text(box: dict) -> str:
    parts = []
    for tl in box.get("textlines") or []:
        if isinstance(tl, str):
            parts.append(tl)
            continue
        for sp in tl.get("spans") or []:
            t = sp.get("text", "")
            if t:
                parts.append(t)
        # some versions put text directly on the textline
        if tl.get("text"):
            parts.append(tl["text"])
    return " ".join(parts).strip()


BOXCLASS_MAP = {
    "section-header": "heading",
    "title": "heading",
    "text": "paragraph",
    "paragraph": "paragraph",
    "table": "table",
    "figure": "figure",
    "image": "figure",
    "page-header": "header",
    "page-footer": "footer",
    "list": "paragraph",
}


class LayoutParser:
    """Typed blocks via pymupdf4llm (PyMuPDF Layout). Requires: pip install pymupdf4llm."""

    name = "layout"

    def parse(self, pdf_bytes: bytes) -> list[Block]:
        try:
            import pymupdf4llm
        except ImportError as e:
            raise RuntimeError("pip install pymupdf4llm  (LayoutParser needs it)") from e
        try:
            import pymupdf
        except ImportError:
            import fitz as pymupdf
        # to_json accepts a Document (not raw bytes) -- open from stream first
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        data = json.loads(pymupdf4llm.to_json(doc))
        blocks: list[Block] = []
        for page in data.get("pages", []):
            pno = page.get("page_number", 0)
            for i, box in enumerate(page.get("boxes", [])):
                btype = BOXCLASS_MAP.get(box.get("boxclass"), "paragraph")
                if btype == "table" and isinstance(box.get("table"), dict):
                    text = (box["table"].get("markdown") or "").strip()
                    tid = f"p{pno}b{i}"
                else:
                    text = _box_text(box)
                    tid = None
                if not text and btype != "figure":
                    continue
                blocks.append(Block(
                    text=text or "[figure]", page=pno, block_type=btype,
                    level=int(box.get("header_level") or 0),
                    table_id=tid,
                    bbox=tuple(box[k] for k in ("x0", "y0", "x1", "y1")) if "x0" in box else None,
                ))
        return blocks

    def chunk(self, blocks: list[Block], max_tokens: int = 500) -> list[Chunk]:
        return semantic_chunk(blocks, max_tokens)


class BaseParser:
    """Reference naive parser: fitz get_text per page + fixed-size chunking.

    For a TRUE A/B, point this at your current production chunker instead --
    the point is 'what we ship today' vs 'layout-based', whatever today is.
    """

    name = "base"

    def parse(self, pdf_bytes: bytes) -> list[Block]:
        try:
            import pymupdf as fitz
        except ImportError:
            import fitz
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        return [Block(text=page.get_text("text").strip(), page=i,
                      block_type="paragraph")
                for i, page in enumerate(doc)]

    def chunk(self, blocks: list[Block], max_tokens: int = 500,
              overlap: int = 50) -> list[Chunk]:
        chunks: list[Chunk] = []
        for b in blocks:
            words, start = b.text.split(), 0
            step = max(1, int(max_tokens / 1.3) - overlap)
            size = int(max_tokens / 1.3)
            while start < len(words):
                piece = " ".join(words[start:start + size])
                chunks.append(Chunk(text=piece, page=b.page, block_type="paragraph"))
                start += step
        return chunks


# ------------------------------------------------------------------ chunking
def semantic_chunk(blocks: list[Block], max_tokens: int = 500) -> list[Chunk]:
    """Assemble typed blocks into chunks. Pure function -- fully testable.

    Rules:
      - headers/footers (detected by the layout model) are dropped, not chunked
      - headings travel as path prefixes, not standalone chunks
      - tables are NEVER split and never merged with prose
      - small blocks merge up to the token budget
    """
    chunks: list[Chunk] = []
    cur: list[Block] = []
    cur_tokens = 0
    heading_path: list[str] = []

    def prefix() -> str:
        return " > ".join(heading_path)

    def flush() -> None:
        nonlocal cur, cur_tokens
        if not cur:
            return
        p = prefix()
        text = (p + "\n" if p else "") + "\n\n".join(b.text for b in cur)
        types = {b.block_type for b in cur}
        chunks.append(Chunk(text=text, page=cur[0].page,
                            block_type=cur[0].block_type if len(types) == 1 else "mixed",
                            heading_path=p,
                            table_id=cur[0].table_id if len({b.table_id for b in cur}) == 1 else None))
        cur, cur_tokens = [], 0

    for b in blocks:
        if b.block_type in ("header", "footer"):
            continue
        if b.block_type == "heading":
            flush()
            heading_path = heading_path[: max(0, b.level - 1)] + [b.text.strip()]
            continue
        if b.block_type == "table":
            flush()  # tables stand alone, whole, under the current heading path
            p = prefix()
            chunks.append(Chunk(text=(p + "\n" if p else "") + b.text, page=b.page,
                                block_type="table", heading_path=p, table_id=b.table_id))
            continue
        tokens = _tokens(b.text)
        if cur and cur_tokens + tokens > max_tokens:
            flush()
        cur.append(b)
        cur_tokens += tokens
    flush()
    return chunks


# ------------------------------------------------------------------ diagnostics
def parser_diagnostics(chunks: list[Chunk]) -> dict:
    """Parser-level health metrics -- no LLM needed, runs fully offline."""
    norm = [" ".join(c.text.split()) for c in chunks]
    seen, dupes = set(), 0
    for t in norm:
        key = t[:120]
        if key in seen:
            dupes += 1
        seen.add(key)
    tids = [c.table_id for c in chunks if c.table_id]
    toks = [_tokens(c.text) for c in chunks]
    return {
        "n_chunks": len(chunks),
        "avg_tokens": round(sum(toks) / len(toks), 1) if toks else 0,
        "tables_total": len(set(tids)),
        "tables_split": sum(1 for t in set(tids) if tids.count(t) > 1),
        "near_duplicate_chunks": dupes,   # header/footer echo across pages
    }


# ------------------------------------------------------------------ A/B orchestration
def compare_parsers(parsers: dict, docs: dict[str, bytes],
                    cases: list[dict] | None = None,
                    evaluate_fn=None) -> dict:
    """Run the A/B. evaluate_fn(parser_name, chunks_by_doc, cases) -> rows
    plugs in the real retrieval+generation loop (or a stub in tests)."""
    from .eval_harness import summarize  # local import: keeps module light

    chunks_by_parser, diagnostics = {}, {}
    for name, parser in parsers.items():
        per_doc = {}
        for doc_id, pdf in docs.items():
            per_doc[doc_id] = parser.chunk(parser.parse(pdf))
        chunks_by_parser[name] = per_doc
        agg: dict[str, float] = {}
        for doc_id, ch in per_doc.items():
            d = parser_diagnostics(ch)
            for k, v in d.items():
                agg[k] = agg.get(k, 0) + v
        diagnostics[name] = {k: round(v / len(per_doc), 2) for k, v in agg.items()}

    rows: list[dict] = []
    if evaluate_fn is not None and cases:
        for name in parsers:
            rows.extend(evaluate_fn(name, chunks_by_parser[name], cases))
    summary = summarize(rows) if rows else {}
    return {"diagnostics": diagnostics, "rows": rows,
            "summary": summary, "deltas": delta_report(summary)}


def delta_report(summary: dict) -> dict:
    """Per-metric deltas vs the first (baseline) model in the summary."""
    models = list(summary)
    if len(models) < 2:
        return {}
    base, out = summary[models[0]], {}
    for m in models[1:]:
        d = {}
        for k, v in summary[m].items():
            bv = base.get(k)
            if isinstance(v, (int, float)) and isinstance(bv, (int, float)):
                d[k] = round(v - bv, 4)
        out[f"{m} - {models[0]}"] = d
    return out


def _real_evaluate_fn(provider, judge):
    """Production wiring: temp collections per parser, real run_case per case.

    from .eval_harness import run_case
    from .vectorstore import get_collection  # your existing helpers

    def evaluate_fn(parser_name, chunks_by_doc, cases):
        rows = []
        for doc_id, chunks in chunks_by_doc.items():
            coll = get_collection(f"{doc_id}__{parser_name}")  # temp namespace
            coll.add_texts(...)  # index this parser's chunks
            def retrieve_fn(q, _doc_id, _coll=coll):
                return retrieve(q, _coll)  # your existing retrieval
            for case in cases:
                rows.append(run_case({**case, "doc_id": doc_id},
                                     provider, retrieve_fn, judge))
        return rows
    return evaluate_fn
    """
    raise NotImplementedError("wire to your vectorstore/retrieval helpers (see docstring)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--docs", required=True, help="dir of PDFs")
    ap.add_argument("--evals", default=None, help="JSONL eval file (enables full mode)")
    ap.add_argument("--models", default="gpt4o-mini")
    ap.add_argument("--judge", default="gpt4o-mini")
    args = ap.parse_args()

    pdfs = {os.path.splitext(os.path.basename(p))[0]: open(p, "rb").read()
            for p in sorted(glob.glob(os.path.join(args.docs, "*.pdf")))}
    if not pdfs:
        ap.error(f"no PDFs in {args.docs}")
    parsers = {"base": BaseParser(), "layout": LayoutParser()}
    cases = [json.loads(l) for l in open(args.evals)] if args.evals else None

    evaluate_fn = None
    if cases:
        from .llm_providers import get_provider
        provider = get_provider(args.models.split(",")[0].strip())
        judge = get_provider(args.judge)
        evaluate_fn = _real_evaluate_fn(provider, judge)  # wire per docstring

    report = compare_parsers(parsers, pdfs, cases, evaluate_fn)
    print("\n=== parser diagnostics (avg per doc) ===")
    for name, d in report["diagnostics"].items():
        print(f"{name:>8}: " + "  ".join(f"{k}={v}" for k, v in d.items()))
    if report["summary"]:
        from .eval_harness import print_report
        print("\n=== quality summary ===")
        print_report(report["summary"])
        print("\n=== deltas (challenger - base) ===")
        print(json.dumps(report["deltas"], indent=2))
    else:
        print("\n(no --evals given: diagnostics only. "
              "Wire _real_evaluate_fn for the full quality A/B.)")


if __name__ == "__main__":
    main()
