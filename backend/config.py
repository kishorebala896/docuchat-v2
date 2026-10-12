"""Central configuration. Everything is env-overridable; see .env.example."""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "DocuChat v2"

    # storage
    data_dir: str = "data"                       # uploads, chroma, sqlite live here
    database_url: str = "sqlite:///./data/docuchat.db"   # swap for postgres in prod

    # parsing: "layout" (pymupdf4llm typed blocks, default) or "base" (legacy get_text)
    parser: str = "layout"

    # embeddings: "local" (sentence-transformers, no API key) or "openai"
    embedding_provider: str = "local"
    embedding_model: str = "all-MiniLM-L6-v2"
    openai_embedding_model: str = "text-embedding-3-small"

    # --- LLM providers (see backend/llm_providers.py) ---
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-opus-4-5"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.1:8b"

    # generation: which provider answers by default; per-request override allowed
    # one of: gpt4o | gpt4o-mini | opus | ollama
    llm_provider: str = "gpt4o-mini"
    llm_temperature: float = 0.0                 # deterministic, grounded answers
    llm_max_tokens: int = 800

    # chunking / retrieval (chunk_tokens drives semantic_chunk's merge budget)
    chunk_tokens: int = 600
    top_k_dense: int = 20
    top_k_bm25: int = 20
    top_n_final: int = 5
    # ChromaDB cosine *distance* (lower = better). Above this -> abstain, no LLM call.
    retrieval_distance_threshold: float = 0.9

    # optional cross-encoder rerank (lazy-loaded, off by default to stay light)
    use_reranker: bool = False
    reranker_model: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"

    # ingestion execution: False -> FastAPI BackgroundTasks (demo), True -> Celery
    use_celery: bool = False
    celery_broker: str = "redis://localhost:6379/0"

    # chat
    history_turns: int = 6                       # user+assistant turns kept in prompt

    class Config:
        env_file = ".env"


settings = Settings()
