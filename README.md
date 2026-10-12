# DocuChat v2 — layout-native grounded document Q&A

Upload a PDF, get a summary, ask questions. Answers come **only** from the
document — otherwise the bot says *"I don't have information on that in this
document."* No hallucinations, with page citations on every answer.

v2 is a rebuild of the v1 pipeline around **PyMuPDF Layout**: the parser now
returns *typed blocks* (heading / paragraph / table / figure, headers and
footers detected by the model) instead of a flat text stream, and chunking
is *semantic* instead of fixed-size.

## What changed from v1 (and why)

| Area | v1 | v2 | Why it matters |
|---|---|---|---|
| Parsing | `get_text()` + heuristic table finding | `pymupdf4llm` typed blocks (`boxclass`, `header_level`, table markdown) | layout model beats regexes; CPU-only, no GPU infra |
| Chunking | fixed-size splits, regex heading guesses | `semantic_chunk()`: headings become path prefixes, **tables never split**, headers/footers dropped | the failure modes lived in parsing, not retrieval |
| Chunk metadata | page, section | + `block_type`, `heading_path`, `table_id` | richer citations (`[p.4, table]`), better dense retrieval |
| Answering LLM | OpenAI hardcoded | pluggable: `gpt4o` / `gpt4o-mini` / `opus` / `ollama`, per request or via `LLM_PROVIDER` | compare models on the same eval set; swap without code changes |
| Observability | chat messages only | **feedback flywheel**: `generation_logs` (model, tokens, latency, retrieval snapshot) + `feedback_events` (thumbs/regenerate/rewrite) + `GET /stats/usage` | every deployment generates the data for the next improvement |
| Evaluation | described | `backend/eval_harness.py` (multi-model) + `backend/eval_parsers.py` (parser A/B) | prove upgrades with numbers, not adjectives |

**Deliberately unchanged:** hybrid retrieval (dense + BM25 → RRF → optional rerank),
the abstention gate, session handling, one-collection-per-document scoping.
The layout upgrade was ingestion-side only — the original architecture had the
right seams.

## Architecture

```
PDF upload ──► parse (PyMuPDF Layout: typed blocks)
   ──► semantic chunk (headings prefixed, tables whole, headers/footers dropped)
   ──► embed ──► ChromaDB (ONE collection per doc, rich metadata)
                                                              │
question ──► hybrid retrieval (dense + BM25 → RRF → rerank) ───┘
   ──► score threshold? ── no ──► ABSTAIN (no LLM call)
                        └─ yes ─► LLM (provider of choice), temp=0, grounded prompt
                                   └──► logged: model, tokens, latency, chunk ids
                                              └──► thumbs down / rewrite ──► DPO pairs
```

## Run it

```bash
cd docuchat-v2
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # add OPENAI_API_KEY (or point LLM_PROVIDER=ollama)
uvicorn backend.main:app --reload          # API on :8000
streamlit run frontend/app.py              # UI on :8501
```

## Evaluate it

```bash
# parser A/B, fully offline: old chunks vs layout chunks on your PDFs
python -m backend.eval_parsers --docs ./pdfs

# multi-model comparison on a fixed eval set (see evals/sample.jsonl for format)
python -m backend.eval_harness --evals evals/sample.jsonl \
    --models gpt4o-mini,ollama --judge gpt4o-mini --out eval_results/

# mine DPO pairs from rewrite feedback (review before training)
python - <<'EOF'
from backend.database import SessionLocal
from backend.feedback import training_pairs
db = SessionLocal()
print(training_pairs(db))
EOF
```

## API highlights

- `POST /documents/upload` → async layout ingestion, poll `GET /jobs/{id}`
- `POST /documents/{id}/chat` → `{question, session_id?, provider?}` — per-turn model override
- `GET /providers` → available answering models
- `POST /generations/{id}/feedback` → `{kind: thumbs_up|thumbs_down|regenerate|rewrite, text?}`
- `GET /stats/usage?days=7` → per-model volume, abstention rate, negative-feedback rate, latency

## Interview talking points

1. **"The rot was in parsing."** v1's failure modes (scrambled multi-column pages, split tables, header noise) all traced to `get_text()` + fixed chunking. Layout parsing fixed the *category*, not the symptoms.
2. **CPU-only layout analysis.** The GNN classifies boxes from the PDF's own structural measurements — 10× faster than vision-transformer parsers, no GPU nodes. Ingestion cost matters because it runs at scale.
3. **Prove, don't assert.** The parser A/B harness holds everything constant except block extraction + chunking and reports deltas. That's how the migration was justified.
4. **The flywheel.** Logging + feedback + evals means v2 improves itself: rewrites become DPO pairs, bad cases become regression tests, the harness picks the winning model.
