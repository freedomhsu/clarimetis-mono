import json
import logging

from app.config import get_settings
from app.services.llm_utils import gemini_generate
from app.services.utils import strip_markdown_json

logger = logging.getLogger(__name__)

_CRISIS_PROMPT = """You are a safety classifier for a wellness coaching app.
Analyze the user message and determine if it expresses suicidal ideation, self-harm intent,
or an immediate threat to the safety of self or others.

Respond with ONLY a JSON object — no markdown, no extra text:
{"is_crisis": true|false, "confidence": 0.0-1.0, "reason": "brief explanation"}

Be conservative: if uncertain, set is_crisis to true."""

# Raised from 10s to handle gRPC cold-start latency on Cloud Run.
# Override CRISIS_DETECTION_TIMEOUT env var to tune without code changes.


async def detect_crisis(content: str) -> dict:
    try:
        prompt = f"{_CRISIS_PROMPT}\n\nUser message: {content[:2000]}"
        raw = strip_markdown_json(await gemini_generate(prompt, timeout=get_settings().crisis_detection_timeout))
        try:
            return json.loads(raw)
        except Exception as parse_exc:
            logger.error("crisis_detection: failed to parse response — %s | raw=%r", parse_exc, raw[:200])
            # Fail safe: treat unparseable response as potential crisis.
            return {"is_crisis": True, "confidence": 0.0, "reason": "parse_error"}
    except Exception as exc:
        # Fail **closed**: any error is treated as a potential crisis.
        # It is safer to surface the crisis banner unnecessarily than to miss a real one.
        logger.error(
            "crisis_detection: Gemini call failed — failing safe, treating as crisis: %s",
            exc,
            exc_info=True,
        )
        return {"is_crisis": True, "confidence": 0.0, "reason": "service_error"}
