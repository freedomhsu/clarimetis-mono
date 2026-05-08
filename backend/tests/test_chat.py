"""Tests for app/routers/chat.py (send_message endpoint).

Coverage:
  - send_message_without_media: plain text message → 200, user msg committed
  - send_message_with_media_urls_are_stored_as_plain_strings: regression for
      the Pydantic Url / SQLAlchemy JSONB serialisation bug — media_urls must
      reach db.add() as list[str], not list[Url]
  - send_message_with_invalid_url_returns_422: non-URL value is rejected
  - send_message_free_user_passes_quota: free user within limit → 200
  - send_message_session_not_found_returns_404: wrong session_id → 404
  - stream_chat_response_passes_media_parts_to_gemini: regression for the bug
      where media_urls were accepted but never forwarded to the Gemini API
"""

import uuid
from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.database import get_db
from app.config import get_settings
from app.main import app
from app.middleware.subscription import check_message_quota, get_current_user
from app.models.message import Message
from tests.conftest import db_returning, make_session, make_user, make_message

_BASE = "/api/v1"


# ── Helpers ────────────────────────────────────────────────────────────────

def _override(user, db) -> None:
    # Override both get_current_user (used by _get_session) and
    # check_message_quota (used by send_message for quota enforcement).
    # FastAPI caches get_current_user per-request so a single call resolves both.
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[check_message_quota] = lambda: user
    app.dependency_overrides[get_db] = lambda: db


def _clear() -> None:
    app.dependency_overrides.clear()


def _make_db_for_session(session) -> AsyncMock:
    """Build a mock DB whose first .execute() returns the given session, subsequent
    calls return empty result sets (for history, embedding queries, etc.)."""
    session_result = MagicMock()
    session_result.scalar_one_or_none.return_value = session
    session_result.scalars.return_value.all.return_value = [session]

    empty_result = MagicMock()
    empty_result.scalar_one_or_none.return_value = None
    empty_result.scalars.return_value.all.return_value = []

    db = AsyncMock()
    # _get_session calls execute once; generate() calls it twice more (history + RAG);
    # provide extra empty slots so side_effect never runs out.
    db.execute.side_effect = [
        session_result,   # _get_session: ChatSession ownership lookup
        empty_result,     # generate(): message history
        empty_result,     # generate(): RAG / tier1 queries
        empty_result,     # spare
        empty_result,     # spare
    ]
    db.scalar.return_value = None
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    return db


async def _empty_stream(*args, **kwargs) -> AsyncGenerator[str, None]:
    """Stub for stream_chat_response — yields a single chunk."""
    yield "Hello!"


# ── Tests ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
@patch("app.routers.chat.stream_chat_response", side_effect=_empty_stream)
@patch("app.routers.chat.detect_crisis", new_callable=AsyncMock, return_value={"is_crisis": False})
@patch("app.routers.chat.classify_intent", new_callable=AsyncMock, return_value="general")
@patch("app.routers.chat.check_input", new_callable=AsyncMock, return_value={"safe": True})
@patch("app.routers.chat.get_user_profile_context", new_callable=AsyncMock, return_value="")
@patch("app.routers.chat.embed_text", new_callable=AsyncMock, return_value=[0.0])
async def test_send_message_without_media(
    _embed, _profile, _guardrail, _intent, _crisis, _stream
):
    user = make_user(subscription_tier="pro")
    session = make_session(user)
    db = _make_db_for_session(session)
    _override(user, db)
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                f"{_BASE}/sessions/{session.id}/messages",
                json={"content": "Hello"},
            )
        assert resp.status_code == 200
        # db.add should have been called once with a Message
        assert db.add.call_count == 1
        saved: Message = db.add.call_args[0][0]
        assert isinstance(saved, Message)
        assert saved.content == "Hello"
    finally:
        _clear()


