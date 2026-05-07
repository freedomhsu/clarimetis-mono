"""Google Cloud STT / TTS service wrappers.

Exposes framework-agnostic async functions so the voice router stays thin.
GCP clients are created once per process via ``@lru_cache`` and reused across
requests, avoiding repeated credential/gRPC handshake overhead.

All configurable parameters (voice name, language codes, speaking rate, etc.)
are explicit keyword-only arguments so callers can forward values from
``Settings`` without coupling this module to the FastAPI DI system — making
unit-testing and future client swaps straightforward.
"""

import asyncio
import re
from functools import lru_cache

from google.cloud import speech, texttospeech

from app.services.gcp_credentials import get_gcp_credentials

# ── Allowed MIME types ─────────────────────────────────────────────────────────

ALLOWED_AUDIO_TYPES: frozenset[str] = frozenset({
    "audio/webm",
    "audio/ogg",
    "audio/wav",
    # filetype.guess() returns "audio/x-wav" for WAV files — both are valid
    "audio/x-wav",
    "audio/mp4",
    "audio/mpeg",
    # filetype.guess() returns "video/webm" for audio-only WebM (magic bytes identical)
    "video/webm",
    # Safari MediaRecorder default
    "video/mp4",
})

# Maps detected MIME type → (Google Speech encoding, sample_rate_hertz)
#
# audio/mp4 and video/mp4 arrive from Safari's MediaRecorder, which outputs
# AAC audio in an M4A/MP4 container.  Google Cloud STT does not have a
# dedicated AAC encoding constant; ENCODING_UNSPECIFIED tells the API to
# auto-detect the codec from the file header, which correctly handles both
# MP3 and AAC (M4A) payloads.  A sample_rate of 0 signals auto-detection too.
_SPEECH_ENCODING_MAP: dict[str, tuple] = {
    "audio/webm": (speech.RecognitionConfig.AudioEncoding.WEBM_OPUS, 48000),
    "video/webm": (speech.RecognitionConfig.AudioEncoding.WEBM_OPUS, 48000),
    "audio/ogg":  (speech.RecognitionConfig.AudioEncoding.OGG_OPUS,  48000),
    "audio/wav":  (speech.RecognitionConfig.AudioEncoding.LINEAR16,  16000),
    # filetype.guess() returns "audio/x-wav" for WAV files; map both for safety.
    "audio/x-wav": (speech.RecognitionConfig.AudioEncoding.LINEAR16, 16000),
    "audio/mpeg": (speech.RecognitionConfig.AudioEncoding.MP3,       16000),
    # Safari MediaRecorder emits AAC-in-MP4 — let the API auto-detect the codec.
    "audio/mp4":  (speech.RecognitionConfig.AudioEncoding.ENCODING_UNSPECIFIED, 0),
    "video/mp4":  (speech.RecognitionConfig.AudioEncoding.ENCODING_UNSPECIFIED, 0),
}

# ── Process-level GCP client singletons ───────────────────────────────────────


@lru_cache(maxsize=1)
def _speech_client() -> speech.SpeechClient:
    """Return the process-level STT client (created once, reused across requests)."""
    return speech.SpeechClient(credentials=get_gcp_credentials())


@lru_cache(maxsize=1)
def _tts_client() -> texttospeech.TextToSpeechClient:
    """Return the process-level TTS client (created once, reused across requests)."""
    return texttospeech.TextToSpeechClient(credentials=get_gcp_credentials())


# ── Text helpers ───────────────────────────────────────────────────────────────

def strip_markdown_for_tts(text: str) -> str:
    """Remove markdown formatting so TTS reads clean prose instead of symbols."""
    text = re.sub(r"```[\s\S]*?```", "", text)
    text = re.sub(r"`[^`]+`", "", text)
    text = re.sub(r"\*\*\*(.+?)\*\*\*", r"\1", text)
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"\*(.+?)\*", r"\1", text)
    text = re.sub(r"___(.+?)___", r"\1", text)
    text = re.sub(r"__(.+?)__", r"\1", text)
    text = re.sub(r"_(.+?)_", r"\1", text)
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^[\-\*\+]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^>\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^[-\*_]{3,}\s*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def truncate_for_tts(text: str, max_bytes: int = 4800) -> str:
    """Truncate *text* to at most *max_bytes* UTF-8 bytes.

    Google Cloud TTS accepts up to 5 000 bytes of plain text; 4 800 gives a
    comfortable margin without noticeably cutting off responses.  Operates on
    byte length (not character count) to correctly handle multi-byte Unicode
    such as emoji and CJK characters.
    """
    encoded = text.encode("utf-8")
    if len(encoded) <= max_bytes:
        return text
    return encoded[:max_bytes].decode("utf-8", errors="ignore")


# ── STT / TTS ──────────────────────────────────────────────────────────────────


async def transcribe_audio(
    content: bytes,
    mime_type: str,
    *,
    language_code: str = "en-US",
) -> str:
    """Transcribe *content* via Google Cloud STT and return the transcript string.

    Falls back to WEBM_OPUS / 48 kHz for unrecognised MIME types.
    """
    encoding, sample_rate = _SPEECH_ENCODING_MAP.get(
        mime_type,
        (speech.RecognitionConfig.AudioEncoding.WEBM_OPUS, 48000),
    )
    audio = speech.RecognitionAudio(content=content)
    config_kwargs: dict = {
        "encoding": encoding,
        "language_code": language_code,
        "enable_automatic_punctuation": True,
    }
    # sample_rate_hertz=0 means "let the API auto-detect" (used for MP4/AAC).
    if sample_rate > 0:
        config_kwargs["sample_rate_hertz"] = sample_rate
    config = speech.RecognitionConfig(**config_kwargs)
    response = await asyncio.to_thread(_speech_client().recognize, config=config, audio=audio)
    return " ".join(
        result.alternatives[0].transcript
        for result in response.results
        if result.alternatives
    )


async def synthesize_speech(
    text: str,
    *,
    voice_name: str = "en-US-Neural2-F",
    language_code: str = "en-US",
    speaking_rate: float = 0.95,
    pitch: float = 0.0,
) -> bytes:
    """Synthesise *text* via Google Cloud TTS and return raw MP3 bytes."""
    voice = texttospeech.VoiceSelectionParams(
        language_code=language_code,
        name=voice_name,
    )
    audio_config = texttospeech.AudioConfig(
        audio_encoding=texttospeech.AudioEncoding.MP3,
        speaking_rate=speaking_rate,
        pitch=pitch,
    )
    response = await asyncio.to_thread(
        _tts_client().synthesize_speech,
        input=texttospeech.SynthesisInput(text=text),
        voice=voice,
        audio_config=audio_config,
    )
    return response.audio_content
