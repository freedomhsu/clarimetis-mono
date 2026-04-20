import asyncio

import filetype
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from google.cloud import speech

from app.middleware.auth import get_current_user_id
from app.middleware.subscription import require_pro
from app.models.user import User
from app.schemas.chat import VoiceTranscribeResponse

router = APIRouter(prefix="/voice", tags=["voice"])

_ALLOWED_AUDIO_TYPES = {
    "audio/webm",
    "audio/ogg",
    "audio/wav",
    "audio/mp4",
    "audio/mpeg",
}

# Maps browser MIME type → (Google Speech encoding, sample_rate_hertz)
_SPEECH_ENCODING_MAP: dict[str, tuple] = {
    "audio/webm": (speech.RecognitionConfig.AudioEncoding.WEBM_OPUS, 48000),
    "audio/ogg":  (speech.RecognitionConfig.AudioEncoding.OGG_OPUS,  48000),
    "audio/wav":  (speech.RecognitionConfig.AudioEncoding.LINEAR16,  16000),
    "audio/mpeg": (speech.RecognitionConfig.AudioEncoding.MP3,       16000),
    "audio/mp4":  (speech.RecognitionConfig.AudioEncoding.MP3,       16000),
}


@router.post("/transcribe", response_model=VoiceTranscribeResponse)
async def transcribe_audio(
    file: UploadFile = File(...),
    _: str = Depends(get_current_user_id),
    _pro: User = Depends(require_pro),
) -> dict:
    if file.content_type not in _ALLOWED_AUDIO_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported audio format")

    content = await file.read()

    # Verify actual file magic bytes — do not trust the client-supplied Content-Type.
    detected = filetype.guess(content)
    actual_type = detected.mime if detected else None
    if actual_type not in _ALLOWED_AUDIO_TYPES:
        raise HTTPException(status_code=400, detail="File content does not match an allowed audio format.")

    encoding, sample_rate = _SPEECH_ENCODING_MAP.get(
        actual_type,
        (speech.RecognitionConfig.AudioEncoding.WEBM_OPUS, 48000),
    )
    client = speech.SpeechClient()
    audio = speech.RecognitionAudio(content=content)
    config = speech.RecognitionConfig(
        encoding=encoding,
        sample_rate_hertz=sample_rate,
        language_code="en-US",
        enable_automatic_punctuation=True,
    )

    response = await asyncio.to_thread(client.recognize, config=config, audio=audio)

    transcript = " ".join(
        result.alternatives[0].transcript
        for result in response.results
        if result.alternatives
    )
    return {"transcript": transcript}
