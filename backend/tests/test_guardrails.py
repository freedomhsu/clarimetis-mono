import json
from unittest.mock import AsyncMock, patch

import pytest

from app.services.guardrails import check_input, check_output


def test_gemini_generate_importable_from_guardrails():
    import app.services.guardrails as gmod
    assert hasattr(gmod, "gemini_generate")


async def test_check_input_safe_message():
    rv = json.dumps({"category": "safe", "confidence": 0.99, "reason": "normal coaching"})
    with patch(
        "app.services.guardrails.gemini_generate",
        new_callable=AsyncMock,
        return_value=rv,
    ):
        result = await check_input("I have been feeling anxious lately")
    assert result["safe"] is True
    assert result["redirect"] is None


async def test_check_input_medical_advice_blocked():
    rv = json.dumps({"category": "medical_advice", "confidence": 0.92, "reason": "diagnosis"})
    with patch(
        "app.services.guardrails.gemini_generate",
        new_callable=AsyncMock,
        return_value=rv,
    ):
        result = await check_input("What medication for depression?")
    assert result["safe"] is False
    assert result["redirect"] is not None


async def test_check_input_unparseable_response_fails_open():
    with patch(
        "app.services.guardrails.gemini_generate",
        new_callable=AsyncMock,
        return_value="sorry cannot classify",
    ):
        result = await check_input("some message")
    assert result["safe"] is True


async def test_check_input_model_exception_fails_open():
    with patch(
        "app.services.guardrails.gemini_generate",
        side_effect=RuntimeError("gRPC error"),
    ):
        result = await check_input("some message")
    assert result["safe"] is True


async def test_check_input_low_confidence_redirect_ignored():
    rv = json.dumps({"category": "medical_advice", "confidence": 0.60, "reason": "ambiguous"})
    with patch(
        "app.services.guardrails.gemini_generate",
        new_callable=AsyncMock,
        return_value=rv,
    ):
        result = await check_input("I have headaches")
    assert result["safe"] is True


async def test_check_input_figurative_harm_below_threshold_is_safe():
    rv = json.dumps({"category": "harm_to_others", "confidence": 0.70, "reason": "figurative"})
    with patch(
        "app.services.guardrails.gemini_generate",
        new_callable=AsyncMock,
        return_value=rv,
    ):
        result = await check_input("I could kill my boss")
    assert result["safe"] is True


async def test_check_input_high_confidence_harm_to_others_blocked():
    rv = json.dumps({"category": "harm_to_others", "confidence": 0.95, "reason": "specific threat"})
    with patch(
        "app.services.guardrails.gemini_generate",
        new_callable=AsyncMock,
        return_value=rv,
    ):
        result = await check_input("I have a knife and plan to hurt my neighbour")
    assert result["safe"] is False
    assert "988" in result["redirect"]


async def test_check_output_safe_response():
    rv = json.dumps({"safe": True, "flags": [], "reason": "no issues"})
    with patch(
        "app.services.guardrails.gemini_generate",
        new_callable=AsyncMock,
        return_value=rv,
    ):
        result = await check_output("Good coaching advice.", session_id="sess_1")
    assert result["safe"] is True


async def test_check_output_unsafe_response_logs_warning(caplog):
    import logging
    rv = json.dumps({"safe": False, "flags": ["harmful_content"], "reason": "dangerous"})
    with patch(
        "app.services.guardrails.gemini_generate",
        new_callable=AsyncMock,
        return_value=rv,
    ), patch(
        "app.services.alerting.send_guardrail_alert",
        new_callable=AsyncMock,
    ), caplog.at_level(logging.WARNING, logger="app.services.guardrails"):
        result = await check_output("Harmful content.", session_id="sess_2")
    assert result["safe"] is False
    assert "harmful_content" in result["flags"]
