"""DocuChat v2 API: upload -> async layout ingest -> grounded chat + summaries.

v2 changes from v1:
  - ingestion is layout-native (see backend/pipeline.py)
  - answering model is pluggable per request (llm_providers)
  - every generation is logged (GenerationLog) with model, tokens, latency,
    and retrieval snapshot -- the feedback flywheel's flight recorder
  - POST /generations/{id}/feedback captures thumbs/regenerate/rewrite
  - GET /stats/usage reports per-model volume, abstention, negative-feedback

Concurrency model:
  * chat endpoints are async (I/O-bound: vector DB, LLM) -> hundreds of concurrent
    users per process
  * parsing/embedding never blocks the API: BackgroundTasks by default,
    Celery workers when USE_CELERY=true (scale workers independently)
"""
import os
import shutil
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from . import llm, retrieval, vectorstore
from .config import settings
from .database import Base, engine, get_db
from .feedback import log_feedback, log_generation, usage_stats
from .llm_providers import list_providers
from .models import ChatMessage, ChatSession, Document, IngestJob
from .pipeline import run_ingestion
from .schemas import (
    ChatRequest,
    ChatResponse,
    Citation,
    DocumentOut,
    FeedbackRequest,
    JobOut,
    MessageOut,
    StatsOut,
    SummaryResponse,
    UploadResponse,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(os.path.join(settings.data_dir, "uploads"), exist_ok=True)
    Base.metadata.create_all(bind=engine)  # includes generation_logs + feedback_events
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)


def _doc_or_404(db: Session, doc_id: str) -> Document:
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "document not found")
    return doc


def _kick_off_ingest(background_tasks: BackgroundTasks, doc_id: str):
    if settings.use_celery:
        from .worker import ingest_document_task  # lazy: don't require celery otherwise

        ingest_document_task.delay(doc_id)
    else:
        background_tasks.add_task(run_ingestion, doc_id)


# ---------------- documents ----------------

@app.post("/documents/upload", response_model=UploadResponse)
async def upload_document(
    background_tasks: BackgroundTasks, file: UploadFile = File(...), db: Session = Depends(get_db)
):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext != ".pdf":
        raise HTTPException(400, "only PDF is supported in this demo")
    doc = Document(filename=file.filename, status="processing")
    db.add(doc)
    db.flush()  # assigns doc.id before we write the file

    updir = os.path.join(settings.data_dir, "uploads", doc.id)
    os.makedirs(updir, exist_ok=True)
    with open(os.path.join(updir, f"original{ext}"), "wb") as f:
        f.write(await file.read())

    job = IngestJob(document_id=doc.id, status="processing", stage="queued")
    db.add(job)
    db.commit()

    _kick_off_ingest(background_tasks, doc.id)
    return UploadResponse(document_id=doc.id, job_id=job.id, status="processing")


@app.get("/documents", response_model=list[DocumentOut])
def list_documents(db: Session = Depends(get_db)):
    docs = db.query(Document).order_by(Document.created_at.desc()).all()
    return [
        DocumentOut(id=d.id, filename=d.filename, status=d.status,
                    parser=d.parser, chunk_count=d.chunk_count,
                    created_at=d.created_at.isoformat())
        for d in docs
    ]


@app.get("/jobs/{job_id}", response_model=JobOut)
def job_status(job_id: str, db: Session = Depends(get_db)):
    job = db.get(IngestJob, job_id)
    if not job:
        raise HTTPException(404, "job not found")
    return JobOut(id=job.id, document_id=job.document_id, status=job.status,
                  stage=job.stage, error=job.error)


@app.delete("/documents/{doc_id}")
def delete_document(doc_id: str, db: Session = Depends(get_db)):
    _doc_or_404(db, doc_id)
    vectorstore.delete_collection(doc_id)                       # vectors
    shutil.rmtree(os.path.join(settings.data_dir, "uploads", doc_id),
                  ignore_errors=True)                           # raw file
    db.query(Document).filter(Document.id == doc_id).delete()   # rows (cascades)
    db.commit()
    return {"deleted": doc_id}


@app.get("/providers")
def providers():
    """LLM providers available for answering. Pass one as `provider` in chat."""
    return {"default": settings.llm_provider, "available": list_providers()}


# ---------------- chat ----------------

def _get_or_create_session(db: Session, doc_id: str, session_id: str | None) -> ChatSession:
    if session_id:
        s = db.get(ChatSession, session_id)
        if s and s.document_id == doc_id:
            return s
    s = ChatSession(document_id=doc_id)
    db.add(s)
    db.commit()
    return s


