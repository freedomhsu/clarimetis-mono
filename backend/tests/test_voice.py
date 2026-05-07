"""Backend unit tests for voice features.

Coverage
────────
voice_service.py — pure functions (no I/O, no mocks needed)
  strip_markdown_for_tts:
    - fenced code blocks removed
    - inline code removed
    - bold / italic / combined emphasis stripped
    - ATX headings removed
    - unordered list markers removed
    - blockquotes removed
    - horizontal rules removed
    - markdown links replaced with link text
    - extra blank lines collapsed
    - plain prose unchanged

  truncate_for_tts:
    - short text returned unchanged
    - text at exactly max_bytes returned unchanged
    - long ASCII text truncated to max_bytes
    - UTF-8 multi-byte characters handled without splitting mid-codepoint

voice_service.py — async functions (GCP clients mocked via patch)
  transcribe_audio:
    - WebM audio → WEBM_OPUS encoding, 48 000 Hz sample rate
    - video/webm (filetype quirk) → same WEBM_OPUS path
    - OGG audio → OGG_OPUS encoding
    - WAV audio → LINEAR16 encoding
    - MP3 audio → MP3 encoding
    - audio/mp4 (Safari) → ENCODING_UNSPECIFIED, no sample_rate_hertz sent
    - video/mp4 (Safari filetype quirk) → same ENCODING_UNSPECIFIED path
    - unknown MIME type falls back to WEBM_OPUS / 48 000 Hz
    - multiple alternatives joined with a space
    - empty results return empty string

  synthesize_speech:
    - returns audio_content bytes from TTS response
    - MP3 encoding requested
    - speaking_rate and pitch forwarded correctly

app/routers/voice.py — HTTP endpoints (all external calls mocked)
  POST /voice/transcribe:
    - 200 with transcript for a valid upload
    - 400 when magic bytes are not recognised audio
    - 413 when upload exceeds max_voice_bytes
    - 402 when user is not pro tier
    - empty transcript still returns 200 (transcribe endpoint has no silence guard)

  POST /voice/conversation/{session_id}:
    - 200 with user_transcript / assistant_text / audio_data / crisis_flagged
    - crisis_flagged=True included in response when crisis detected
    - guardrail redirect short-circuits Gemini + returns redirect text as audio
    - 422 when transcript is blank / silent
    - 400 when audio MIME type is unsupported
    - 413 when upload exceeds size limit
    - 402 when user is not pro tier
    - 404 when session_id does not belong to user
    - audio_data is a valid base64 data URI with data:audio/mpeg prefix
    - session title updated as background task when title is "New Session"
    - session title NOT updated when title already customised
"""

import base64
import io
import struct
import sys
import uuid
from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.database import get_db
from app.main import app
from app.middleware.subscription import get_current_user, require_pro
from app.services.voice_service import strip_markdown_for_tts, truncate_for_tts
from tests.conftest import make_session, make_user

# Grab the GCP stub modules that conftest registered before any app imports.
# MagicMock remembers attribute-access chains, so accessing `.WEBM_OPUS` here
# returns the exact same object that voice_service.py stored in _SPEECH_ENCODING_MAP
# at import time — making identity comparisons reliable.
_speech_stub = sys.modules["google.cloud.speech"]
_tts_stub = sys.modules["google.cloud.texttospeech"]

_BASE = "/api/v1"

# ── Minimal audio fixtures ────────────────────────────────────────────────────

def _silent_wav_bytes() -> bytes:
    """46-byte WAV with one silent sample.

    filetype.guess() detects this as ``audio/x-wav`` (not ``audio/wav``), which
    is why voice_service.ALLOWED_AUDIO_TYPES includes both spellings.
    """
    buf = io.BytesIO()
    buf.write(b"RIFF")
    buf.write(struct.pack("<I", 38))
    buf.write(b"WAVE")
    buf.write(b"fmt ")
    buf.write(struct.pack("<IHHIIHH", 16, 1, 1, 16000, 32000, 2, 16))
    buf.write(b"data")
    buf.write(struct.pack("<I", 2))
    buf.write(struct.pack("<h", 0))
    return buf.getvalue()


def _webm_magic() -> bytes:
    """EBML / WebM magic bytes (first 4 bytes are 0x1A 0x45 0xDF 0xA3)."""
    return bytes([0x1A, 0x45, 0xDF, 0xA3]) + b"\x00" * 64


