"""Grounded generation + abstention, on the pluggable provider interface.

v2 changes from v1:
  - v1 hardcoded OpenAI. v2 routes through backend/llm_providers, so the
    answering model is chosen per request (or via LLM_PROVIDER env):
    gpt4o | gpt4o-mini | opus | ollama.
  - generate_answer() returns the LLMResult too, so main.py can log
    tokens/latency/model for the feedback flywheel without a second call.

Anti-hallucination is still layered, not a single prompt trick:
  1. retrieval is scoped to the document's own ChromaDB collection
  2. score threshold -> abstain WITHOUT calling the LLM (cheap, deterministic)
  3. system prompt forces "I don't have information..." + citations, temp=0
  4. eval set with unanswerable questions measures abstention quality
"""
from .config import settings
from .llm_providers import LLMResult, get_provider

ABSTAIN_TEXT = "I don't have information on that in this document."

SYSTEM_PROMPT = """You are DocuChat, a precise document assistant for company managers.
Rules you must follow:
1. Answer ONLY using the context provided below. Never use outside knowledge.
2. If the answer is not in the context, reply with exactly this sentence and nothing else:
   "I don't have information on that in this document."
3. Cite every factual claim with the page marker shown, e.g. [p.4]. For tables, mention the table, e.g. [p.4, table].
4. Be concise. If the context is a table, read the numbers carefully."""


def _context_block(chunks) -> str:
    parts = []
    for c in chunks:
        tag = f"[p.{c['page']}]"
        if c.get("block_type") == "table":
            tag = f"[p.{c['page']}, table]"
        elif c.get("section"):
            tag = f"[p.{c['page']}]"
        parts.append(f"{tag} {c['text']}")
    return "\n\n---\n\n".join(parts)


def generate_answer(question: str, chunks, history, provider_name: str | None = None):
    """Returns (answer, citations, abstained, llm_result)."""
    provider = get_provider(provider_name or settings.llm_provider)
    system = SYSTEM_PROMPT
    user = f"Context:\n{_context_block(chunks)}\n\nQuestion: {question}"
    if history:
        convo = "\n".join(f"{m['role']}: {m['content']}" for m in history)
        user = f"Conversation so far:\n{convo}\n\n{user}"
    result: LLMResult = provider.generate(
        system=system, user=user,
        temperature=settings.llm_temperature, max_tokens=settings.llm_max_tokens,
    )
    text = (result.text or "").strip()
    abstained = "don't have information" in text.lower()
    citations = [
        {"page": c["page"], "section": c.get("section", ""),
         "block_type": c.get("block_type", ""),
         "snippet": c["text"][:300]}
        for c in chunks
    ]
    return text, citations, abstained, result


def summarize_chunks(texts, provider_name: str | None = None, batch: int = 8):
    """Map-reduce: summarize batches of chunks, then combine. Returns (summary, results)."""
    provider = get_provider(provider_name or settings.llm_provider)
    results = []

    def _summarize(text: str, final: bool = False) -> str:
        instruction = (
            "Combine the section summaries below into one coherent executive summary. "
            "Keep key numbers, dates, and decisions. Under 300 words."
            if final
            else "Summarize the following document excerpt for a busy manager. "
            "Keep key numbers, dates, and decisions. Under 150 words."
        )
        r = provider.generate(system=instruction, user=text,
                              temperature=0.0, max_tokens=400)
        results.append(r)
        return (r.text or "").strip()

    partials = ["\n\n".join(texts[i:i + batch]) for i in range(0, len(texts), batch)]
    partials = [_summarize(p) for p in partials]
    summary = partials[0] if len(partials) == 1 else _summarize("\n\n".join(partials), final=True)
    return summary, results
