import asyncio
import json
import logging

import vertexai
from vertexai.generative_models import GenerativeModel

from app.config import get_settings
from app.services.gcp_credentials import init_vertexai
from app.services.utils import strip_markdown_json

logger = logging.getLogger(__name__)

_CRISIS_PROMPT = """You are a safety classifier for a wellness coaching app.
Analyze the user message and determine if it expresses suicidal ideation, self-harm intent,
or an immediate threat to the safety of self or others.

Respond with ONLY a JSON object — no markdown, no extra text:
{"is_crisis": true|false, "confidence": 0.0-1.0, "reason": "brief explanation"}

Be conservative: if uncertain, set is_crisis to true."""


async def detect_crisis(content: str) -> dict:
    init_vertexai()
    try:
        model = GenerativeModel(get_settings().gemini_flash_model)
        prompt = f"{_CRISIS_PROMPT}\n\nUser message: {content[:2000]}"

        response = await asyncio.wait_for(
            asyncio.to_thread(model.generate_content, prompt),
            timeout=10.0,
        )

        raw = strip_markdown_json(response.text.strip())

        try:
            return json.loads(raw)
        except Exception as parse_exc:
            logger.error("crisis_detection: failed to parse Gemini response — %s | raw=%r", parse_exc, raw[:200])
            # Fail safe: treat unparseable response as potential crisis
            return {"is_crisis": True, "confidence": 0.0, "reason": "parse_error"}
    except Exception as exc:
        # Fail **closed**: any error in crisis detection is treated as a potential crisis.
        # It is safer to surface the crisis banner unnecessarily than to miss a real one.
        logger.error(
            "crisis_detection: Gemini call failed — failing safe, treating as crisis: %s",
            exc,
            exc_info=True,
        )
        return {"is_crisis": True, "confidence": 0.0, "reason": "service_error"}