def _mp3_magic() -> bytes:
    """ID3v2 header — recognised as audio/mpeg by filetype."""
    return b"ID3" + b"\x03\x00\x00" + b"\x00" * 60


def _mp4_magic() -> bytes:
    """Minimal ftyp box — recognised as video/mp4 or audio/mp4 by filetype."""
    return struct.pack(">I", 20) + b"ftyp" + b"mp42" + b"\x00" * 8


# ── Helpers for test client setup ─────────────────────────────────────────────

def _override_pro(user, db) -> None:
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[require_pro] = lambda: user
    app.dependency_overrides[get_db] = lambda: db


def _override_free(user, db) -> None:
    """Free user — require_pro will raise 402."""
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db


def _clear() -> None:
    app.dependency_overrides.clear()


def _db_with_session(session) -> AsyncMock:
    """DB mock whose first execute() returns the given session."""
    session_result = MagicMock()
    session_result.scalar_one_or_none.return_value = session
    session_result.scalars.return_value.all.return_value = []

    empty = MagicMock()
    empty.scalar_one_or_none.return_value = None
    empty.scalars.return_value.all.return_value = []

    db = AsyncMock()
    db.execute.side_effect = [session_result] + [empty] * 8
    db.scalar.return_value = None
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    return db


async def _fake_stream(*_, **__) -> AsyncGenerator[str, None]:
    yield "Great job opening up."


# ═══════════════════════════════════════════════════════════════════════════════
# strip_markdown_for_tts — pure unit tests (no I/O, no async)
# ═══════════════════════════════════════════════════════════════════════════════

class TestStripMarkdownForTts:
    def test_fenced_code_block_removed(self):
        result = strip_markdown_for_tts("Here is code:\n```python\nprint('hi')\n```\nDone.")
        assert "```" not in result
        assert "print" not in result
        assert "Done." in result

    def test_inline_code_removed(self):
        result = strip_markdown_for_tts("Use `myFunction()` to call it.")
        assert "`" not in result
        assert "myFunction" not in result
        assert "Use" in result

    def test_bold_stripped(self):
        assert strip_markdown_for_tts("This is **important** text.") == "This is important text."

    def test_italic_stripped(self):
        assert strip_markdown_for_tts("This is *emphasized* text.") == "This is emphasized text."

    def test_bold_italic_stripped(self):
        assert strip_markdown_for_tts("This is ***very important***.") == "This is very important."

    def test_underline_bold_stripped(self):
        assert strip_markdown_for_tts("__bold__") == "bold"

    def test_underline_italic_stripped(self):
        assert strip_markdown_for_tts("_italic_") == "italic"

    def test_atx_heading_removed(self):
        result = strip_markdown_for_tts("## Section Title\nBody text.")
        assert "##" not in result
        assert "Section Title" in result

    def test_h1_through_h6_removed(self):
        for level in range(1, 7):
            prefix = "#" * level
            result = strip_markdown_for_tts(f"{prefix} Heading\nText.")
            assert "#" not in result

    def test_unordered_list_markers_removed(self):
        text = "- item one\n* item two\n+ item three"
        result = strip_markdown_for_tts(text)
        assert "-" not in result
        assert "*" not in result
        assert "+" not in result
        assert "item one" in result

    def test_blockquote_marker_removed(self):
        result = strip_markdown_for_tts("> This is a quote.")
        assert ">" not in result
        assert "This is a quote." in result

    def test_horizontal_rule_removed(self):
        result = strip_markdown_for_tts("Before\n---\nAfter")
        assert "---" not in result
        assert "Before" in result
        assert "After" in result

    def test_markdown_link_replaced_with_text(self):
        result = strip_markdown_for_tts("Visit [Google](https://google.com) today.")
        assert "https://" not in result
        assert "Google" in result

    def test_triple_newlines_collapsed_to_double(self):
        result = strip_markdown_for_tts("A\n\n\n\nB")
        assert "\n\n\n" not in result
        assert "A" in result
        assert "B" in result

    def test_plain_prose_unchanged(self):
        prose = "The quick brown fox jumps over the lazy dog."
        assert strip_markdown_for_tts(prose) == prose

    def test_complex_response_stripped(self):
        text = (
            "## Summary\n\n"
            "Here are **three tips** for managing *anxiety*:\n\n"
            "- Breathe deeply\n"
            "- Ground yourself\n\n"
            "```\ncode block\n```\n\n"
            "> Remember: you are not alone.\n\n"
            "Learn more at [this resource](https://example.com)."
        )
        result = strip_markdown_for_tts(text)
        assert "#" not in result
        assert "**" not in result
        assert "*" not in result
        assert "-" not in result
        assert "```" not in result
        assert ">" not in result
        assert "https://" not in result
        assert "Breathe deeply" in result
        assert "this resource" in result


