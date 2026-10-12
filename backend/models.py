"""Relational model: documents, ingestion jobs, chat sessions, messages.

Vectors live in ChromaDB (one collection per document); this is the source of truth.
Generation logs + feedback events live in backend/feedback.py (same Base/metadata).
"""
import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from .database import Base


def _uid() -> str:
    return uuid.uuid4().hex


class Document(Base):
    __tablename__ = "documents"

    id = Column(String(32), primary_key=True, default=_uid)
    filename = Column(String(512), nullable=False)
    status = Column(String(32), default="uploaded")  # uploaded|processing|ready|failed
    summary = Column(Text, nullable=True)            # cached map-reduce summary
    parser = Column(String(32), default="layout-v1") # which parser built this index
    chunk_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    jobs = relationship("IngestJob", back_populates="document", cascade="all, delete-orphan")
    sessions = relationship("ChatSession", back_populates="document", cascade="all, delete-orphan")


class IngestJob(Base):
    __tablename__ = "ingest_jobs"

    id = Column(String(32), primary_key=True, default=_uid)
    document_id = Column(String(32), ForeignKey("documents.id"), nullable=False)
    status = Column(String(32), default="queued")    # queued|processing|ready|failed
    stage = Column(String(64), default="queued")     # parsing|chunking|embedding|indexing|ready
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    document = relationship("Document", back_populates="jobs")


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(String(32), primary_key=True, default=_uid)
    document_id = Column(String(32), ForeignKey("documents.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    document = relationship("Document", back_populates="sessions")
    messages = relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(String(32), primary_key=True, default=_uid)
    session_id = Column(String(32), ForeignKey("chat_sessions.id"), nullable=False)
    role = Column(String(16), nullable=False)        # user | assistant
    content = Column(Text, nullable=False)
    model = Column(String(128), nullable=True)       # which LLM answered (assistant msgs)
    created_at = Column(DateTime, default=datetime.utcnow)

    session = relationship("ChatSession", back_populates="messages")


# Import last: registers GenerationLog + FeedbackEvent on the same metadata
# so Base.metadata.create_all() creates the feedback tables too.
from .feedback import FeedbackEvent, GenerationLog  # noqa: E402,F401
