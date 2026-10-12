"""Pluggable LLM providers.

Every provider implements the same interface, so the app -- and the eval
harness -- can swap GPT-4o / Ollama / Opus without touching call sites:

    provider = get_provider("gpt4o")            # or "ollama", "opus"
    result = provider.generate(system=..., user=..., temperature=0.0)
    print(result.text, result.latency_s, result.est_cost_usd)

Env:
    OPENAI_API_KEY,    OPENAI_MODEL    (default gpt-4o)
    ANTHROPIC_API_KEY, ANTHROPIC_MODEL (default claude-opus-4-5)
    OLLAMA_BASE_URL   (default http://localhost:11434)
    OLLAMA_MODEL      (default llama3.1:8b)

COST_PER_1M is approximate -- update from current pricing; it is only used
for relative cost comparisons in eval reports, never for billing.
"""
import os
import time
from dataclasses import dataclass, field


# (input, output) USD per 1M tokens -- APPROXIMATE, verify before quoting.
COST_PER_1M = {
    "gpt4o": (2.50, 10.00),
    "gpt4o-mini": (0.15, 0.60),
    "opus": (15.00, 75.00),
    "ollama": (0.0, 0.0),  # local inference: no per-token charge
}


@dataclass
class LLMResult:
    text: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    latency_s: float = 0.0
    est_cost_usd: float = 0.0


class LLMProvider:
    """Interface every provider implements."""

    name: str = "base"

    def generate(self, system: str, user: str, temperature: float = 0.0,
                 max_tokens: int = 800) -> LLMResult:
        raise NotImplementedError

    def _cost(self, prompt_tokens: int, completion_tokens: int) -> float:
        per_in, per_out = COST_PER_1M.get(self.name, (0.0, 0.0))
        return (prompt_tokens * per_in + completion_tokens * per_out) / 1e6


class OpenAIProvider(LLMProvider):
    name = "gpt4o"

    def __init__(self, model: str | None = None):
        self.model = model or os.environ.get("OPENAI_MODEL", "gpt-4o")
        if "mini" in self.model:
            self.name = "gpt4o-mini"

    def generate(self, system, user, temperature=0.0, max_tokens=800) -> LLMResult:
        from openai import OpenAI  # lazy: providers are opt-in

        client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        t0 = time.time()
        resp = client.chat.completions.create(
            model=self.model,
            messages=[{"role": "system", "content": system},
                      {"role": "user", "content": user}],
            temperature=temperature,
            max_tokens=max_tokens,
        )
        usage = resp.usage
        pt, ct = usage.prompt_tokens, usage.completion_tokens
        return LLMResult(text=resp.choices[0].message.content, model=self.model,
                         prompt_tokens=pt, completion_tokens=ct,
                         latency_s=time.time() - t0,
                         est_cost_usd=self._cost(pt, ct))


class AnthropicProvider(LLMProvider):
    name = "opus"

    def __init__(self, model: str | None = None):
        # No fine-tuning API for Claude: use as the quality baseline only.
        self.model = model or os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-5")

    def generate(self, system, user, temperature=0.0, max_tokens=800) -> LLMResult:
        import anthropic  # lazy

        client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
        t0 = time.time()
        resp = client.messages.create(
            model=self.model, system=system, max_tokens=max_tokens,
            temperature=temperature,
            messages=[{"role": "user", "content": user}],
        )
        pt, ct = resp.usage.input_tokens, resp.usage.output_tokens
        text = "".join(b.text for b in resp.content if b.type == "text")
        return LLMResult(text=text, model=self.model,
                         prompt_tokens=pt, completion_tokens=ct,
                         latency_s=time.time() - t0,
                         est_cost_usd=self._cost(pt, ct))


class OllamaProvider(LLMProvider):
    name = "ollama"

    def __init__(self, model: str | None = None):
        self.model = model or os.environ.get("OLLAMA_MODEL", "llama3.1:8b")
        self.base_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")

    def generate(self, system, user, temperature=0.0, max_tokens=800) -> LLMResult:
        import requests  # lazy

        t0 = time.time()
        r = requests.post(f"{self.base_url}/api/chat", json={
            "model": self.model, "stream": False,
            "messages": [{"role": "system", "content": system},
                         {"role": "user", "content": user}],
            "options": {"temperature": temperature, "num_predict": max_tokens},
        }, timeout=300)
        r.raise_for_status()
        data = r.json()
        pt, ct = data.get("prompt_eval_count", 0), data.get("eval_count", 0)
        return LLMResult(text=data["message"]["content"], model=self.model,
                         prompt_tokens=pt, completion_tokens=ct,
                         latency_s=time.time() - t0,
                         est_cost_usd=0.0)


_PROVIDERS = {
    "gpt4o": OpenAIProvider,
    "gpt4o-mini": lambda: OpenAIProvider("gpt-4o-mini"),
    "opus": AnthropicProvider,
    "ollama": OllamaProvider,
}


def get_provider(name: str) -> LLMProvider:
    """Registry: get_provider("gpt4o") / ("ollama") / ("opus") / ("gpt4o-mini")."""
    try:
        return _PROVIDERS[name]()
    except KeyError:
        raise ValueError(f"unknown provider {name!r}; choose from {sorted(_PROVIDERS)}")


def list_providers() -> list[str]:
    return sorted(_PROVIDERS)