# ═══════════════════════════════════════════════════════════════════════════════
# truncate_for_tts
# ═══════════════════════════════════════════════════════════════════════════════

class TestTruncateForTts:
    def test_short_text_unchanged(self):
        text = "Hello world"
        assert truncate_for_tts(text) == text

    def test_text_at_exact_limit_unchanged(self):
        text = "a" * 4800
        assert truncate_for_tts(text) == text

    def test_long_ascii_text_truncated(self):
        text = "x" * 5000
        result = truncate_for_tts(text)
        assert len(result.encode("utf-8")) <= 4800

    def test_utf8_multibyte_not_split(self):
        # Japanese characters are 3 bytes each; 1601 of them = 4803 bytes > 4800
        text = "あ" * 1601
        result = truncate_for_tts(text)
        encoded = result.encode("utf-8")
        assert len(encoded) <= 4800
        # Result must be valid UTF-8 (no partial codepoints)
        result.encode("utf-8").decode("utf-8")

    def test_custom_max_bytes(self):
        text = "hello world this is longer than ten bytes"
        result = truncate_for_tts(text, max_bytes=10)
        assert len(result.encode("utf-8")) <= 10

    def test_empty_string(self):
        assert truncate_for_tts("") == ""


# ═══════════════════════════════════════════════════════════════════════════════
# transcribe_audio — async, GCP client patched
# ═══════════════════════════════════════════════════════════════════════════════

def _mock_stt_response(*transcripts: str) -> MagicMock:
    """Build a fake google.cloud.speech.RecognizeResponse with the given transcripts."""
    results = []
    for t in transcripts:
        alt = MagicMock()
        alt.transcript = t
        result = MagicMock()
        result.alternatives = [alt]
        results.append(result)
    resp = MagicMock()
    resp.results = results
    return resp


