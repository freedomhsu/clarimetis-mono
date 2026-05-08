import asyncio
import uuid
from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import SettingsDep
from app.database import AsyncSessionLocal, get_db
from app.models.message import Message
from app.models.session import ChatSession
from app.models.user import User
from app.rate_limit import limiter
from app.schemas.chat import ChatRequest, MessageOut
from app.middleware.subscription import check_message_quota, get_current_user
from app.services.crisis_detection import detect_crisis
from app.services.embeddings import embed_text
from app.services.gateway import classify_intent, get_system_prompt
from app.services.guardrails import check_input, check_output
from app.services.evaluation import evaluate_exchange
from app.services.gemini import stream_chat_response
from app.services.profile import refresh_user_profile
from app.services.rag import get_relevant_context, get_tier1_context, get_user_profile_context, store_message_embedding
from app.services.sentiment import score_sentiment
from app.services.session_ops import maybe_snapshot_scores, update_session_summary, update_session_title
from app.services.storage import is_blob_path, sign_blob_path

router = APIRouter(prefix="/sessions/{session_id}/messages", tags=["chat"])


# ── Dependencies ───────────────────────────────────────────────────────────────

async def _get_session(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ChatSession:
    """Resolve the requested session, enforcing ownership.

    Declared as a FastAPI dependency so it participates in the DI graph:
    it can be overridden in tests, composed into other dependencies, and
    its sub-dependencies (get_db, get_current_user) are cached per-request.
    """
    result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == user.id,
        )
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return session


# Annotated alias — use ``session: SessionDep`` in route handlers.
SessionDep = Annotated[ChatSession, Depends(_get_session)]


async def _save_assistant_message(
    session_id: uuid.UUID, content: str, crisis_flagged: bool = False
) -> None:
    """Persist the assistant reply and queue its embedding — runs as a background task."""
    async with AsyncSessionLocal() as db:
        msg = Message(
            session_id=session_id,
            role="assistant",
            content=content,
            crisis_flagged=crisis_flagged,
        )
        db.add(msg)
        await db.commit()
        await store_message_embedding(db, msg)


async def _persist_user_message(
    db: AsyncSession,
    session_id: uuid.UUID,
    body: ChatRequest,
    *,
    crisis_flagged: bool = False,
    refresh: bool = False,
) -> Message:
    """Create, persist, and optionally refresh a user Message row."""
    msg = Message(
        session_id=session_id,
        role="user",
        content=body.content,
        media_urls=body.media_urls,
        crisis_flagged=crisis_flagged,
    )
    db.add(msg)
    await db.commit()
    if refresh:
        await db.refresh(msg)
    return msg


async def _store_user_msg_embedding(message_id: uuid.UUID, content: str) -> None:
    """Embed the user message in a fresh session — background task safe."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Message).where(Message.id == message_id))
        msg = result.scalar_one_or_none()
        if msg is not None:
            await store_message_embedding(db, msg)


async def _score_and_store_sentiment(message_id: uuid.UUID, content: str) -> None:
    """Score sentiment for a user message and persist it — background task."""
    score = await score_sentiment(content)
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Message).where(Message.id == message_id))
        msg = result.scalar_one_or_none()
        if msg is not None:
            msg.sentiment_score = score
            await db.commit()



@router.delete("/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message(
    message_id: uuid.UUID,
    session: SessionDep,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a single message that belongs to this session.

    Used by the frontend Regenerate flow to remove the stale user + assistant
    messages before re-submitting the same question.
    """
    result = await db.execute(
        select(Message).where(
            Message.id == message_id,
            Message.session_id == session.id,
        )
    )
    msg = result.scalar_one_or_none()
    if msg is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    await db.delete(msg)
    await db.commit()