@app.post("/documents/{doc_id}/chat", response_model=ChatResponse)
async def chat(doc_id: str, req: ChatRequest, db: Session = Depends(get_db)):
    doc = _doc_or_404(db, doc_id)
    if doc.status != "ready":
        raise HTTPException(409, f"document is {doc.status}, not ready yet")
    question = req.question.strip()
    if not question:
        raise HTTPException(400, "question is empty")
    if req.provider and req.provider not in list_providers():
        raise HTTPException(400, f"unknown provider {req.provider!r}")

    session = _get_or_create_session(db, doc_id, req.session_id)
    db.add(ChatMessage(session_id=session.id, role="user", content=question))
    db.commit()

    chunks, best_distance = retrieval.retrieve(doc_id, question)
    chunk_ids = [c["id"] for c in chunks]  # exact retrieval snapshot for the flight recorder

    # Layer 2 abstention: nothing relevant retrieved -> don't even call the LLM
    if not chunks or (best_distance is not None
                      and best_distance > settings.retrieval_distance_threshold):
        db.add(ChatMessage(session_id=session.id, role="assistant", content=llm.ABSTAIN_TEXT))
        db.commit()
        gen = log_generation(db, session_id=session.id, doc_id=doc_id,
                             provider=req.provider or settings.llm_provider,
                             model="abstained", question=question,
                             answer=llm.ABSTAIN_TEXT, abstained=True,
                             chunk_ids=chunk_ids, best_distance=best_distance)
        return ChatResponse(answer=llm.ABSTAIN_TEXT, citations=[], abstained=True,
                            session_id=session.id, model="abstained",
                            generation_id=gen.id)

    history_rows = (
        db.query(ChatMessage).filter(ChatMessage.session_id == session.id)
        .order_by(ChatMessage.created_at.desc()).limit(settings.history_turns * 2).all()
    )
    # history_rows is newest-first and includes the just-saved user msg: drop it, chronological order
    history = [{"role": m.role, "content": m.content} for m in reversed(history_rows[1:])]

    answer, citations, abstained, result = llm.generate_answer(
        question, chunks, history, provider_name=req.provider)
    db.add(ChatMessage(session_id=session.id, role="assistant", content=answer,
                       model=result.model))
    db.commit()
    gen = log_generation(
        db, session_id=session.id, doc_id=doc_id,
        provider=req.provider or settings.llm_provider, model=result.model,
        question=question, answer=answer, abstained=abstained,
        chunk_ids=chunk_ids, best_distance=best_distance,
        prompt_tokens=result.prompt_tokens, completion_tokens=result.completion_tokens,
        latency_ms=int(result.latency_s * 1000),
    )
    return ChatResponse(
        answer=answer,
        citations=[Citation(**c) for c in citations],
        abstained=abstained,
        session_id=session.id,
        model=result.model,
        generation_id=gen.id,
    )


@app.get("/documents/{doc_id}/sessions")
def list_sessions(doc_id: str, db: Session = Depends(get_db)):
    _doc_or_404(db, doc_id)
    sessions = (
        db.query(ChatSession).filter(ChatSession.document_id == doc_id)
        .order_by(ChatSession.created_at.desc()).all()
    )
    return [{"id": s.id, "created_at": s.created_at.isoformat()} for s in sessions]


@app.get("/sessions/{session_id}/messages", response_model=list[MessageOut])
def session_messages(session_id: str, db: Session = Depends(get_db)):
    msgs = (
        db.query(ChatMessage).filter(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at).all()
    )
    return [MessageOut(role=m.role, content=m.content, model=m.model,
                       created_at=m.created_at.isoformat()) for m in msgs]


# ---------------- summary ----------------

@app.post("/documents/{doc_id}/summarize", response_model=SummaryResponse)
def summarize(doc_id: str, db: Session = Depends(get_db)):
    doc = _doc_or_404(db, doc_id)
    if doc.status != "ready":
        raise HTTPException(409, f"document is {doc.status}, not ready yet")
    if doc.summary:
        return SummaryResponse(summary=doc.summary, cached=True)
    store = vectorstore.get_all(doc_id)
    if not store["documents"]:
        raise HTTPException(409, "document has no indexed text")
    summary, results = llm.summarize_chunks(store["documents"])
    doc.summary = summary
    db.commit()
    model = results[-1].model if results else settings.llm_provider
    log_generation(db, session_id=None, doc_id=doc_id,
                   provider=settings.llm_provider, model=model,
                   question="[summarize document]", answer=summary,
                   prompt_tokens=sum(r.prompt_tokens for r in results),
                   completion_tokens=sum(r.completion_tokens for r in results),
                   latency_ms=int(sum(r.latency_s for r in results) * 1000))
    return SummaryResponse(summary=summary, cached=False, model=model)


# ---------------- feedback flywheel ----------------

@app.post("/generations/{generation_id}/feedback")
def submit_feedback(generation_id: str, req: FeedbackRequest, db: Session = Depends(get_db)):
    """thumbs_up | thumbs_down | regenerate | rewrite(+text). Rewrites become DPO data."""
    try:
        ev = log_feedback(db, generation_id=generation_id, kind=req.kind,
                          detail={"text": req.text} if req.text else {})
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "feedback_id": ev.id}


@app.get("/stats/usage", response_model=list[StatsOut])
def stats_usage(days: int = 7, db: Session = Depends(get_db)):
    """Per-model, per-day: volume, abstention rate, negative-feedback rate, latency, tokens."""
    return [StatsOut(**s) for s in usage_stats(db, days=days)]


@app.get("/health")
def health():
    return {"status": "ok", "parser": settings.parser,
            "llm_provider": settings.llm_provider, "time": datetime.utcnow().isoformat()}
