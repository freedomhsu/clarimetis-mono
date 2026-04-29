"""Tests for app/services/guardrails.py

Covers:
  - check_input: get_settings is importable and callable (regression for missing import)
  - check_input: safe message returns safe=True
  - check_input: out-of-scope message returns safe=False with redirect
  - check_input: unparseable response fails open (safe=True)
  - check_input: model exception fails open (safe=True)
  - check_output: safe response returns safe=True
  - check_output: unsafe response logs a warning and returns safe=False
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.guardrails import check_input, check_output


def _mock_model(response_text: str) -> MagicMock:
    response = MagicMock()
    response.text = response_text
    model = MagicMock()
    model.generate_content.return_value = response
    return model


# ── Regression: missing get_settings import ────────────────────────────────

def test_get_settings_importable_from_guardrails():
    """get_settings must be importable from guardrails (regression: was missing)."""
    import app.services.guardrails as gmod
    assert hasattr(gmod, "get_settings"), (
        "get_settings is not defined in guardrails module — missing import"
    )
    # Must be callable without raising NameError
    gmod.get_settings()


# ── check_input ────────────────────────────────────────────────────────────

async def test_check_input_safe_message():
    model = _mock_model('{"category": "safe", "confidence": 0.99, "reason": "normal coaching"}')

    with patch("app.services.guardrails.GenerativeModel", return_value=model), \
         patch("app.services.guardrails.init_vertexai"):
        result = await check_input("I've been feeling really anxious lately")

    assert result["safe"] is True
    assert result["category"] == "safe"
    assert result["redirect"] is None


async def test_check_input_medical_advice_blocked():
    model = _mock_model('{"category": "medical_advice", "confidence": 0.92, "reason": "asking for diagnosis"}')

    with patch("app.services.guardrails.GenerativeModel", return_value=model), \
         patch("app.services.guardrails.init_vertexai"):
        result = await check_input("What medication should I take for depression?")

    assert result["safe"] is False
    assert result["category"] == "medical_advice"
    assert result["redirect"] is not None


async def test_check_input_unparseable_response_fails_open():
    model = _mock_model("sorry I cannot classify this")

    with patch("app.services.guardrails.GenerativeModel", return_value=model), \
         patch("app.services.guardrails.init_vertexai"):
        result = await check_input("some message")

    assert result["safe"] is True


async def test_check_input_model_exception_fails_open():
    model = MagicMock()
    model.generate_content.side_effect = RuntimeError("gRPC error")

    with patch("app.services.guardrails.GenerativeModel", return_value=model), \
         patch("app.services.guardrails.init_vertexai"):
        result = await check_input("some message")

    assert result["safe"] is True


# ── check_output ───────────────────────────────────────────────────────────

async def test_check_output_safe_response():
    model = _mock_model('{"safe": true, "flags": [], "reason": "no issues"}')

    with patch("app.services.guardrails.GenerativeModel", return_value=model), \
         patch("app.services.guardrails.init_vertexai"):
        result = await check_output("Here is some coaching advice.", session_id="sess_1")

    assert result["safe"] is True


async def test_check_output_unsafe_response_logs_warning(caplog):
    import logging
    model = _mock_model('{"safe": false, "flags": ["harmful_content"], "reason": "dangerous advice"}')

    with patch("app.services.guardrails.GenerativeModel", return_value=model), \
         patch("app.services.guardrails.init_vertexai"), \
         caplog.at_level(logging.WARNING, logger="app.services.guardrails"):
        result = await check_output("You should hurt yourself.", session_id="sess_2")

    assert result["safe"] is False
    assert any("unsafe" in r.message for r in caplog.records)
