"""Usage + feedback tracking: the observability layer that feeds the flywheel.

Two tables:
    GenerationLog  -- one row per LLM call (the full context of a generation)
    FeedbackEvent  -- thumbs up/down, regenerate clicks, user rewrites

The rewrite is the most valuable signal you have: a user-corrected answer is
demonstration data for SFT; a (bad answer, rewritten answer) pair is a DPO pair.

Wire-up points (add to main.py):
    log_generation(db, ...)   after every /ask and /summarize LLM call
    log_feedback(db, ...)     from new endpoints:
        POST /generations/{id}/feedback {"kind": "thumbs_up|thumbs_down|regenerate|rewrite",
                                          "detail": {"text": "<rewritten answer>"}}
"""
import uuid
from datetime import datetime, timedelta

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text, JSON
from sqlalchemy.orm import relationship

from .database import Base


def _uid() -> str:
    return uuid.uuid4().hex


class GenerationLog(Base):
    """Every LLM generation, with everything needed to reproduce and judge it."""
    __tablename__ = "generation_logs"

    id = Column(String(32), primary_key=True, default=_uid)
    session_id = Column(String(32), nullable=True)
    doc_id = Column(String(32), nullable=True)
    provider = Column(String(32), nullable=False)   # gpt4o | ollama | opus | ...
    model = Column(String(128), nullable=False)
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=False)
    abstained = Column(Integer, default=0)           # 1 if the abstention path fired
    chunk_ids = Column(JSON, default=list)          # retrieval snapshot: what it saw
    best_distance = Column(Float, nullable=True)    # retrieval confidence signal
    prompt_tokens = Column(Integer, default=0)
    completion_tokens = Column(Integer, default=0)
    latency_ms = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    feedback = relationship("FeedbackEvent", back_populates="generation",
                            cascade="all, delete-orphan")


class FeedbackEvent(Base):
    """Explicit user feedback on a generation."""
    __tablename__ = "feedback_events"

    id = Column(String(32), primary_key=True, default=_uid)
    generation_id = Column(String(32), ForeignKey("generation_logs.id"), nullable=False)
    kind = Column(String(32), nullable=False)  # thumbs_up|thumbs_down|regenerate|rewrite
    detail = Column(JSON, default=dict)        # e.g. {"text": "<rewritten answer>"}
    created_at = Column(DateTime, default=datetime.utcnow)

    generation = relationship("GenerationLog", back_populates="feedback")


# ------------------------------------------------------------------ writers
def log_generation(db, *, session_id, doc_id, provider, model, question, answer,
                   abstained=False, chunk_ids=None, best_distance=None,
                   prompt_tokens=0, completion_tokens=0, latency_ms=0) -> GenerationLog:
    row = GenerationLog(
        session_id=session_id, doc_id=doc_id, provider=provider, model=model,
        question=question, answer=answer, abstained=int(bool(abstained)),
        chunk_ids=chunk_ids or [], best_distance=best_distance,
        prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
        latency_ms=latency_ms,
    )
    db.add(row); db.commit(); db.refresh(row)
    return row


def log_feedback(db, *, generation_id, kind, detail=None) -> FeedbackEvent:
    if kind not in ("thumbs_up", "thumbs_down", "regenerate", "rewrite"):
        raise ValueError(f"unknown feedback kind {kind!r}")
    row = FeedbackEvent(generation_id=generation_id, kind=kind, detail=detail or {})
    db.add(row); db.commit(); db.refresh(row)
    return row


# ------------------------------------------------------------------ stats
def usage_stats(db, days: int = 7) -> list[dict]:
    """Per-model, per-day stats: volume, abstention/regen/thumbs-down rates, cost."""
    from sqlalchemy import func
    since = datetime.utcnow() - timedelta(days=days)
    rows = (
        db.query(
            func.date(GenerationLog.created_at).label("day"),
            GenerationLog.model,
            func.count(GenerationLog.id).label("generations"),
            func.avg(GenerationLog.abstained).label("abstain_rate"),
            func.avg(GenerationLog.latency_ms).label("avg_latency_ms"),
            func.sum(GenerationLog.prompt_tokens).label("prompt_tokens"),
            func.sum(GenerationLog.completion_tokens).label("completion_tokens"),
        )
        .filter(GenerationLog.created_at >= since)
        .group_by("day", GenerationLog.model)
        .order_by("day", GenerationLog.model)
        .all()
    )
    out = []
    for day, model, n, abstain_rate, lat, pt, ct in rows:
        neg = (
            db.query(func.count(FeedbackEvent.id))
            .join(GenerationLog, FeedbackEvent.generation_id == GenerationLog.id)
            .filter(func.date(GenerationLog.created_at) == day,
                    GenerationLog.model == model,
                    FeedbackEvent.kind.in_(("thumbs_down", "regenerate")))
            .scalar()
        )
        out.append({
            "day": str(day), "model": model, "generations": n,
            "abstain_rate": round(float(abstain_rate or 0), 3),
            "negative_feedback_rate": round(neg / n, 3) if n else 0.0,
            "avg_latency_ms": round(float(lat or 0)),
            "prompt_tokens": int(pt or 0), "completion_tokens": int(ct or 0),
        })
    return out


def training_pairs(db, limit: int = 500) -> list[dict]:
    """Mine DPO pairs: (bad answer -> rewritten answer) from rewrite feedback.

    Each pair is {"prompt": <system+question+context stub>, "chosen": <rewrite>,
    "rejected": <original answer>}. Review before training -- rewrites can
    introduce their own errors.
    """
    events = (
        db.query(FeedbackEvent).join(GenerationLog)
        .filter(FeedbackEvent.kind == "rewrite")
        .order_by(FeedbackEvent.created_at.desc()).limit(limit).all()
    )
    pairs = []
    for ev in events:
        gen, text = ev.generation, (ev.detail or {}).get("text", "")
        if gen and text and text != gen.answer:
            pairs.append({"prompt": gen.question, "chosen": text,
                          "rejected": gen.answer, "generation_id": gen.id})
    return pairs
