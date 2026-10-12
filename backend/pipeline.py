"""v2 ingestion pipeline: layout parse -> semantic chunk -> embed -> index.

What changed from v1:
  - parse_pdf() used raw PyMuPDF get_text + heuristic table finding.
    v2 uses LayoutParser (pymupdf4llm / PyMuPDF Layout): typed blocks
    (heading/paragraph/table/figure, header/footer detected by the model).
  - chunk_pages() did fixed-size splitting with regex heading guesses.
    v2 uses semantic_chunk(): headings become path prefixes, tables are
    never split, headers/footers are dropped at parse time.
  - Chunk metadata is richer: block_type, heading_path, table_id flow into
    ChromaDB and surface in citations.

Runs in a background worker (FastAPI BackgroundTasks by default, Celery when
USE_CELERY=true). Never blocks the API; progress is tracked in IngestJob.stage.
Parser diagnostics (chunk counts, tables kept whole) are logged per document --
feed them to the parser A/B eval (backend/eval_parsers.py).
"""
import logging
import os
import traceback

from .config import settings
from .database import SessionLocal
from .eval_parsers import LayoutParser, parser_diagnostics
from .models import Document, IngestJob

log = logging.getLogger("docuchat-v2.pipeline")


def parse_and_chunk(pdf_bytes: bytes):
    """Layout-native parse -> semantic chunks. Returns (chunks, diagnostics)."""
    parser = LayoutParser()  # raises a clear error if pymupdf4llm is missing
    blocks = parser.parse(pdf_bytes)
    if not blocks:
        raise RuntimeError("no blocks extracted from document")
    chunks = parser.chunk(blocks, max_tokens=settings.chunk_tokens)
    if not chunks:
        raise RuntimeError("no chunks produced from document")
    diag = parser_diagnostics(chunks)
    log.info("parser=layout chunks=%d tables=%d tables_split=%d dupes=%d",
             diag["n_chunks"], diag["tables_total"],
             diag["tables_split"], diag["near_duplicate_chunks"])
    return chunks, diag


def _set_stage(db, job, doc, stage, status="processing", error=None):
    job.stage, job.status = stage, status
    if error:
        job.error = error
    if status in ("ready", "failed"):
        doc.status = status
    db.commit()


def run_ingestion(doc_id: str) -> None:
    """Full pipeline for one document. Own DB session so it works in any worker."""
    from . import vectorstore          # lazy: keeps parse/chunk importable without chromadb
    from .embeddings import get_embedder

    db = SessionLocal()
    try:
        doc = db.get(Document, doc_id)
        job = (
            db.query(IngestJob)
            .filter(IngestJob.document_id == doc_id)
            .order_by(IngestJob.created_at.desc())
            .first()
        )
        if not doc or not job:
            return
        upload_path = os.path.join(settings.data_dir, "uploads", doc_id)
        pdf = next((os.path.join(upload_path, f) for f in os.listdir(upload_path)
                    if f.lower().endswith(".pdf")), None)
        if not pdf:
            raise RuntimeError("uploaded file not found on disk")

        _set_stage(db, job, doc, "parsing")
        with open(pdf, "rb") as f:
            pdf_bytes = f.read()
        chunks, diag = parse_and_chunk(pdf_bytes)
        doc.parser = f"layout-v1"  # which parser produced this index
        doc.chunk_count = len(chunks)

        _set_stage(db, job, doc, "chunking")  # semantic assembly already done; stage kept for UI

        _set_stage(db, job, doc, "embedding")
        texts = [c.text for c in chunks]
        embeddings = get_embedder().embed_documents(texts)

        _set_stage(db, job, doc, "indexing")
        ids = [f"{doc_id}_{i}" for i in range(len(chunks))]
        metadatas = [{
            "page": c.page,
            "section": c.heading_path or "",
            "block_type": c.block_type,
            "table_id": c.table_id or "",
        } for c in chunks]
        vectorstore.add_chunks(doc_id, ids, texts, metadatas, embeddings)

        _set_stage(db, job, doc, "ready", status="ready")
    except Exception as e:  # noqa: BLE001 -- surface the real error on the job row
        traceback.print_exc()
        try:
            _set_stage(db, job, doc, "failed", status="failed", error=f"{type(e).__name__}: {e}")
        except Exception:
            pass
    finally:
        db.close()
