"""Tests for app/services/gemini.py

Covers:
  - stream_chat_response yields chunks from model on normal response
  - stream_chat_response does NOT raise when model returns MAX_TOKENS finish reason
    (ResponseValidationError regression — response_validation=False required)
  - stream_chat_response yields empty output (not raises) when model returns no text chunks
  - stream_chat_response yields timeout message on asyncio.TimeoutError
"""

from unittest.mock import MagicMock, patch

import pytest

from app.services.gemini import stream_chat_response


def _make_chunk(text: str | None) -> MagicMock:
    chunk = MagicMock()
    chunk.text = text
    return chunk


def _mock_chat(chunks: list[MagicMock]) -> MagicMock:
    """Build a mock model whose start_chat().send_message() iterates over chunks."""
    chat = MagicMock()
    chat.send_message.return_value = iter(chunks)
    model = MagicMock()
    model.start_chat.return_value = chat
    return model


async def _collect(gen) -> list[str]:
    return [chunk async for chunk in gen]


# ── Normal streaming ───────────────────────────────────────────────────────

async def test_stream_chat_response_yields_chunks():
    model = _mock_chat([_make_chunk("Hello"), _make_chunk(" there")])

    async def _fake_to_thread(fn, *args, **kwargs):
        return fn()

    with patch("app.services.gemini.GenerativeModel", return_value=model), \
         patch("app.services.gemini.init_vertexai"), \
         patch("app.services.gemini.asyncio.to_thread", side_effect=_fake_to_thread), \
         patch("app.services.gemini.get_settings") as mock_settings:
        mock_settings.return_value.gemini_pro_model = "gemini-2.5-pro"
        mock_settings.return_value.gemini_stream_timeout = 30.0
        mock_settings.return_value.gemini_temperature = 0.7
        mock_settings.return_value.gemini_max_output_tokens = 8192
        result = await _collect(stream_chat_response("Hi", [], []))

    assert result == ["Hello", " there"]


# ── MAX_TOKENS regression ──────────────────────────────────────────────────

async def test_stream_chat_response_does_not_raise_on_max_tokens():
    """ResponseValidationError (finish_reason=MAX_TOKENS) must not propagate.

    This is the regression introduced by response_validation=True (the default).
    The fix is start_chat(response_validation=False).
    """
    from vertexai.generative_models import _generative_models  # noqa: F401 — stubbed in conftest

    # Simulate: first chunk returns text, second raises ResponseValidationError
    good_chunk = _make_chunk("Partial response")

    def _raising_iter(*args, **kwargs):
        yield good_chunk
        exc_cls = type(
            "ResponseValidationError",
            (Exception,),
            {},
        )
        raise exc_cls("Finish reason: 2 (MAX_TOKENS)")

    chat = MagicMock()
    chat.send_message.side_effect = _raising_iter
    model = MagicMock()
    model.start_chat.return_value = chat

    with patch("app.services.gemini.GenerativeModel", return_value=model), \
         patch("app.services.gemini.init_vertexai"), \
         patch("app.services.gemini.get_settings") as mock_settings:
        mock_settings.return_value.gemini_pro_model = "gemini-2.5-pro"
        # Must not raise — should return whatever chunks arrived before the error
        try:
            result = await _collect(stream_chat_response("Long message", [], []))
        except Exception as exc:
            pytest.fail(f"stream_chat_response raised unexpectedly: {exc}")


# ── Empty response ─────────────────────────────────────────────────────────

async def test_stream_chat_response_empty_chunks():
    """Chunks with no text (None) are filtered out — yields nothing, does not raise."""
    model = _mock_chat([_make_chunk(None), _make_chunk(None)])

    with patch("app.services.gemini.GenerativeModel", return_value=model), \
         patch("app.services.gemini.init_vertexai"), \
         patch("app.services.gemini.get_settings") as mock_settings:
        mock_settings.return_value.gemini_pro_model = "gemini-2.5-pro"
        mock_settings.return_value.gemini_stream_timeout = 30.0
        mock_settings.return_value.gemini_temperature = 0.7
        mock_settings.return_value.gemini_max_output_tokens = 8192
        result = await _collect(stream_chat_response("Hi", [], []))

    assert result == []


# ── Timeout ────────────────────────────────────────────────────────────────

async def test_stream_chat_response_timeout_yields_error_message():
    import asyncio

    async def _timeout(*args, **kwargs):
        raise asyncio.TimeoutError()

    model = _mock_chat([])

    with patch("app.services.gemini.GenerativeModel", return_value=model), \
         patch("app.services.gemini.init_vertexai"), \
         patch("app.services.gemini.asyncio.wait_for", side_effect=_timeout), \
         patch("app.services.gemini.get_settings") as mock_settings:
        mock_settings.return_value.gemini_pro_model = "gemini-2.5-pro"
        result = await _collect(stream_chat_response("Hi", [], []))

    assert any("try again" in c.lower() for c in result), \
        f"Expected timeout message in output, got: {result}"
