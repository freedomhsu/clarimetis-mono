"""Voice router -- STT -> guardrails -> Gemini -> TTS pipeline.

Two endpoints:
  POST /voice/transcribe                -- transcribe an audio file (no coaching)
  POST /voice/conversation/{session_id} -- full turn: STT -> coaching reply -> TTS

Design:
  * _read_and_validate_audio / _get_voice_session are FastAPI dependencies.
  * Settings injected via SettingsDep -- all limits/voice params are env-configurable.
  * STT/TTS logic lives in services.voice_service (cached process-level GCP clients).
  * Session lifecycle helpers live in services.session_ops (shared with chat router).
"""

import asyncio
import base64
import uuid
from typing import Annotated

import filetype
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, SettingsDep, get_settings
from app.database import AsyncSessionLocal, get_db
from app.middleware.subscription import require_pro
from app.models.message import Message
from app.models.session import ChatSession
from app.models.user import User
from app.rate_limit import limiter
from app.schemas.chat import VoiceConversationResponse, VoiceTranscribeResponse
from app.services.crisis_detection import detect_crisis
from app.services.embeddings import embed_text
from app.services.gateway import classify_intent, get_system_prompt
from app.services.gemini import stream_chat_response
from app.services.guardrails import check_input
from app.services.profile import refresh_user_profile
from app.services.rag import (
    get_relevant_context,
    get_tier1_context,
    get_user_profile_context,
    store_message_embedding,
)
from app.services.session_ops import maybe_snapshot_scores, update_session_summary, update_session_title
from app.services.voice_service import (
    ALLOWED_AUDIO_TYPES,
    strip_markdown_for_tts,
    synthesize_speech,
    transcribe_audio,
    truncate_for_tts,
)

router = APIRouter(prefix="/voice", tags=["voice"])

# Raw audio bytes paired with the magic-byte-detected MIME type.
_AudioPayload = tuple[bytes, str]

# -- Dependencies ---------------------------------------------------------------


async def _read_and_validate_audio(
    file: UploadFile = File(...),
    settings: Settings = Depends(get_settings),
) -> _AudioPayload:
    """Read upload, enforce the configured size limit, and verify MIME via magic bytes.

    Magic-byte detection is the ground truth; the browser Content-Type header
    is ignored to prevent MIME-spoofing.  Returns (content, detected_mime_type).
    """
    content = await file.read()
    limit_mb = settings.max_voice_bytes // (1024 * 1024)
    if len(content) > settings.max_voice_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Audio file exceeds the {limit_mb} MB size limit.",
        )
    detected = filetype.guess(content)
    actual_type = detected.mime if detected else None
    if actual_type not in ALLOWED_AUDIO_TYPES:
        raise HTTPException(
            status_code=400,
            detail="File content is not a supported audio format.",
        )
    return content, actual_type


async def _get_voice_session(
    session_id: uuid.UUID,
    user: User = Depends(require_pro),
    db: AsyncSession = Depends(get_db),
) -> ChatSession:
    """Resolve and ownership-verify a ChatSession for voice.

    Depends on require_pro, so auth + pro-tier enforcement happen in one chain.
    """
    result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == user.id,
        )
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


# -- Background task helpers ----------------------------------------------------


async def _save_voice_messages(
    session_id: uuid.UUID,
    user_text: str,
    assistant_text: str,
    *,
    crisis_flagged: bool = False,
) -> None:
    """Persist both turns of a voice exchange and enqueue their embeddings."""
    async with AsyncSessionLocal() as db:
        user_msg = Message(
            session_id=session_id,
            role="user",
            content=user_text,
            crisis_flagged=crisis_flagged,
        )
        db.add(user_msg)
        asst_msg = Message(session_id=session_id, role="assistant", content=assistant_text)
        db.add(asst_msg)
        await db.commit()
        await db.refresh(user_msg)
        await db.refresh(asst_msg)
        await store_message_embedding(db, user_msg)
        # Re-hydrate asst_msg after the db.commit() inside store_message_embedding;
        # expire_on_commit=True would cause MissingGreenlet on the next attribute access.
        await db.refresh(asst_msg)
        await store_message_embedding(db, asst_msg)


# -- Endpoints ------------------------------------------------------------------



@router.post("/transcribe", response_model=VoiceTranscribeResponse)
@limiter.limit("30/hour")
@limiter.limit("60/day")
async def transcribe_audio_endpoint(
    request: Request,
    audio: Annotated[_AudioPayload, Depends(_read_and_validate_audio)],
    settings: SettingsDep,
    _: User = Depends(require_pro),
) -> dict:
    """Transcribe an uploaded audio file to text; no coaching response."""
    content, actual_type = audio
    transcript = await transcribe_audio(
        content, actual_type, language_code=settings.stt_language_code
    )
    return {"transcript": transcript}


