"""Sentiment scoring service.

Uses Gemini to score a single piece of text on a -1.0 → +1.0 scale.
This runs as a background task so it never blocks the chat stream.

The score feeds into the Telemetry Engine's V_sent variable:
    S_total = (W1 * V_sent) + (W2 * V_conf) + (W3 * V_over) + (W4 * V_sleep)
"""

import asyncio
import json

import vertexai
from vertexai.generative_models import GenerativeModel

from app.config import settings
from app.services.gcp_credentials import get_gcp_credentials
from app.services.utils import strip_markdown_json

vertexai.init(project=settings.gcp_project_id, location=settings.gcp_location, credentials=get_gcp_credentials())

_SENTIMENT_PROMPT = """You are a sentiment analyser for a wellness coaching app.
Score the emotional valence of the following user message on a continuous scale from -1.0 (very negative / distressed) to +1.0 (very positive / content), where 0.0 is neutral.

Respond with ONLY a JSON object — no markdown, no extra text:
{"score": <float between -1.0 and 1.0>, "label": "negative|neutral|positive"}"""


async def score_sentiment(text: str) -> float:
    """Return a sentiment score in [-1.0, 1.0] for the given text.

    Falls back to 0.0 (neutral) on any error so callers are never blocked.
    """
    model = GenerativeModel("gemini-2.0-flash")
    prompt = f"{_SENTIMENT_PROMPT}\n\nUser message: {text[:2000]}"

    try:
        response = await asyncio.wait_for(
            asyncio.to_thread(model.generate_content, prompt),
            timeout=15.0,
        )
        raw = strip_markdown_json(response.text.strip())
        data = json.loads(raw)
        score = float(data.get("score", 0.0))
        return max(-1.0, min(1.0, score))  # clamp to valid range
    except Exception:
        return 0.0
