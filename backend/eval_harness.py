"""Model comparison harness: same eval set, every provider, one report.

Eval file (JSONL), one case per line:
    {"id": "q1", "question": "...", "doc_id": "...",
     "should_abstain": false,
     "expected_points": ["AUM was $851.5M", "as of 2026-08-01"]}

Usage:
    python -m backend.eval_harness --evals evals.jsonl \\
        --models gpt4o,ollama,opus --judge gpt4o-mini --out results/

Metrics per model:
    answer_recall   fraction of expected_points the answer states (judge-scored)
    abstain_precision / abstain_recall   did it abstain exactly when it should?
    citation_rate   fraction of non-abstained answers carrying [p. N] refs
    avg_latency_s, total_cost_usd

retrieve_fn and judge_fn are injectable so the harness is unit-testable
without API keys or a vector DB. In production they default to the real
retrieval pipeline + an LLM judge.
"""
import argparse
import csv
import json
import os
import re
from collections import defaultdict

ABSTAIN_RE = re.compile(r"don'?t have (information|enough)|no information|not in the (document|provided)", re.I)
CITATION_RE = re.compile(r"\[p\.\s*\d+\]|page\s+\d+", re.I)


def is_abstention(text: str) -> bool:
    return bool(ABSTAIN_RE.search(text or ""))


def has_citation(text: str) -> bool:
    return bool(CITATION_RE.search(text or ""))


def default_judge(expected_points: list[str], answer: str, judge) -> list[int]:
    """Ask the judge which expected facts the answer states. Returns 0/1 per point."""
    hits = []
    for point in expected_points:
        verdict = judge.generate(
            system="Answer with exactly one word: YES or NO.",
            user=(f"Expected fact: {point}\nCandidate answer: {answer}\n"
                  "Does the candidate answer state the expected fact?"),
            temperature=0.0, max_tokens=5,
        ).text.strip().upper()
        hits.append(1 if verdict.startswith("Y") else 0)
    return hits


def run_case(case: dict, provider, retrieve_fn, judge) -> dict:
    chunks, best_distance = retrieve_fn(case["question"], case["doc_id"])
    context = "\n\n".join(
        f"[p. {c.get('page', '?')}] {c['text']}" for c in chunks
    )
    system = ("Answer ONLY from the context below. Cite pages like [p. 3]. "
              "If the context lacks the answer, say you don't have information.")
    result = provider.generate(system=system,
                               user=f"Context:\n{context}\n\nQuestion: {case['question']}",
                               temperature=0.0)
    abstained = is_abstention(result.text)
    expected = case.get("expected_points", []) or []
    hits = default_judge(expected, result.text, judge) if expected and not abstained else [0] * len(expected)
    return {
        "id": case["id"], "model": result.model,
        "abstained": abstained, "should_abstain": bool(case.get("should_abstain")),
        "recall": (sum(hits) / len(hits)) if hits else None,
        "citation": has_citation(result.text) if not abstained else None,
        "latency_s": round(result.latency_s, 2),
        "cost_usd": round(result.est_cost_usd, 6),
        "answer": result.text[:500],
    }


def summarize(rows: list[dict]) -> dict:
    """Aggregate per-model metrics from per-case rows."""
    by_model = defaultdict(list)
    for r in rows:
        by_model[r["model"]].append(r)
    summary = {}
    for model, rs in by_model.items():
        tp = sum(1 for r in rs if r["abstained"] and r["should_abstain"])
        fp = sum(1 for r in rs if r["abstained"] and not r["should_abstain"])
        fn = sum(1 for r in rs if not r["abstained"] and r["should_abstain"])
        recalls = [r["recall"] for r in rs if r["recall"] is not None]
        cits = [r["citation"] for r in rs if r["citation"] is not None]
        summary[model] = {
            "cases": len(rs),
            "answer_recall": round(sum(recalls) / len(recalls), 3) if recalls else None,
            "abstain_precision": round(tp / (tp + fp), 3) if (tp + fp) else None,
            "abstain_recall": round(tp / (tp + fn), 3) if (tp + fn) else None,
            "citation_rate": round(sum(cits) / len(cits), 3) if cits else None,
            "avg_latency_s": round(sum(r["latency_s"] for r in rs) / len(rs), 2),
            "total_cost_usd": round(sum(r["cost_usd"] for r in rs), 6),
        }
    return summary


def print_report(summary: dict) -> None:
    print(f"\n{'model':<22}{'recall':<8}{'abs-P':<8}{'abs-R':<8}{'cite':<7}{'lat(s)':<8}{'cost($)':<10}")
    for model, s in summary.items():
        print(f"{model:<22}{s['answer_recall']!s:<8}{s['abstain_precision']!s:<8}"
              f"{s['abstain_recall']!s:<8}{s['citation_rate']!s:<7}"
              f"{s['avg_latency_s']:<8}{s['total_cost_usd']:<10}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--evals", required=True, help="JSONL eval file")
    ap.add_argument("--models", required=True, help="comma-separated: gpt4o,ollama,opus")
    ap.add_argument("--judge", default="gpt4o-mini", help="provider used as judge")
    ap.add_argument("--out", default="eval_results", help="output dir")
    args = ap.parse_args()

    from .llm_providers import get_provider  # local import: keeps module import-light

    cases = [json.loads(line) for line in open(args.evals) if line.strip()]
    judge = get_provider(args.judge)

    # Production wiring: real retrieval pipeline. Override for tests.
    from .retrieval import retrieve as _retrieve
    def retrieve_fn(question, doc_id):
        return _retrieve(question, doc_id)

    rows = []
    for name in args.models.split(","):
        provider = get_provider(name.strip())
        print(f"evaluating {provider.model} on {len(cases)} cases...")
        for case in cases:
            rows.append(run_case(case, provider, retrieve_fn, judge))

    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, "cases.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader(); w.writerows(rows)
    summary = summarize(rows)
    with open(os.path.join(args.out, "summary.json"), "w") as f:
        json.dump(summary, f, indent=2)
    print_report(summary)
    print(f"\nwrote {args.out}/cases.csv and summary.json")


if __name__ == "__main__":
    main()