@pytest.mark.asyncio
@patch("app.routers.chat.stream_chat_response", side_effect=_empty_stream)
@patch("app.routers.chat.detect_crisis", new_callable=AsyncMock, return_value={"is_crisis": False})
@patch("app.routers.chat.classify_intent", new_callable=AsyncMock, return_value="general")
@patch("app.routers.chat.check_input", new_callable=AsyncMock, return_value={"safe": True})
@patch("app.routers.chat.get_user_profile_context", new_callable=AsyncMock, return_value="")
@patch("app.routers.chat.embed_text", new_callable=AsyncMock, return_value=[0.0])
async def test_send_message_with_media_urls_are_stored_as_plain_strings(
    _embed, _profile, _guardrail, _intent, _crisis, _stream
):
    """Regression: Pydantic used to leave AnyHttpUrl Url objects in media_urls,
    causing SQLAlchemy's JSONB serialiser to raise TypeError."""
    user = make_user(subscription_tier="pro")
    session = make_session(user)
    db = _make_db_for_session(session)
    _override(user, db)
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                f"{_BASE}/sessions/{session.id}/messages",
                json={
                    "content": "Check this out",
                    "media_urls": [
                        "https://storage.googleapis.com/bucket/uploads/user_abc/photo.jpg"
                    ],
                },
            )
        assert resp.status_code == 200

        assert db.add.call_count == 1
        saved: Message = db.add.call_args[0][0]

        # The critical assertion: every item must be a plain str, not a Pydantic Url object.
        assert saved.media_urls is not None
        for url in saved.media_urls:
            assert type(url) is str, (
                f"media_urls must contain plain str, got {type(url).__name__}. "
                "This would cause SQLAlchemy JSONB serialisation to raise TypeError."
            )
    finally:
        _clear()


@pytest.mark.asyncio
async def test_send_message_with_invalid_url_returns_422():
    """Non-URL values in media_urls must be rejected at the schema layer."""
    user = make_user(subscription_tier="pro")
    session = make_session(user)
    db = _make_db_for_session(session)
    _override(user, db)
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                f"{_BASE}/sessions/{session.id}/messages",
                json={"content": "hi", "media_urls": ["not-a-url"]},
            )
        assert resp.status_code == 422
    finally:
        _clear()


@pytest.mark.asyncio
@patch("app.routers.chat.stream_chat_response", side_effect=_empty_stream)
@patch("app.routers.chat.detect_crisis", new_callable=AsyncMock, return_value={"is_crisis": False})
@patch("app.routers.chat.classify_intent", new_callable=AsyncMock, return_value="general")
@patch("app.routers.chat.check_input", new_callable=AsyncMock, return_value={"safe": True})
@patch("app.routers.chat.get_user_profile_context", new_callable=AsyncMock, return_value="")
@patch("app.routers.chat.embed_text", new_callable=AsyncMock, return_value=[0.0])
async def test_send_message_free_user_within_quota(
    _embed, _profile, _guardrail, _intent, _crisis, _stream
):
    """Free users within their quota should get a 200."""
    user = make_user(subscription_tier="free")
    session = make_session(user)
    db = _make_db_for_session(session)
    _override(user, db)
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                f"{_BASE}/sessions/{session.id}/messages",
                json={"content": "Hello from free tier"},
            )
        assert resp.status_code == 200
    finally:
        _clear()


@pytest.mark.asyncio
async def test_send_message_session_not_found_returns_404():
    """Sending to a non-existent session must return 404."""
    user = make_user(subscription_tier="pro")
    # db.execute returns None → session not found
    db = db_returning(None)
    _override(user, db)
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                f"{_BASE}/sessions/{uuid.uuid4()}/messages",
                json={"content": "Hello"},
            )
        assert resp.status_code == 404
    finally:
        _clear()