@router.post("/conversation/{session_id}", response_model=VoiceConversationResponse)
@limiter.limit("20/hour")
@limiter.limit("40/day")
async def voice_conversation(
    request: Request,
    background_tasks: BackgroundTasks,
    audio: Annotated[_AudioPayload, Depends(_read_and_validate_audio)],
    session: Annotated[ChatSession, Depends(_get_voice_session)],
    settings: SettingsDep,
    user: User = Depends(require_pro),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Single-turn voice conversation.

    Pipeline:
      1. STT  -- transcribe uploaded audio
      2. Crisis detection + input guardrail (parallel, independent LLM calls)
      3. Gemini -- accumulate full coaching reply
      4. TTS  -- synthesise reply to MP3
      5. Persist both turns + embeddings as background tasks
    """
    content, actual_type = audio
    session_id = session.id

    user_text = await transcribe_audio(
        content, actual_type, language_code=settings.stt_language_code
    )
    if not user_text.strip():
        raise HTTPException(
            status_code=422,
            detail="Recording was too short or silent -- please try again.",
        )

    # Run crisis detection and scope guardrail in parallel -- both are pure LLM
    # calls with no shared state, so concurrent execution is safe here.
    crisis_result, guardrail_result = await asyncio.gather(
        detect_crisis(user_text),
        check_input(user_text),
    )
    is_crisis = crisis_result.get("is_crisis", False)

    if not guardrail_result["safe"] and guardrail_result.get("redirect"):
        redirect_text = guardrail_result["redirect"]
        tts_input = truncate_for_tts(strip_markdown_for_tts(redirect_text))
        audio_bytes = await synthesize_speech(
            tts_input,
            voice_name=settings.tts_voice_name,
            language_code=settings.tts_language_code,
            speaking_rate=settings.tts_speaking_rate,
            pitch=settings.tts_pitch,
        )
        # Persist the redirect exchange so the session history is complete.
        background_tasks.add_task(_save_voice_messages, session_id, user_text, redirect_text)
        return {
            "user_transcript": user_text,
            "assistant_text": redirect_text,
            "audio_data": "data:audio/mpeg;base64," + base64.b64encode(audio_bytes).decode(),
        }

    # Gather intent classification, user profile, and query embedding in parallel.
    # All three are independent of the DB session.
    intent, profile_context, query_embedding = await asyncio.gather(
        classify_intent(user_text),
        get_user_profile_context(db, user.id),
        embed_text(user_text),
    )
    system_prompt = get_system_prompt(intent, user.preferred_language)

    history_rows = await db.execute(
        select(Message)
        .where(Message.session_id == session_id)
        .order_by(Message.created_at.desc())
        .limit(settings.voice_history_limit)
    )
    history = [
        {"role": m.role, "content": m.content}
        for m in reversed(list(history_rows.scalars().all()))
    ]

    # RAG lookups share the same asyncpg connection -- must run sequentially.
    rag_context = await get_relevant_context(db, user.id, user_text, embedding=query_embedding)
    tier1_context = await get_tier1_context(db, user_text, embedding=query_embedding)

    chat_model = (
        settings.gemini_pro_model
        if user.subscription_tier in ("pro", "enterprise")
        else settings.gemini_flash_model
    )
    assistant_chunks: list[str] = []
    async for chunk in stream_chat_response(
        user_message=user_text,
        conversation_history=history,
        rag_context=rag_context,
        tier1_context=tier1_context,
        system_prompt=system_prompt,
        profile_context=profile_context,
        model_name=chat_model,
    ):
        assistant_chunks.append(chunk)
    assistant_text = "".join(assistant_chunks)

    if is_crisis:
        assistant_text = settings.crisis_banner_text + assistant_text

    tts_input = truncate_for_tts(strip_markdown_for_tts(assistant_text))
    audio_bytes = await synthesize_speech(
        tts_input,
        voice_name=settings.tts_voice_name,
        language_code=settings.tts_language_code,
        speaking_rate=settings.tts_speaking_rate,
        pitch=settings.tts_pitch,
    )

    background_tasks.add_task(
        _save_voice_messages, session_id, user_text, assistant_text,
        crisis_flagged=is_crisis,
    )
    background_tasks.add_task(refresh_user_profile, user.id)
    background_tasks.add_task(maybe_snapshot_scores, user.id)
    if session.title == "New Session":
        background_tasks.add_task(update_session_title, session_id, user_text)
    background_tasks.add_task(update_session_summary, session_id)

    return {
        "user_transcript": user_text,
        "assistant_text": assistant_text,
        "audio_data": "data:audio/mpeg;base64," + base64.b64encode(audio_bytes).decode(),
        "crisis_flagged": is_crisis,
    }
