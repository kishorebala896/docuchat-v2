/**
 * Typed contracts for the DocuChat v2 FastAPI backend.
 * Hand-mapped from backend/schemas.py (Pydantic) — keep the two in sync.
 * Field names stay snake_case to match the wire format exactly.
 */

export interface UploadResponse {
  document_id: string;
  job_id: string;
  status: string;
}

export interface DocumentOut {
  id: string;
  filename: string;
  status: string;
  parser: string | null;
  chunk_count: number | null;
  created_at: string;
}

/** Ingestion stages, in order (see backend/pipeline.py). */
export const INGEST_STAGES = [
  'queued',
  'parsing',
  'chunking',
  'embedding',
  'indexing',
  'ready',
] as const;

export type IngestStage = (typeof INGEST_STAGES)[number] | 'failed';

export interface JobOut {
  id: string;
  document_id: string;
  status: string;
  stage: string;
  error: string | null;
}

export interface ChatRequest {
  question: string;
  session_id?: string | null;
  provider?: string | null;
}

export interface Citation {
  page: number;
  section: string;
  block_type: string;
  snippet: string;
}

export interface ChatResponse {
  answer: string;
  citations: Citation[];
  abstained: boolean;
  session_id: string;
  model: string;
  generation_id: string | null;
}

export interface MessageOut {
  role: string;
  content: string;
  model: string | null;
  created_at: string;
}

export interface ChatSessionOut {
  id: string;
  created_at: string;
}

export interface SummaryResponse {
  summary: string;
  cached: boolean;
  model: string | null;
}

export type FeedbackKind = 'thumbs_up' | 'thumbs_down' | 'regenerate' | 'rewrite';

export interface FeedbackRequest {
  kind: FeedbackKind;
  text?: string | null;
}

export interface StatsOut {
  day: string;
  model: string;
  generations: number;
  /** 0–1 fractions, rounded to 3 decimals by the backend. */
  abstain_rate: number;
  negative_feedback_rate: number;
  avg_latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
}

export interface ProvidersResponse {
  default: string;
  available: string[];
}

export interface HealthResponse {
  status: string;
  parser: string;
  llm_provider: string;
  time: string;
}