@pytest.mark.asyncio
async def test_stream_chat_response_passes_media_parts_to_gemini():
    """Regression: media_urls must be forwarded to the Gemini API as Part objects.

    Previously stream_chat_response accepted media_urls but never attached them
    to the parts list, so the model never saw the uploaded image/document.

    Tests three code paths:
    - PDF blob path with Document AI sidecar → Part.from_text with extracted text
    - Non-PDF blob path (image) → Part.from_uri with gs:// URI (no HTTP fetch)
    - legacy HTTPS URL → bytes fetched inline via urllib, Part.from_data
    """
    from app.services.gemini import stream_chat_response

    fake_bytes = b"\xff\xd8\xff" + b"\x00" * 100  # fake JPEG bytes

    def _fake_collect_stream() -> list[str]:
        return ["ok"]

    with patch("app.services.gemini.init_vertexai"):
        mock_chat = MagicMock()
        mock_model = MagicMock()
        mock_model.start_chat.return_value = mock_chat

        from vertexai.generative_models import Part
        uri_parts: list = []
        data_parts: list = []
        text_parts: list = []

        def _capture_from_uri(uri, mime_type):
            part = MagicMock()
            part._uri = uri
            part._mime = mime_type
            uri_parts.append(part)
            return part

        def _capture_from_data(data, mime_type):
            part = MagicMock()
            part._data = data
            part._mime = mime_type
            data_parts.append(part)
            return part

        def _capture_from_text(text):
            part = MagicMock()
            part._text = text
            text_parts.append(part)
            return part

        with (
            patch("app.services.gemini.GenerativeModel", return_value=mock_model),
            patch.object(Part, "from_uri", side_effect=_capture_from_uri),
            patch.object(Part, "from_data", side_effect=_capture_from_data),
            patch.object(Part, "from_text", side_effect=_capture_from_text),
            patch("app.services.gemini.asyncio.to_thread") as mock_to_thread,
            # PDF sidecar: return extracted text for the PDF blob path
            patch(
                "app.services.storage.download_text_sidecar",
                new=AsyncMock(return_value="Hemoglobin: 13.5 g/dL\nGlucose: 92 mg/dL"),
            ),
        ):
            async def _to_thread(fn, *args, **kwargs):
                return _fake_collect_stream()

            mock_to_thread.side_effect = _to_thread

            # --- Path 1: PDF blob with Document AI sidecar ---
            chunks = []
            async for chunk in stream_chat_response(
                user_message="What does my blood work show?",
                conversation_history=[],
                rag_context=[],
                media_urls=["uploads/user_abc/uuid_bloodwork.pdf"],
            ):
                chunks.append(chunk)

        # PDF with sidecar: Part.from_text must contain the extracted OCR content
        # (not Part.from_uri — we want the authoritative numbers, not Gemini's guess)
        pdf_text_parts = [p for p in text_parts if hasattr(p, "_text") and "Hemoglobin" in p._text]
        assert len(pdf_text_parts) == 1, (
            "Expected Document AI sidecar text to be forwarded for PDF. "
            f"text_parts: {[getattr(p, '_text', '')[:80] for p in text_parts]}"
        )
        assert len(uri_parts) == 0, "PDF with sidecar should NOT use gs:// URI"
        assert len(data_parts) == 0, "PDF with sidecar should NOT fetch bytes"

        # Reset captured parts
        uri_parts.clear(); data_parts.clear(); text_parts.clear()

        with (
            patch("app.services.gemini.GenerativeModel", return_value=mock_model),
            patch.object(Part, "from_uri", side_effect=_capture_from_uri),
            patch.object(Part, "from_data", side_effect=_capture_from_data),
            patch.object(Part, "from_text", side_effect=_capture_from_text),
            patch("app.services.gemini.asyncio.to_thread") as mock_to_thread,
        ):
            async def _to_thread2(fn, *args, **kwargs):
                return _fake_collect_stream()

            mock_to_thread.side_effect = _to_thread2

            # --- Path 2: image blob path, no sidecar → gs:// URI, no fetch ---
            async for _ in stream_chat_response(
                user_message="Can you see this?",
                conversation_history=[],
                rag_context=[],
                media_urls=["uploads/user_abc/uuid_photo.jpg"],
            ):
                pass

        assert len(uri_parts) == 1, f"Expected Part.from_uri for image blob path, got {len(uri_parts)}"
        assert uri_parts[0]._uri.startswith("gs://"), uri_parts[0]._uri
        assert "uploads/user_abc/uuid_photo.jpg" in uri_parts[0]._uri
        assert uri_parts[0]._mime == "image/jpeg"
        assert len(data_parts) == 0, "Unexpected byte-fetch for image blob path"


