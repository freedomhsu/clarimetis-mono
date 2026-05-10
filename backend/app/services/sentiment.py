"""Sentiment scoring service.

Uses Gemini to score a single piece of text on a -1.0 → +1.0 scale.
This runs as a background task so it never blocks the chat stream.

The score feeds into the Telemetry Engine's V_sent variable:
    S_total = (W1 * V_sent) + (W2 * V_conf) + (W3 * V_over) + (W4 * V_sleep)
"""

import json
import logging

from app.services.llm_utils import gemini_generate
from app.services.utils import strip_markdown_json

logger = logging.getLogger(__name__)

_SENTIMENT_PROMPT = """You are a sentiment analyser for a wellness coaching app.
Score the emotional valence of the following user message on a continuous scale from -1.0 (very negative / distressed) to +1.0 (very positive / content), where 0.0 is neutral.

Respond with ONLY a JSON object — no markdown, no extra text:
{"score": <float between -1.0 and 1.0>, "label": "negative|neutral|positive"}"""


async def score_sentiment(text: str) -> float:
    """Return a sentiment score in [-1.0, 1.0] for the given text.

    Falls back to 0.0 (neutral) on any error so callers are never blocked.
    """
    prompt = f"{_SENTIMENT_PROMPT}\n\nUser message: {text[:2000]}"
    try:
        raw = strip_markdown_json(await gemini_generate(prompt, timeout=15.0))
        data = json.loads(raw)
        score = float(data.get("score", 0.0))
        return max(-1.0, min(1.0, score))  # clamp to valid range
    except Exception:
        logger.warning("sentiment: scoring failed, returning neutral 0.0", exc_info=True)
        return 0.0
