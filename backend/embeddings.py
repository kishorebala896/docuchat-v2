"""Embedding providers behind one interface.
Imports are lazy so `import backend.embeddings` never pulls torch/openai at module load.
Swap providers with EMBEDDING_PROVIDER (local | openai) -- no code changes."""
from .config import settings


class Embedder:
    def embed_documents(self, texts):
        raise NotImplementedError

    def embed_query(self, text):
        return self.embed_documents([text])[0]


class LocalEmbedder(Embedder):
    """Self-hosted sentence-transformers. Default: zero API cost, data never leaves the box."""

    def __init__(self, model_name: str):
        from sentence_transformers import SentenceTransformer

        self._model = SentenceTransformer(model_name)

    def embed_documents(self, texts):
        # batched internally by sentence-transformers; normalize for cosine distance
        return self._model.encode(texts, batch_size=64, normalize_embeddings=True).tolist()


class OpenAIEmbedder(Embedder):
    def __init__(self, model_name: str, api_key: str):
        from openai import OpenAI

        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is required for embedding_provider=openai")
        self._client = OpenAI(api_key=api_key)
        self._model = model_name

    def embed_documents(self, texts):
        out = []
        for i in range(0, len(texts), 100):  # stay under API batch limits
            resp = self._client.embeddings.create(model=self._model, input=texts[i : i + 100])
            out.extend([d.embedding for d in resp.data])
        return out


_embedder = None


def get_embedder() -> Embedder:
    global _embedder
    if _embedder is None:
        if settings.embedding_provider == "openai":
            _embedder = OpenAIEmbedder(settings.openai_embedding_model, settings.openai_api_key)
        else:
            _embedder = LocalEmbedder(settings.embedding_model)
    return _embedder