@pytest.mark.asyncio
async def test_stream_chat_response_uses_image_sidecar_when_available():
    """Image blob paths with a Document AI sidecar (photo of a lab report) must
    use the extracted text rather than the raw image URI, same as PDFs."""
    from app.services.gemini import stream_chat_response

    def _fake_collect_stream() -> list[str]:
        return ["ok"]

    with patch("app.services.gemini.init_vertexai"):
        mock_chat = MagicMock()
        mock_model = MagicMock()
        mock_model.start_chat.return_value = mock_chat

        from vertexai.generative_models import Part
        uri_parts: list = []
        text_parts: list = []

        def _capture_from_uri(uri, mime_type):
            part = MagicMock(); part._uri = uri; uri_parts.append(part); return part

        def _capture_from_text(text):
            part = MagicMock(); part._text = text; text_parts.append(part); return part

        with (
            patch("app.services.gemini.GenerativeModel", return_value=mock_model),
            patch.object(Part, "from_uri", side_effect=_capture_from_uri),
            patch.object(Part, "from_text", side_effect=_capture_from_text),
            patch("app.services.gemini.asyncio.to_thread", side_effect=AsyncMock(return_value=_fake_collect_stream())),
            # Sidecar present for this image — simulates a photographed lab report
            patch(
                "app.services.storage.download_text_sidecar",
                new=AsyncMock(return_value="WBC: 6.2 K/uL\nRBC: 4.7 M/uL\nHemoglobin: 14.1 g/dL"),
            ),
        ):
            async for _ in stream_chat_response(
                user_message="What do my blood results show?",
                conversation_history=[],
                rag_context=[],
                media_urls=["uploads/user_abc/uuid_labphoto.jpg"],
            ):
                pass

    # Image with sidecar: authoritative OCR text must be used, not the image URI
    sidecar_text_parts = [p for p in text_parts if hasattr(p, "_text") and "WBC" in p._text]
    assert len(sidecar_text_parts) == 1, (
        "Expected Document AI sidecar text for image-of-document. "
        f"text_parts: {[getattr(p, '_text', '')[:80] for p in text_parts]}"
    )
    assert len(uri_parts) == 0, "Image with sidecar must NOT fall back to gs:// URI"


# ── ChatRequest schema ─────────────────────────────────────────────────────
# These run without any DB or HTTP client — they test the Pydantic model layer.

from pydantic import ValidationError  # noqa: E402
from app.schemas.chat import ChatRequest  # noqa: E402


def test_chat_request_accepts_gcs_blob_path():
    req = ChatRequest(content="look at this", media_urls=["uploads/user_abc/uuid_photo.jpg"])
    assert req.media_urls == ["uploads/user_abc/uuid_photo.jpg"]


def test_chat_request_accepts_https_url():
    url = "https://storage.googleapis.com/bucket/uploads/user_abc/file.jpg"
    req = ChatRequest(content="look", media_urls=[url])
    assert req.media_urls == [url]


def test_chat_request_rejects_http_url_ssrf():
    """Plain http:// must be rejected — only https:// passes the SSRF guard."""
    with pytest.raises(ValidationError):
        ChatRequest(content="hi", media_urls=["http://evil.com/file.jpg"])


def test_chat_request_rejects_ftp_scheme():
    with pytest.raises(ValidationError):
        ChatRequest(content="hi", media_urls=["ftp://server.com/file.pdf"])


def test_chat_request_rejects_javascript_scheme():
    with pytest.raises(ValidationError):
        ChatRequest(content="hi", media_urls=["javascript:alert(1)"])