@router.get("", response_model=list[MessageOut])
async def get_messages(
    session: SessionDep,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[Message]:
    msgs_result = await db.execute(
        select(Message)
        .where(Message.session_id == session.id)
        .order_by(Message.created_at)
    )
    messages = list(msgs_result.scalars().all())

    # Re-sign any GCS blob paths stored in media_urls so the client always
    # receives a fresh, non-expired URL — regardless of when the message was sent.
    for msg in messages:
        if msg.media_urls:
            async def _resolve(u: str) -> str:
                return await sign_blob_path(u) if is_blob_path(u) else u

            msg.media_urls = list(await asyncio.gather(*[_resolve(u) for u in msg.media_urls]))

    return messages


@router.post("")
@limiter.limit("40/minute")
async def send_message(
    request: Request,
    session: SessionDep,
    body: ChatRequest,
    background_tasks: BackgroundTasks,
    settings: SettingsDep,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(check_message_quota),
) -> StreamingResponse:
    # Run blocking pre-work before the stream so that:
    #   a) the user message is committed to DB before we return a response,
    #      ensuring subsequent requests' quota checks see the correct count; and
    #   b) crisis / intent results are ready before any bytes are sent.
    # detect_crisis and classify_intent are pure LLM calls (no DB) — safe to gather.
    # get_user_profile_context uses the same DB session so must run separately.
    crisis_result, intent, guardrail_result = await asyncio.gather(
        detect_crisis(body.content),
        classify_intent(body.content),
        check_input(body.content),
    )
    profile_context = await get_user_profile_context(db, user.id)
    is_crisis = crisis_result.get("is_crisis", False)
    system_prompt = get_system_prompt(intent, user.preferred_language)

    # Input guardrail: if the message is out of scope, return the redirect response
    # directly without calling the main LLM — but still persist the user message.
    if not guardrail_result["safe"] and guardrail_result.get("redirect"):
        user_msg_r = await _persist_user_message(db, session.id, body, refresh=True)
        redirect_text = guardrail_result["redirect"]
        # Save the redirect as an assistant message so it persists across reloads.
        # Schedule the same background tasks as the normal path so the user
        # message gets an embedding, sentiment score, and a session title.
        background_tasks.add_task(_save_assistant_message, session.id, redirect_text)
        background_tasks.add_task(_store_user_msg_embedding, user_msg_r.id, body.content)
        background_tasks.add_task(_score_and_store_sentiment, user_msg_r.id, body.content)
        if session.title == "New Session":
            background_tasks.add_task(update_session_title, session.id, body.content)

        async def _redirect_stream() -> AsyncGenerator[str, None]:
            yield redirect_text

        return StreamingResponse(_redirect_stream(), media_type="text/plain; charset=utf-8")

    # Persist the user message NOW — before the StreamingResponse is returned.
    user_msg = await _persist_user_message(
        db, session.id, body, crisis_flagged=is_crisis, refresh=True
    )

    background_tasks.add_task(_store_user_msg_embedding, user_msg.id, body.content)
    background_tasks.add_task(_score_and_store_sentiment, user_msg.id, body.content)

    if session.title == "New Session":
        background_tasks.add_task(update_session_title, session.id, body.content)

    accumulated: list[str] = []

    async def generate() -> AsyncGenerator[str, None]:
        yield "\x00STATUS\x00:Retrieving relevant memories...\n"
        # Compute the query embedding once and reuse it for both RAG lookups,
        # saving one Vertex AI round-trip (~300 ms) per message.
        query_embedding = await embed_text(body.content)
        history_rows = await db.execute(
            select(Message)
            .where(
                Message.session_id == session.id,
                # Exclude the current user message — it was already committed
                # above so it would appear in this query, causing the LLM to
                # receive the same user turn twice (once in history, once as
                # the send_message payload).
                Message.id != user_msg.id,
            )
            .order_by(Message.created_at.desc())
            .limit(settings.chat_history_limit)
        )
        history = [
            {"role": m.role, "content": m.content}
            for m in reversed(list(history_rows.scalars().all()))
        ]
        # Run DB queries sequentially — asyncpg does not allow concurrent
        # operations on the same connection/session.
        rag_context = await get_relevant_context(db, user.id, body.content, embedding=query_embedding)
        tier1_context = await get_tier1_context(db, body.content, embedding=query_embedding)

        if rag_context:
            yield f"\x00STATUS\x00:Found {len(rag_context)} relevant context item(s)...\n"

        yield "\x00STATUS\x00:Generating response...\n"

        if is_crisis:
            # Signal crisis via a sentinel — the frontend shows <CrisisBanner />
            # based on this, without duplicating the banner text in the message body.
            yield "\x00CRISIS\x00\n"

        chat_model = (
            settings.gemini_pro_model
            if user.subscription_tier == "pro"
            else settings.gemini_flash_model
        )
        async for chunk in stream_chat_response(
            user_message=body.content,
            conversation_history=history,
            rag_context=rag_context,
            tier1_context=tier1_context,
            media_urls=body.media_urls,
            system_prompt=system_prompt,
            profile_context=profile_context,
            model_name=chat_model,
        ):
            accumulated.append(chunk)
            yield chunk

    async def _on_stream_complete(response_text: str) -> None:
        """Registered as a background task; runs after the StreamingResponse is done."""
        await _save_assistant_message(session.id, response_text, is_crisis)
        await asyncio.gather(
            refresh_user_profile(user.id),
            update_session_summary(session.id),
            maybe_snapshot_scores(user.id),
        )

    async def _wrapped_generate() -> AsyncGenerator[str, None]:
        async for chunk in generate():
            yield chunk
        # Register post-stream tasks only after the generator fully completes.
        # Registering them here (not inside generate()) ensures they run even if
        # the caller awaits the StreamingResponse to exhaustion, and avoids
        # losing the assistant message on early client disconnects — because
        # background_tasks are submitted to Starlette after the response finishes.
        full_response = "".join(accumulated)
        background_tasks.add_task(_on_stream_complete, full_response)
        background_tasks.add_task(check_output, full_response, str(session.id))
        background_tasks.add_task(evaluate_exchange, body.content, full_response, str(session.id))

    return StreamingResponse(_wrapped_generate(), media_type="text/plain; charset=utf-8")
