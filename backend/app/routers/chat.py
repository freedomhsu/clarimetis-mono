import asyncio
import uuid
from collections.abc import AsyncGenerator

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import SettingsDep
from app.database import AsyncSessionLocal, get_db
from app.models.message import Message
from app.models.session import ChatSession
from app.models.user import User
from app.schemas.chat import ChatRequest, MessageOut
from app.middleware.subscription import check_message_quota, get_current_user
from app.services.crisis_detection import detect_crisis
from app.services.embeddings import embed_text
from app.services.gateway import classify_intent, get_system_prompt
from app.services.gemini import generate_session_summary, generate_session_title, stream_chat_response
from app.services.profile import refresh_user_profile
from app.services.rag import get_relevant_context, get_tier1_context, get_user_profile_context, store_message_embedding
from app.services.sentiment import score_sentiment
from app.services.storage import is_blob_path, sign_blob_path

router = APIRouter(prefix="/sessions/{session_id}/messages", tags=["chat"])


async def _get_session_for_user(
    session_id: uuid.UUID, user: User, db: AsyncSession
) -> ChatSession:
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


async def _update_session_title(session_id: uuid.UUID, first_message: str) -> None:
    async with AsyncSessionLocal() as db:
        title = await generate_session_title(first_message)
        result = await db.execute(select(ChatSession).where(ChatSession.id == session_id))
        session = result.scalar_one_or_none()
        if session:
            session.title = title
            await db.commit()


async def _update_session_summary(session_id: uuid.UUID) -> None:
    """Regenerate and persist a session summary after each assistant reply (>= 4 messages)."""
    async with AsyncSessionLocal() as db:
        msgs_result = await db.execute(
            select(Message)
            .where(Message.session_id == session_id)
            .order_by(Message.created_at)
        )
        msgs = list(msgs_result.scalars().all())
        if len(msgs) < 4:
            return
        history = [{"role": m.role, "content": m.content} for m in msgs]
        summary = await generate_session_summary(history)
        if not summary:
            return
        session_result = await db.execute(select(ChatSession).where(ChatSession.id == session_id))
        session = session_result.scalar_one_or_none()
        if session:
            session.summary = summary
            await db.commit()


@router.get("", response_model=list[MessageOut])
async def get_messages(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[Message]:
    session = await _get_session_for_user(session_id, user, db)
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
async def send_message(
    session_id: uuid.UUID,
    body: ChatRequest,
    background_tasks: BackgroundTasks,
    settings: SettingsDep,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(check_message_quota),
) -> StreamingResponse:
    import asyncio

    session = await _get_session_for_user(session_id, user, db)

    # Run blocking pre-work before the stream so that:
    #   a) the user message is committed to DB before we return a response,
    #      ensuring subsequent requests' quota checks see the correct count; and
    #   b) crisis / intent results are ready before any bytes are sent.
    # detect_crisis and classify_intent are pure LLM calls (no DB) — safe to gather.
    # get_user_profile_context uses the same DB session so must run separately.
    crisis_result, intent = await asyncio.gather(
        detect_crisis(body.content),
        classify_intent(body.content),
    )
    profile_context = await get_user_profile_context(db, user.id)
    is_crisis = crisis_result.get("is_crisis", False)
    system_prompt = get_system_prompt(intent)

    # Persist the user message NOW — before the StreamingResponse is returned.
    user_msg = Message(
        session_id=session.id,
        role="user",
        content=body.content,
        media_urls=body.media_urls,
        crisis_flagged=is_crisis,
    )
    db.add(user_msg)
    await db.commit()
    await db.refresh(user_msg)

    background_tasks.add_task(_store_user_msg_embedding, user_msg.id, body.content)
    background_tasks.add_task(_score_and_store_sentiment, user_msg.id, body.content)

    if session.title == "New Session":
        background_tasks.add_task(_update_session_title, session.id, body.content)

    accumulated: list[str] = []

    async def generate() -> AsyncGenerator[str, None]:
        yield "\x00STATUS\x00:Retrieving relevant memories...\n"
        # Compute the query embedding once and reuse it for both RAG lookups,
        # saving one Vertex AI round-trip (~300 ms) per message.
        query_embedding = await embed_text(body.content)
        history_rows = await db.execute(
            select(Message)
            .where(Message.session_id == session.id)
            .order_by(Message.created_at)
            .limit(40)
        )
        history = [{"role": m.role, "content": m.content} for m in history_rows.scalars().all()]
        # Run DB queries sequentially — asyncpg does not allow concurrent
        # operations on the same connection/session.
        rag_context = await get_relevant_context(db, user.id, body.content, embedding=query_embedding)
        tier1_context = await get_tier1_context(db, body.content, embedding=query_embedding)

        if rag_context:
            yield f"\x00STATUS\x00:Found {len(rag_context)} relevant context item(s)...\n"

        yield "\x00STATUS\x00:Generating response...\n"

        if is_crisis:
            accumulated.append(settings.crisis_banner_text)
            yield settings.crisis_banner_text

        async for chunk in stream_chat_response(
            user_message=body.content,
            conversation_history=history,
            rag_context=rag_context,
            tier1_context=tier1_context,
            media_urls=body.media_urls,
            system_prompt=system_prompt,
            profile_context=profile_context,
        ):
            accumulated.append(chunk)
            yield chunk

        background_tasks.add_task(
            _save_assistant_message, session.id, "".join(accumulated), is_crisis
        )
        background_tasks.add_task(refresh_user_profile, user.id)
        background_tasks.add_task(_update_session_summary, session.id)

    return StreamingResponse(generate(), media_type="text/plain; charset=utf-8")