@pytest.mark.asyncio
class TestTranscribeAudio:
    """Each test resets the speech RecognitionConfig mock so call_args is fresh."""

    def setup_method(self):
        # Reset call history on RecognitionConfig before each test so
        # call_args reflects only the current test's invocation.
        _speech_stub.RecognitionConfig.reset_mock()

    async def _call(self, mime: str, transcript: str = "ok") -> tuple:
        """Run transcribe_audio with a mock client and return (result, call_kwargs)."""
        import app.services.voice_service as vs

        mock_client = MagicMock()
        mock_client.recognize.return_value = _mock_stt_response(transcript)
        with patch.object(vs, "_speech_client", return_value=mock_client):
            from app.services.voice_service import transcribe_audio
            result = await transcribe_audio(b"audio", mime)
        call_kwargs = _speech_stub.RecognitionConfig.call_args.kwargs
        return result, call_kwargs

    async def test_webm_uses_webm_opus_encoding(self):
        result, kw = await self._call("audio/webm", "hello")
        assert kw["encoding"] is _speech_stub.RecognitionConfig.AudioEncoding.WEBM_OPUS
        assert kw.get("sample_rate_hertz") == 48000
        assert result == "hello"

    async def test_video_webm_treated_as_webm_opus(self):
        _, kw = await self._call("video/webm", "video webm test")
        assert kw["encoding"] is _speech_stub.RecognitionConfig.AudioEncoding.WEBM_OPUS
        assert kw.get("sample_rate_hertz") == 48000

    async def test_ogg_uses_ogg_opus_encoding(self):
        _, kw = await self._call("audio/ogg")
        assert kw["encoding"] is _speech_stub.RecognitionConfig.AudioEncoding.OGG_OPUS
        assert kw.get("sample_rate_hertz") == 48000

    async def test_wav_uses_linear16_encoding(self):
        _, kw = await self._call("audio/wav")
        assert kw["encoding"] is _speech_stub.RecognitionConfig.AudioEncoding.LINEAR16
        assert kw.get("sample_rate_hertz") == 16000

    async def test_mp3_encoding(self):
        _, kw = await self._call("audio/mpeg")
        assert kw["encoding"] is _speech_stub.RecognitionConfig.AudioEncoding.MP3

    async def test_audio_mp4_uses_encoding_unspecified_no_sample_rate(self):
        """Safari records audio/mp4 (AAC). Must use ENCODING_UNSPECIFIED and must
        NOT include sample_rate_hertz so the Cloud STT API auto-detects the codec."""
        _, kw = await self._call("audio/mp4")
        assert kw["encoding"] is _speech_stub.RecognitionConfig.AudioEncoding.ENCODING_UNSPECIFIED
        assert "sample_rate_hertz" not in kw

    async def test_video_mp4_same_as_audio_mp4(self):
        _, kw = await self._call("video/mp4")
        assert kw["encoding"] is _speech_stub.RecognitionConfig.AudioEncoding.ENCODING_UNSPECIFIED
        assert "sample_rate_hertz" not in kw

    async def test_unknown_mime_falls_back_to_webm_opus(self):
        result, kw = await self._call("audio/unknown-format", "fallback")
        assert kw["encoding"] is _speech_stub.RecognitionConfig.AudioEncoding.WEBM_OPUS
        assert kw.get("sample_rate_hertz") == 48000
        assert result == "fallback"

    async def test_multiple_results_joined_with_space(self):
        import app.services.voice_service as vs
        mock_client = MagicMock()
        mock_client.recognize.return_value = _mock_stt_response("Hello", "world")
        with patch.object(vs, "_speech_client", return_value=mock_client):
            from app.services.voice_service import transcribe_audio
            result = await transcribe_audio(b"audio", "audio/webm")
        assert result == "Hello world"

    async def test_empty_results_returns_empty_string(self):
        import app.services.voice_service as vs
        mock_client = MagicMock()
        resp = MagicMock()
        resp.results = []
        mock_client.recognize.return_value = resp
        with patch.object(vs, "_speech_client", return_value=mock_client):
            from app.services.voice_service import transcribe_audio
            result = await transcribe_audio(b"audio", "audio/webm")
        assert result == ""

    async def test_language_code_forwarded(self):
        import app.services.voice_service as vs
        mock_client = MagicMock()
        mock_client.recognize.return_value = _mock_stt_response("こんにちは")
        with patch.object(vs, "_speech_client", return_value=mock_client):
            from app.services.voice_service import transcribe_audio
            await transcribe_audio(b"audio", "audio/webm", language_code="ja-JP")
        kw = _speech_stub.RecognitionConfig.call_args.kwargs
        assert kw["language_code"] == "ja-JP"


# ═══════════════════════════════════════════════════════════════════════════════
# synthesize_speech — async, GCP client patched
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
class TestSynthesizeSpeech:
    """Uses _tts_stub.AudioConfig.call_args / VoiceSelectionParams.call_args to
    inspect what kwargs were forwarded, since the MagicMock constructors don't
    expose kwargs as instance attributes."""

    def setup_method(self):
        _tts_stub.AudioConfig.reset_mock()
        _tts_stub.VoiceSelectionParams.reset_mock()

    async def test_returns_audio_content_bytes(self):
        import app.services.voice_service as vs
        from app.services.voice_service import synthesize_speech

        expected = b"\xff\xfb\x90\x00" * 100  # fake MP3 frame bytes
        mock_client = MagicMock()
        mock_client.synthesize_speech.return_value = MagicMock(audio_content=expected)
        with patch.object(vs, "_tts_client", return_value=mock_client):
            result = await synthesize_speech("Hello world")

        assert result == expected

    async def test_mp3_encoding_requested(self):
        import app.services.voice_service as vs
        from app.services.voice_service import synthesize_speech

        mock_client = MagicMock()
        mock_client.synthesize_speech.return_value = MagicMock(audio_content=b"mp3")
        with patch.object(vs, "_tts_client", return_value=mock_client):
            await synthesize_speech("Test")

        # AudioConfig was called with audio_encoding=texttospeech.AudioEncoding.MP3
        ac_kwargs = _tts_stub.AudioConfig.call_args.kwargs
        assert ac_kwargs["audio_encoding"] is _tts_stub.AudioEncoding.MP3

    async def test_speaking_rate_and_pitch_forwarded(self):
        import app.services.voice_service as vs
        from app.services.voice_service import synthesize_speech

        mock_client = MagicMock()
        mock_client.synthesize_speech.return_value = MagicMock(audio_content=b"bytes")
        with patch.object(vs, "_tts_client", return_value=mock_client):
            await synthesize_speech("Test", speaking_rate=1.2, pitch=2.0)

        ac_kwargs = _tts_stub.AudioConfig.call_args.kwargs
        assert ac_kwargs["speaking_rate"] == 1.2
        assert ac_kwargs["pitch"] == 2.0

    async def test_voice_name_forwarded(self):
        import app.services.voice_service as vs
        from app.services.voice_service import synthesize_speech

        mock_client = MagicMock()
        mock_client.synthesize_speech.return_value = MagicMock(audio_content=b"bytes")
        with patch.object(vs, "_tts_client", return_value=mock_client):
            await synthesize_speech("Test", voice_name="en-US-Studio-O")

        vsp_kwargs = _tts_stub.VoiceSelectionParams.call_args.kwargs
        assert vsp_kwargs["name"] == "en-US-Studio-O"