def test_chat_request_media_only_without_content_is_valid():
    """Regression for Bug 3: media-only sends (empty content + media_urls) must be
    accepted.  Before the schema fix, content required min_length=1 and rejected
    these requests with 422."""
    req = ChatRequest(media_urls=["uploads/user_abc/uuid_photo.jpg"])
    assert req.content == ""
    assert req.media_urls == ["uploads/user_abc/uuid_photo.jpg"]


def test_chat_request_no_content_and_no_media_is_invalid():
    """An empty ChatRequest body must be rejected by the require_content_or_media validator."""
    with pytest.raises(ValidationError, match="Either content or media_urls must be provided"):
        ChatRequest()


def test_chat_request_whitespace_only_content_no_media_is_invalid():
    """Whitespace-only content with no media_urls must be rejected (content.strip() == "")."""
    with pytest.raises(ValidationError, match="Either content or media_urls must be provided"):
        ChatRequest(content="   ")


# ── send_message — additional integration paths ────────────────────────────


async def test_send_message_media_only_no_content_returns_200():
    """Regression for Bug 3: a request with no text content but valid media_urls must
    reach the router and return 200 (not 422 from the schema layer)."""
    user = make_user(subscription_tier="pro")
    session = make_session(user)
    db = _make_db_for_session(session)
    _override(user, db)
    try:
        with (
            patch("app.routers.chat.stream_chat_response", side_effect=_empty_stream),
            patch("app.routers.chat.detect_crisis", new_callable=AsyncMock, return_value={"is_crisis": False}),
            patch("app.routers.chat.classify_intent", new_callable=AsyncMock, return_value="general"),
            patch("app.routers.chat.check_input", new_callable=AsyncMock, return_value={"safe": True}),
            patch("app.routers.chat.get_user_profile_context", new_callable=AsyncMock, return_value=""),
            patch("app.routers.chat.embed_text", new_callable=AsyncMock, return_value=[0.0]),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.post(
                    f"{_BASE}/sessions/{session.id}/messages",
                    json={"media_urls": ["uploads/user_abc/uuid_photo.jpg"]},
                )
        assert resp.status_code == 200
        # The user message must have been saved with the blob path intact
        assert db.add.call_count == 1
        saved: Message = db.add.call_args[0][0]
        assert saved.media_urls == ["uploads/user_abc/uuid_photo.jpg"]
    finally:
        _clear()


async def test_send_message_no_content_and_no_media_returns_422():
    """An empty body must be rejected at the schema layer (422) — no service calls made."""
    user = make_user(subscription_tier="pro")
    session = make_session(user)
    db = _make_db_for_session(session)
    _override(user, db)
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                f"{_BASE}/sessions/{session.id}/messages",
                json={},
            )
        assert resp.status_code == 422
        # Schema rejected the request — no DB writes should have happened
        db.add.assert_not_called()
    finally:
        _clear()


