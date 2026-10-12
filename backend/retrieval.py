"""Hybrid retrieval: dense (ChromaDB) + sparse (BM25) fused with RRF,
optional cross-encoder rerank. Scoped to ONE document's collection.

v2 changes: chunk metadata now carries layout-native fields (block_type,
heading_path as `section`, table_id). Citations and the LLM context block
use them -- no retrieval-logic change needed, which is the point: the
layout upgrade was ingestion-side only.

Why hybrid: newsletters/docs are full of exact terms (names, tickers, figures)
that pure vector search misses. Fusion beats either signal alone.
"""
from rank_bm25 import BM25Okapi

from .config import settings
from .embeddings import get_embedder

_RRF_K = 60


def _rrf_fuse(dense_ids, bm25_ids):
    scores = {}
    for rank, cid in enumerate(dense_ids):
        scores[cid] = scores.get(cid, 0.0) + 1.0 / (_RRF_K + rank)
    for rank, cid in enumerate(bm25_ids):
        scores[cid] = scores.get(cid, 0.0) + 1.0 / (_RRF_K + rank)
    return scores


_reranker = None


def _rerank(question, candidates):
    """Cross-encoder rerank. Lazy-loaded; enable with USE_RERANKER=true."""
    global _reranker
    if _reranker is None:
        from sentence_transformers import CrossEncoder

        _reranker = CrossEncoder(settings.reranker_model)
    scores = _reranker.predict([(question, c["text"]) for c in candidates])
    order = sorted(range(len(candidates)), key=lambda i: -scores[i])
    return [candidates[i] for i in order]


def _chunk_from_store(cid, text, meta):
    meta = meta or {}
    return {
        "id": cid,
        "text": text,
        "page": meta.get("page", 0),
        "section": meta.get("section", ""),       # heading path in v2
        "block_type": meta.get("block_type", ""),
        "table_id": meta.get("table_id", ""),
    }


def retrieve(doc_id: str, question: str, top_n: int = None):
    """Returns (chunks, best_distance). chunks carry v2 layout metadata."""
    from . import vectorstore  # lazy: keeps pure helpers importable without chromadb

    top_n = top_n or settings.top_n_final
    store = vectorstore.get_all(doc_id)
    if not store["ids"]:
        return [], None
    by_id = {
        cid: _chunk_from_store(cid, t, m)
        for cid, t, m in zip(store["ids"], store["documents"], store["metadatas"])
    }

    # dense leg
    q_emb = get_embedder().embed_query(question)
    dense_hits = vectorstore.query_dense(
        doc_id, q_emb, n_results=min(settings.top_k_dense, len(store["ids"]))
    )
    dense_ids = [cid for cid, _ in dense_hits]
    dense_dist = dict(dense_hits)

    # sparse leg (BM25 over this document's chunks only).
    # v2 bonus: table chunks carry markdown tables, which BM25 matches well
    # on figures and tickers.
    tokenized = [t.lower().split() for t in store["documents"]]
    bm25 = BM25Okapi(tokenized)
    bm25_scores = bm25.get_scores(question.lower().split())
    ranked = sorted(range(len(bm25_scores)), key=lambda i: -bm25_scores[i])
    bm25_ids = [store["ids"][i] for i in ranked[: settings.top_k_bm25]]

    fused = _rrf_fuse(dense_ids, bm25_ids)
    candidates = [
        {**by_id[cid], "score": s, "distance": dense_dist.get(cid, 99.0)}
        for cid, s in sorted(fused.items(), key=lambda kv: -kv[1])
    ]
    if settings.use_reranker and candidates:
        candidates = _rerank(question, candidates)

    top = candidates[:top_n]
    best_distance = min((c["distance"] for c in top), default=None)
    return top, best_distance