# ═══════════════════════════════════════════════════════════════════════════════
# POST /voice/transcribe
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
class TestTranscribeEndpoint:
    """Tests for POST /api/v1/voice/transcribe."""

    @patch("app.routers.voice.transcribe_audio", new_callable=AsyncMock, return_value="hello world")
    async def test_valid_wav_returns_transcript(self, _transcribe):
        user = make_user(subscription_tier="pro")
        db = AsyncMock()
        _override_pro(user, db)
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(
                    f"{_BASE}/voice/transcribe",
                    files={"file": ("rec.wav", _silent_wav_bytes(), "audio/wav")},
                )
            assert resp.status_code == 200
            assert resp.json() == {"transcript": "hello world"}
        finally:
            _clear()

    async def test_non_audio_file_returns_400(self):
        user = make_user(subscription_tier="pro")
        db = AsyncMock()
        _override_pro(user, db)
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(
                    f"{_BASE}/voice/transcribe",
                    files={"file": ("doc.txt", b"not audio at all", "text/plain")},
                )
            assert resp.status_code == 400
            assert "supported audio" in resp.json()["detail"].lower()
        finally:
            _clear()

    async def test_oversized_upload_returns_413(self):
        user = make_user(subscription_tier="pro")
        db = AsyncMock()
        _override_pro(user, db)
        try:
            oversized = b"x" * (11 * 1024 * 1024)  # 11 MB > 10 MB limit
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(
                    f"{_BASE}/voice/transcribe",
                    files={"file": ("big.wav", oversized, "audio/wav")},
                )
            assert resp.status_code == 413
            assert "size limit" in resp.json()["detail"].lower()
        finally:
            _clear()

    async def test_free_user_returns_402(self):
        user = make_user(subscription_tier="free")
        db = AsyncMock()
        # Only override get_current_user; require_pro uses the real implementation
        app.dependency_overrides[get_current_user] = lambda: user
        app.dependency_overrides[get_db] = lambda: db
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(
                    f"{_BASE}/voice/transcribe",
                    files={"file": ("rec.wav", _silent_wav_bytes(), "audio/wav")},
                )
            assert resp.status_code == 402
            assert resp.json()["detail"]["code"] == "subscription_required"
        finally:
            _clear()

    @patch("app.routers.voice.transcribe_audio", new_callable=AsyncMock, return_value="")
    async def test_empty_transcript_still_returns_200(self, _transcribe):
        """The /transcribe endpoint has no silence guard — only /conversation does."""
        user = make_user(subscription_tier="pro")
        db = AsyncMock()
        _override_pro(user, db)
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(
                    f"{_BASE}/voice/transcribe",
                    files={"file": ("rec.wav", _silent_wav_bytes(), "audio/wav")},
                )
            assert resp.status_code == 200
            assert resp.json()["transcript"] == ""
        finally:
            _clear()


# ═══════════════════════════════════════════════════════════════════════════════
# POST /voice/conversation/{session_id}
# ═══════════════════════════════════════════════════════════════════════════════