async def test_send_message_crisis_detected_prepends_banner_and_saves_crisis_flagged_message():
    """When detect_crisis returns is_crisis=True:
      - the stream contains the \x00CRISIS\x00 sentinel (frontend shows <CrisisBanner />)
      - the user message is committed to DB with crisis_flagged=True
    """
    user = make_user(subscription_tier="pro")
    session = make_session(user)
    db = _make_db_for_session(session)
    _override(user, db)
    try:
        with (
            patch("app.routers.chat.stream_chat_response", side_effect=_empty_stream),
            patch("app.routers.chat.detect_crisis", new_callable=AsyncMock, return_value={"is_crisis": True}),
            patch("app.routers.chat.classify_intent", new_callable=AsyncMock, return_value="general"),
            patch("app.routers.chat.check_input", new_callable=AsyncMock, return_value={"safe": True}),
            patch("app.routers.chat.get_user_profile_context", new_callable=AsyncMock, return_value=""),
            patch("app.routers.chat.embed_text", new_callable=AsyncMock, return_value=[0.0]),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.post(
                    f"{_BASE}/sessions/{session.id}/messages",
                    json={"content": "I want to end my life"},
                )
        assert resp.status_code == 200
        # The stream must contain the CRISIS sentinel so the frontend shows <CrisisBanner />.
        assert "\x00CRISIS\x00" in resp.text
        # The user message must be stored with the crisis flag set
        assert db.add.call_count == 1
        saved: Message = db.add.call_args[0][0]
        assert saved.crisis_flagged is True
    finally:
        _clear()


async def test_send_message_guardrail_redirect_streams_text_and_saves_assistant_message():
    """Regression for Bug 2: when check_input returns safe=False with a redirect,
    the redirect text must be:
      (a) streamed back to the client, AND
      (b) scheduled via _save_assistant_message so it persists across page reloads.

    Before the fix, _save_assistant_message was never called for redirected requests,
    causing the message to vanish when loadMessages() refreshed 600 ms after streaming.
    """
    redirect_text = (
        "I hear that you're dealing with something health-related, and I want to support you."
    )
    user = make_user(subscription_tier="pro")
    session = make_session(user)
    db = _make_db_for_session(session)
    _override(user, db)
    try:
        with (
            patch("app.routers.chat.detect_crisis", new_callable=AsyncMock, return_value={"is_crisis": False}),
            patch("app.routers.chat.classify_intent", new_callable=AsyncMock, return_value="general"),
            patch("app.routers.chat.check_input", new_callable=AsyncMock, return_value={
                "safe": False, "redirect": redirect_text,
            }),
            patch("app.routers.chat.get_user_profile_context", new_callable=AsyncMock, return_value=""),
            patch("app.routers.chat.embed_text", new_callable=AsyncMock, return_value=[0.0]),
            patch("app.routers.chat._save_assistant_message", new_callable=AsyncMock) as mock_save,
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.post(
                    f"{_BASE}/sessions/{session.id}/messages",
                    json={"content": "What medication should I take for anxiety?"},
                )
        assert resp.status_code == 200
        assert redirect_text in resp.text

        # The user message must be saved (quota counting depends on it)
        assert db.add.call_count == 1
        saved_user: Message = db.add.call_args[0][0]
        assert saved_user.role == "user"

        # The redirect must be scheduled for persistence as an assistant message.
        # This is the regression check: before the Bug 2 fix this was never called.
        mock_save.assert_called_once()
        save_args = mock_save.call_args[0]
        assert save_args[0] == session.id
        assert save_args[1] == redirect_text
    finally:
        _clear()


# ── get_messages ───────────────────────────────────────────────────────────


def _make_db_for_get_messages(session, messages: list) -> AsyncMock:
    """DB mock for GET requests: first execute resolves the session, second returns messages."""
    session_result = MagicMock()
    session_result.scalar_one_or_none.return_value = session

    msgs_result = MagicMock()
    msgs_result.scalars.return_value.all.return_value = messages

    db = AsyncMock()
    db.execute.side_effect = [session_result, msgs_result]
    db.scalar.return_value = None
    return db


async def test_get_messages_returns_message_list_for_own_session():
    user = make_user(subscription_tier="pro")
    session = make_session(user)
    msg = make_message(session, role="user", content="Hello there")
    db = _make_db_for_get_messages(session, [msg])
    _override(user, db)
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(f"{_BASE}/sessions/{session.id}/messages")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["content"] == "Hello there"
        assert data[0]["role"] == "user"
    finally:
        _clear()


async def test_get_messages_returns_404_for_unknown_session():
    user = make_user(subscription_tier="pro")
    not_found = MagicMock()
    not_found.scalar_one_or_none.return_value = None  # session not found
    db = AsyncMock()
    db.execute.return_value = not_found
    _override(user, db)
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(f"{_BASE}/sessions/{uuid.uuid4()}/messages")
        assert resp.status_code == 404
    finally:
        _clear()


async def test_get_messages_resigns_gcs_blob_paths_in_media_urls():
    """Blob paths in message.media_urls must be replaced with fresh signed URLs
    before serialisation so the client always receives a non-expired HTTPS URL."""
    user = make_user(subscription_tier="pro")
    session = make_session(user)
    msg = make_message(session, role="user", content="Photo message")
    msg.media_urls = ["uploads/user_abc/uuid_photo.jpg"]

    db = _make_db_for_get_messages(session, [msg])
    _override(user, db)

    signed_url = (
        "https://storage.googleapis.com/bucket/uploads/user_abc/uuid_photo.jpg"
        "?X-Goog-Signature=abc123"
    )
    try:
        with patch(
            "app.routers.chat.sign_blob_path",
            new=AsyncMock(return_value=signed_url),
        ) as mock_sign:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.get(f"{_BASE}/sessions/{session.id}/messages")

        assert resp.status_code == 200
        data = resp.json()
        assert data[0]["media_urls"] == [signed_url]
        # sign_blob_path must have been called with the original blob path
        mock_sign.assert_called_once_with("uploads/user_abc/uuid_photo.jpg")
    finally:
        _clear()


# ── Model selection: free vs pro ───────────────────────────────────────────

def _make_chat_settings() -> MagicMock:
    """Minimal Settings mock that satisfies all fields accessed by send_message."""
    s = MagicMock()
    s.gemini_flash_model = "gemini-2.5-flash"
    s.gemini_pro_model = "gemini-2.5-pro"
    s.crisis_banner_text = "Crisis banner\n\n"
    s.chat_history_limit = 40
    return s


async def test_send_message_free_user_uses_flash_model():
    """Free-tier users must be served by the faster/cheaper flash model."""
    user = make_user(subscription_tier="free")
    session = make_session(user)
    db = _make_db_for_session(session)

    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[check_message_quota] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_settings] = lambda: _make_chat_settings()
    try:
        with (
            patch("app.routers.chat.stream_chat_response", side_effect=_empty_stream) as mock_stream,
            patch("app.routers.chat.detect_crisis", new_callable=AsyncMock, return_value={"is_crisis": False}),
            patch("app.routers.chat.classify_intent", new_callable=AsyncMock, return_value="general"),
            patch("app.routers.chat.check_input", new_callable=AsyncMock, return_value={"safe": True}),
            patch("app.routers.chat.get_user_profile_context", new_callable=AsyncMock, return_value=""),
            patch("app.routers.chat.embed_text", new_callable=AsyncMock, return_value=[0.0]),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.post(
                    f"{_BASE}/sessions/{session.id}/messages",
                    json={"content": "Hello"},
                )
        assert resp.status_code == 200
        mock_stream.assert_called_once()
        assert mock_stream.call_args.kwargs["model_name"] == "gemini-2.5-flash", (
            "Free users must use gemini_flash_model, not gemini_pro_model"
        )
    finally:
        _clear()


async def test_send_message_pro_user_uses_pro_model():
    """Pro-tier users must be served by the more capable pro model."""
    user = make_user(subscription_tier="pro")
    session = make_session(user)
    db = _make_db_for_session(session)

    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[check_message_quota] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_settings] = lambda: _make_chat_settings()
    try:
        with (
            patch("app.routers.chat.stream_chat_response", side_effect=_empty_stream) as mock_stream,
            patch("app.routers.chat.detect_crisis", new_callable=AsyncMock, return_value={"is_crisis": False}),
            patch("app.routers.chat.classify_intent", new_callable=AsyncMock, return_value="general"),
            patch("app.routers.chat.check_input", new_callable=AsyncMock, return_value={"safe": True}),
            patch("app.routers.chat.get_user_profile_context", new_callable=AsyncMock, return_value=""),
            patch("app.routers.chat.embed_text", new_callable=AsyncMock, return_value=[0.0]),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.post(
                    f"{_BASE}/sessions/{session.id}/messages",
                    json={"content": "Hello"},
                )
        assert resp.status_code == 200
        mock_stream.assert_called_once()
        assert mock_stream.call_args.kwargs["model_name"] == "gemini-2.5-pro", (
            "Pro users must use gemini_pro_model, not gemini_flash_model"
        )
    finally:
        _clear()

