import json
from unittest.mock import AsyncMock, patch

import pytest

from app.services.crisis_detection import detect_crisis


async def test_detect_crisis_returns_true_for_crisis_message():
    rv = json.dumps({"is_crisis": True, "confidence": 0.95, "reason": "suicidal ideation"})
    with patch(
        "app.services.crisis_detection.gemini_generate",
        new_callable=AsyncMock,
        return_value=rv,
    ):
        result = await detect_crisis("I want to end my life")
    assert result["is_crisis"] is True
    assert result["confidence"] == 0.95


async def test_detect_crisis_returns_false_for_safe_message():
    rv = json.dumps({"is_crisis": False, "confidence": 0.99, "reason": "no threat"})
    with patch(
        "app.services.crisis_detection.gemini_generate",
        new_callable=AsyncMock,
        return_value=rv,
    ):
        result = await detect_crisis("I had a great day today")
    assert result["is_crisis"] is False


async def test_detect_crisis_fails_safe_on_invalid_json():
    with patch(
        "app.services.crisis_detection.gemini_generate",
        new_callable=AsyncMock,
        return_value="bad json",
    ):
        result = await detect_crisis("some message")
    assert result["is_crisis"] is True
    assert result["reason"] == "parse_error"


async def test_detect_crisis_fails_safe_on_markdown_wrapped_json():
    rv = '```json\n{"is_crisis": false, "confidence": 0.9, "reason": "ok"}\n```'
    with patch(
        "app.services.crisis_detection.gemini_generate",
        new_callable=AsyncMock,
        return_value=rv,
    ):
        result = await detect_crisis("I feel fine")
    assert result["is_crisis"] is False


async def test_detect_crisis_fails_closed_when_gemini_unavailable():
    with patch(
        "app.services.crisis_detection.gemini_generate",
        side_effect=Exception("no credentials"),
    ):
        result = await detect_crisis("any message")
    assert result["is_crisis"] is True
    assert result["reason"] == "service_error"


async def test_detect_crisis_truncates_long_input():
    long_message = "x" * 5000
    captured: list[str] = []

    async def _capture(prompt: str, **kwargs) -> str:
        captured.append(prompt)
        return json.dumps({"is_crisis": False, "confidence": 0.5, "reason": "ok"})

    with patch("app.services.crisis_detection.gemini_generate", side_effect=_capture):
        await detect_crisis(long_message)

    assert len(captured) == 1
    assert long_message[:2000] in captured[0]
    assert long_message[2000:] not in captured[0]