_COMMON_PATCHES = [
    patch("app.routers.voice.transcribe_audio", new_callable=AsyncMock, return_value="I feel nervous"),
    patch("app.routers.voice.synthesize_speech", new_callable=AsyncMock, return_value=b"\xff\xfb\x90\x00"),
    patch("app.routers.voice.detect_crisis", new_callable=AsyncMock, return_value={"is_crisis": False}),
    patch("app.routers.voice.check_input", new_callable=AsyncMock, return_value={"safe": True}),
    patch("app.routers.voice.classify_intent", new_callable=AsyncMock, return_value="general"),
    patch("app.routers.voice.get_user_profile_context", new_callable=AsyncMock, return_value=""),
    patch("app.routers.voice.embed_text", new_callable=AsyncMock, return_value=[0.0]),
    patch("app.routers.voice.get_relevant_context", new_callable=AsyncMock, return_value=[]),
    patch("app.routers.voice.get_tier1_context", new_callable=AsyncMock, return_value=[]),
    patch("app.routers.voice.stream_chat_response", side_effect=_fake_stream),
    patch("app.routers.voice._save_voice_messages", new_callable=AsyncMock),
    patch("app.routers.voice.refresh_user_profile", new_callable=AsyncMock),
    patch("app.routers.voice.maybe_snapshot_scores", new_callable=AsyncMock),
    patch("app.routers.voice.update_session_title", new_callable=AsyncMock),
    patch("app.routers.voice.update_session_summary", new_callable=AsyncMock),
]


def _apply_patches(test_fn):
    """Stack all common patches onto the test function."""
    import functools
    for p in reversed(_COMMON_PATCHES):
        test_fn = p(test_fn)
    return test_fn


