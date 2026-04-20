"""Tests for app/services/crisis_detection.py

Covers:
  - Valid JSON response with is_crisis=True is parsed and returned
  - Valid JSON response with is_crisis=False is parsed and returned
  - Unparseable Gemini response → fail-safe {"is_crisis": True}
  - Gemini call fails entirely → dev fallback {"is_crisis": False}
  - Input is truncated to 2000 chars before being sent to the model
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.crisis_detection import detect_crisis


def _mock_model(response_text: str) -> MagicMock:
    """Return a mock GenerativeModel whose generate_content() returns response_text."""
    response = MagicMock()
    response.text = response_text
    model = MagicMock()
    model.generate_content.return_value = response
    return model


# ── Happy path ─────────────────────────────────────────────────────────────

async def test_detect_crisis_returns_true_for_crisis_message():
    model = _mock_model('{"is_crisis": true, "confidence": 0.95, "reason": "suicidal ideation"}')

    with patch("app.services.crisis_detection.GenerativeModel", return_value=model):
        result = await detect_crisis("I want to end my life")

    assert result["is_crisis"] is True
    assert result["confidence"] == 0.95


async def test_detect_crisis_returns_false_for_safe_message():
    model = _mock_model('{"is_crisis": false, "confidence": 0.99, "reason": "no threat"}')

    with patch("app.services.crisis_detection.GenerativeModel", return_value=model):
        result = await detect_crisis("I had a great day today")

    assert result["is_crisis"] is False


# ── Fail-safe: parse error ─────────────────────────────────────────────────

async def test_detect_crisis_fails_safe_on_invalid_json():
    """If Gemini returns non-JSON, treat it conservatively as a crisis."""
    model = _mock_model("Sorry, I cannot answer that.")

    with patch("app.services.crisis_detection.GenerativeModel", return_value=model):
        result = await detect_crisis("some message")

    assert result["is_crisis"] is True
    assert result["reason"] == "parse_error"


async def test_detect_crisis_fails_safe_on_markdown_wrapped_json():
    """strip_markdown_json should handle ```json ... ``` wrappers."""
    model = _mock_model('```json\n{"is_crisis": false, "confidence": 0.9, "reason": "ok"}\n```')

    with patch("app.services.crisis_detection.GenerativeModel", return_value=model):
        result = await detect_crisis("I feel fine")

    assert result["is_crisis"] is False


# ── Fail-safe: Gemini unavailable ─────────────────────────────────────────

async def test_detect_crisis_fails_closed_when_gemini_unavailable():
    """If the Gemini call throws, we fail **closed** — treat as potential crisis.

    It is safer to surface the crisis banner unnecessarily than to silently
    miss a real crisis because of a transient service error.
    """
    with patch("app.services.crisis_detection.GenerativeModel", side_effect=Exception("no credentials")):
        result = await detect_crisis("any message")

    assert result["is_crisis"] is True
    assert result["reason"] == "service_error"


# ── Input truncation ───────────────────────────────────────────────────────

async def test_detect_crisis_truncates_long_input():
    """Messages longer than 2000 chars are truncated before being sent."""
    long_message = "x" * 5000
    captured_prompt: list[str] = []

    response = MagicMock()
    response.text = '{"is_crisis": false, "confidence": 0.5, "reason": "ok"}'

    model = MagicMock()

    def capture_call(prompt):
        captured_prompt.append(prompt)
        return response

    model.generate_content.side_effect = capture_call

    with patch("app.services.crisis_detection.GenerativeModel", return_value=model):
        await detect_crisis(long_message)

    assert len(captured_prompt) == 1
    # The user content embedded in the prompt must not exceed 2000 chars
    assert long_message[:2000] in captured_prompt[0]
    assert long_message[2000:] not in captured_prompt[0]
