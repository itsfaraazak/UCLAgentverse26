"""Thin wrapper around the Gemini 4 Argon / Interactions API client.

Only the Evidence and Treatment-Pathway agents need an LLM at all -- the
ACMG scoring, conflict-detection and compliance agents are deliberately
plain deterministic code, because that is what the hackathon's
verification-loop requirement and the "science and evaluation" judging
criterion actually ask for.

When no `GEMINI_API_KEY` is set (e.g. running this repo outside the
venue, or in CI), every call here degrades to a clearly-labelled stub
response instead of failing, so the rest of the pipeline stays testable
end to end without live credits.
"""
from __future__ import annotations

import os

MODEL_IDS = {
    "lead_reasoning": "gemini-4-argon",
    "fast_subagent": "gemini-3.8-flash",
    "deep_research": "deep-research-preview-04-2026",
}


class StubResponse:
    def __init__(self, text: str):
        self.output_text = text


def have_live_client() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY"))


def get_client():
    """Return a configured `genai.Client()`, or None if no API key is
    present. Callers must handle the None case by falling back to a
    stub -- never fail the pipeline for a missing key during a demo
    rehearsal."""
    if not have_live_client():
        return None
    try:
        from google import genai
    except ImportError:
        return None
    return genai.Client()


def generate(prompt: str, *, model: str = MODEL_IDS["lead_reasoning"], thinking_level: str = "medium") -> str:
    """Run one Interactions API call, or return a labelled stub.

    Stub output is prefixed with "[stub]" so it is never mistaken for a
    real model response in a demo or a log.
    """
    client = get_client()
    if client is None:
        return f"[stub] no GEMINI_API_KEY set -- would have asked {model}: {prompt[:120]}..."
    interaction = client.interactions.create(
        model=model,
        input=prompt,
        generation_config={"thinking_level": thinking_level},
    )
    return interaction.output_text