@pytest.mark.asyncio
class TestVoiceConversationEndpoint:
    """Tests for POST /api/v1/voice/conversation/{session_id}."""

    @_apply_patches
    async def test_happy_path_returns_full_response(self, *mocks):
        user = make_user(subscription_tier="pro")
        session = make_session(user, title="Voice Session")
        db = _db_with_session(session)
        _override_pro(user, db)
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(
                    f"{_BASE}/voice/conversation/{session.id}",
                    files={"file": ("rec.wav", _silent_wav_bytes(), "audio/wav")},
                )
            assert resp.status_code == 200
            body = resp.json()
            assert body["user_transcript"] == "I feel nervous"
            assert body["assistant_text"] == "Great job opening up."
            assert body["audio_data"].startswith("data:audio/mpeg;base64,")
            assert body["crisis_flagged"] is False
        finally:
            _clear()

    @_apply_patches
    async def test_audio_data_is_valid_base64(self, *mocks):
        user = make_user(subscription_tier="pro")
        session = make_session(user)
        db = _db_with_session(session)
        _override_pro(user, db)
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(
                    f"{_BASE}/voice/conversation/{session.id}",
                    files={"file": ("rec.wav", _silent_wav_bytes(), "audio/wav")},
                )
            assert resp.status_code == 200
            data_uri = resp.json()["audio_data"]
            prefix, b64_data = data_uri.split(",", 1)
            assert prefix == "data:audio/mpeg;base64"
            decoded = base64.b64decode(b64_data)
            assert decoded == b"\xff\xfb\x90\x00"  # matches fake TTS bytes
        finally:
            _clear()

    @patch("app.routers.voice.transcribe_audio", new_callable=AsyncMock, return_value="I want to hurt myself")
    @patch("app.routers.voice.synthesize_speech", new_callable=AsyncMock, return_value=b"mp3")
    @patch("app.routers.voice.detect_crisis", new_callable=AsyncMock, return_value={"is_crisis": True})
    @patch("app.routers.voice.check_input", new_callable=AsyncMock, return_value={"safe": True})
    @patch("app.routers.voice.classify_intent", new_callable=AsyncMock, return_value="general")
    @patch("app.routers.voice.get_user_profile_context", new_callable=AsyncMock, return_value="")
    @patch("app.routers.voice.embed_text", new_callable=AsyncMock, return_value=[0.0])
    @patch("app.routers.voice.get_relevant_context", new_callable=AsyncMock, return_value=[])
    @patch("app.routers.voice.get_tier1_context", new_callable=AsyncMock, return_value=[])
    @patch("app.routers.voice.stream_chat_response", side_effect=_fake_stream)
    @patch("app.routers.voice._save_voice_messages", new_callable=AsyncMock)
    @patch("app.routers.voice.refresh_user_profile", new_callable=AsyncMock)
    @patch("app.routers.voice.maybe_snapshot_scores", new_callable=AsyncMock)
    @patch("app.routers.voice.update_session_title", new_callable=AsyncMock)
    @patch("app.routers.voice.update_session_summary", new_callable=AsyncMock)
    async def test_crisis_flagged_true_in_response(self, *mocks):
        user = make_user(subscription_tier="pro")
        session = make_session(user)
        db = _db_with_session(session)
        _override_pro(user, db)
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(
                    f"{_BASE}/voice/conversation/{session.id}",
                    files={"file": ("rec.wav", _silent_wav_bytes(), "audio/wav")},
                )
            assert resp.status_code == 200
            assert resp.json()["crisis_flagged"] is True
        finally:
            _clear()

    @patch("app.routers.voice.transcribe_audio", new_callable=AsyncMock, return_value="off topic spam")
    @patch("app.routers.voice.synthesize_speech", new_callable=AsyncMock, return_value=b"mp3")
    @patch("app.routers.voice.detect_crisis", new_callable=AsyncMock, return_value={"is_crisis": False})
    @patch("app.routers.voice.check_input", new_callable=AsyncMock,
           return_value={"safe": False, "redirect": "Let's focus on your wellbeing."})
    @patch("app.routers.voice._save_voice_messages", new_callable=AsyncMock)
    @patch("app.routers.voice.stream_chat_response", side_effect=_fake_stream)
    async def test_guardrail_redirect_skips_gemini(self, mock_stream, _save, *mocks):
        user = make_user(subscription_tier="pro")
        session = make_session(user)
        db = _db_with_session(session)
        _override_pro(user, db)
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(
                    f"{_BASE}/voice/conversation/{session.id}",
                    files={"file": ("rec.wav", _silent_wav_bytes(), "audio/wav")},
                )
            assert resp.status_code == 200
            body = resp.json()
            assert body["assistant_text"] == "Let's focus on your wellbeing."
            # Gemini must NOT have been called
            mock_stream.assert_not_called()
        finally:
            _clear()

    @patch("app.routers.voice.transcribe_audio", new_callable=AsyncMock, return_value="   ")
    async def test_silent_audio_returns_422(self, _transcribe):
        user = make_user(subscription_tier="pro")
        session = make_session(user)
        db = _db_with_session(session)
        _override_pro(user, db)
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(
                    f"{_BASE}/voice/conversation/{session.id}",
                    files={"file": ("rec.wav", _silent_wav_bytes(), "audio/wav")},
                )
            assert resp.status_code == 422
            assert "silent" in resp.json()["detail"].lower()
        finally:
            _clear()

    async def test_unsupported_mime_returns_400(self):
        user = make_user(subscription_tier="pro")
        session = make_session(user)
        db = _db_with_session(session)
        _override_pro(user, db)
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(
                    f"{_BASE}/voice/conversation/{session.id}",
                    files={"file": ("doc.pdf", b"%PDF-1.4 fake pdf content", "application/pdf")},
                )
            assert resp.status_code == 400
            assert "supported audio" in resp.json()["detail"].lower()
        finally:
            _clear()

    async def test_oversized_upload_returns_413(self):
        user = make_user(subscription_tier="pro")
        session = make_session(user)
        db = _db_with_session(session)
        _override_pro(user, db)
        try:
            oversized = b"x" * (11 * 1024 * 1024)
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(
                    f"{_BASE}/voice/conversation/{session.id}",
                    files={"file": ("big.webm", oversized, "audio/webm")},
                )
            assert resp.status_code == 413
        finally:
            _clear()

    async def test_free_user_returns_402(self):
        user = make_user(subscription_tier="free")
        session = make_session(user)
        db = _db_with_session(session)
        app.dependency_overrides[get_current_user] = lambda: user
        app.dependency_overrides[get_db] = lambda: db
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(
                    f"{_BASE}/voice/conversation/{session.id}",
                    files={"file": ("rec.wav", _silent_wav_bytes(), "audio/wav")},
                )
            assert resp.status_code == 402
            assert resp.json()["detail"]["code"] == "subscription_required"
        finally:
            _clear()

    async def test_wrong_session_returns_404(self):
        user = make_user(subscription_tier="pro")
        # DB returns None for session lookup → session not found
        empty_result = MagicMock()
        empty_result.scalar_one_or_none.return_value = None
        db = AsyncMock()
        db.execute.return_value = empty_result
        _override_pro(user, db)
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(
                    f"{_BASE}/voice/conversation/{uuid.uuid4()}",
                    files={"file": ("rec.wav", _silent_wav_bytes(), "audio/wav")},
                )
            assert resp.status_code == 404
        finally:
            _clear()

    @patch("app.routers.voice.transcribe_audio", new_callable=AsyncMock, return_value="I feel nervous")
    @patch("app.routers.voice.synthesize_speech", new_callable=AsyncMock, return_value=b"mp3")
    @patch("app.routers.voice.detect_crisis", new_callable=AsyncMock, return_value={"is_crisis": False})
    @patch("app.routers.voice.check_input", new_callable=AsyncMock, return_value={"safe": True})
    @patch("app.routers.voice.classify_intent", new_callable=AsyncMock, return_value="general")
    @patch("app.routers.voice.get_user_profile_context", new_callable=AsyncMock, return_value="")
    @patch("app.routers.voice.embed_text", new_callable=AsyncMock, return_value=[0.0])
    @patch("app.routers.voice.get_relevant_context", new_callable=AsyncMock, return_value=[])
    @patch("app.routers.voice.get_tier1_context", new_callable=AsyncMock, return_value=[])
    @patch("app.routers.voice.stream_chat_response", side_effect=_fake_stream)
    @patch("app.routers.voice._save_voice_messages", new_callable=AsyncMock)
    @patch("app.routers.voice.refresh_user_profile", new_callable=AsyncMock)
    @patch("app.routers.voice.maybe_snapshot_scores", new_callable=AsyncMock)
    @patch("app.routers.voice.update_session_summary", new_callable=AsyncMock)
    @patch("app.routers.voice.update_session_title", new_callable=AsyncMock)
    async def test_session_title_updated_when_title_is_new_session(self, mock_title, *mocks):
        user = make_user(subscription_tier="pro")
        session = make_session(user, title="New Session")
        db = _db_with_session(session)
        _override_pro(user, db)
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(
                    f"{_BASE}/voice/conversation/{session.id}",
                    files={"file": ("rec.wav", _silent_wav_bytes(), "audio/wav")},
                )
            assert resp.status_code == 200
            mock_title.assert_called_once()
        finally:
            _clear()

    @patch("app.routers.voice.transcribe_audio", new_callable=AsyncMock, return_value="I feel nervous")
    @patch("app.routers.voice.synthesize_speech", new_callable=AsyncMock, return_value=b"mp3")
    @patch("app.routers.voice.detect_crisis", new_callable=AsyncMock, return_value={"is_crisis": False})
    @patch("app.routers.voice.check_input", new_callable=AsyncMock, return_value={"safe": True})
    @patch("app.routers.voice.classify_intent", new_callable=AsyncMock, return_value="general")
    @patch("app.routers.voice.get_user_profile_context", new_callable=AsyncMock, return_value="")
    @patch("app.routers.voice.embed_text", new_callable=AsyncMock, return_value=[0.0])
    @patch("app.routers.voice.get_relevant_context", new_callable=AsyncMock, return_value=[])
    @patch("app.routers.voice.get_tier1_context", new_callable=AsyncMock, return_value=[])
    @patch("app.routers.voice.stream_chat_response", side_effect=_fake_stream)
    @patch("app.routers.voice._save_voice_messages", new_callable=AsyncMock)
    @patch("app.routers.voice.refresh_user_profile", new_callable=AsyncMock)
    @patch("app.routers.voice.maybe_snapshot_scores", new_callable=AsyncMock)
    @patch("app.routers.voice.update_session_summary", new_callable=AsyncMock)
    @patch("app.routers.voice.update_session_title", new_callable=AsyncMock)
    async def test_session_title_not_updated_when_already_set(self, mock_title, *mocks):
        user = make_user(subscription_tier="pro")
        session = make_session(user, title="My Custom Session")
        db = _db_with_session(session)
        _override_pro(user, db)
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post(
                    f"{_BASE}/voice/conversation/{session.id}",
                    files={"file": ("rec.wav", _silent_wav_bytes(), "audio/wav")},
                )
            assert resp.status_code == 200
            mock_title.assert_not_called()
        finally:
            _clear()
