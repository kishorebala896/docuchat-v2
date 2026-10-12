"""Pydantic request/response contracts for the API."""
from typing import List, Optional

from pydantic import BaseModel


class UploadResponse(BaseModel):
    document_id: str
    job_id: str
    status: str


class DocumentOut(BaseModel):
    id: str
    filename: str
    status: str
    parser: Optional[str] = None
    chunk_count: Optional[int] = None
    created_at: str

    class Config:
        from_attributes = True


class JobOut(BaseModel):
    id: str
    document_id: str
    status: str
    stage: str
    error: Optional[str] = None


class ChatRequest(BaseModel):
    question: str
    session_id: Optional[str] = None
    provider: Optional[str] = None  # override settings.llm_provider for this turn


class Citation(BaseModel):
    page: int
    section: str
    block_type: str = ""
    snippet: str


class ChatResponse(BaseModel):
    answer: str
    citations: List[Citation]
    abstained: bool
    session_id: str
    model: str
    generation_id: Optional[str] = None  # for POST /generations/{id}/feedback


class MessageOut(BaseModel):
    role: str
    content: str
    model: Optional[str] = None
    created_at: str


class SummaryResponse(BaseModel):
    summary: str
    cached: bool
    model: Optional[str] = None


class FeedbackRequest(BaseModel):
    kind: str  # thumbs_up | thumbs_down | regenerate | rewrite
    text: Optional[str] = None  # rewritten answer, when kind == "rewrite"


class StatsOut(BaseModel):
    day: str
    model: str
    generations: int
    abstain_rate: float
    negative_feedback_rate: float
    avg_latency_ms: int
    prompt_tokens: int
    completion_tokens: int
