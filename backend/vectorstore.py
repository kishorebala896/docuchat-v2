"""ChromaDB-backed vector store for DocuChat v2.

One collection per document (``doc_<id>``), cosine space — embeddings are
L2-normalized, and ``config.retrieval_distance_threshold`` is documented as
a cosine distance.

Public interface:
  - add_chunks(doc_id, ids, texts, metadatas, embeddings)
  - get_all(doc_id) -> {"ids", "documents", "metadatas"}
  - query_dense(doc_id, q_emb, n_results) -> [(id, distance)]
  - delete_collection(doc_id)
"""

import os

import chromadb

from .config import settings

_client = None


def _client_for():
    global _client
    if _client is None:
        _client = chromadb.PersistentClient(
            path=os.path.join(settings.data_dir, "chroma")
        )
    return _client


def _collection_name(doc_id: str) -> str:
    return f"doc_{doc_id}"


def add_chunks(doc_id, ids, texts, metadatas, embeddings):
    col = _client_for().get_or_create_collection(
        _collection_name(doc_id), metadata={"hnsw:space": "cosine"}
    )
    col.add(ids=ids, documents=texts, metadatas=metadatas, embeddings=embeddings)


def get_all(doc_id):
    try:
        col = _client_for().get_collection(_collection_name(doc_id))
    except Exception:
        return {"ids": [], "documents": [], "metadatas": []}
    out = col.get()
    return {
        "ids": out.get("ids") or [],
        "documents": out.get("documents") or [],
        "metadatas": out.get("metadatas") or [],
    }


def query_dense(doc_id, q_emb, n_results):
    col = _client_for().get_collection(_collection_name(doc_id))
    res = col.query(query_embeddings=[q_emb], n_results=n_results)
    ids = (res.get("ids") or [[]])[0]
    dists = (res.get("distances") or [[]])[0]
    return list(zip(ids, dists))


def delete_collection(doc_id):
    try:
        _client_for().delete_collection(_collection_name(doc_id))
    except Exception:
        pass
