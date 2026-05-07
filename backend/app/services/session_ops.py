"""Session lifecycle background operations.

Shared by the chat and voice routers so the logic lives in exactly one place.
Both functions are designed to run as ``BackgroundTasks``; they open their own
``AsyncSessionLocal`` sessions so they are safe to call after the request
session has already been closed.
"""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.database import AsyncSessionLocal
from app.models.message import Message
from app.models.score_snapshot import ScoreSnapshot
from app.models.session import ChatSession
from app.services.gemini import generate_analytics, generate_session_summary, generate_session_title


async def update_session_title(session_id: uuid.UUID, first_message: str) -> None:
    """Generate a title from *first_message* and persist it on the session."""
    async with AsyncSessionLocal() as db:
        title = await generate_session_title(first_message)
        result = await db.execute(select(ChatSession).where(ChatSession.id == session_id))
        session = result.scalar_one_or_none()
        if session:
            session.title = title
            await db.commit()


async def update_session_summary(session_id: uuid.UUID) -> None:
    """Regenerate and persist a session summary once >= 4 messages exist."""
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
        session_result = await db.execute(
            select(ChatSession).where(ChatSession.id == session_id)
        )
        session = session_result.scalar_one_or_none()
        if session:
            session.summary = summary
            await db.commit()


async def maybe_snapshot_scores(user_id: uuid.UUID) -> None:
    """Persist at most one score snapshot per UTC calendar day.

    Called as a ``BackgroundTask`` after each assistant reply so daily trends
    are recorded even when the user never opens the Insights page.
    Exits early if a snapshot already exists for today (UTC) or if the user
    has fewer than 5 messages — not enough signal for a reliable score.
    """
    now_utc = datetime.now(timezone.utc)
    day_start = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)

    async with AsyncSessionLocal() as db:
        # Guard: skip if a snapshot was already created today (UTC)
        already = await db.scalar(
            select(func.count())
            .select_from(ScoreSnapshot)
            .where(
                ScoreSnapshot.user_id == user_id,
                ScoreSnapshot.created_at >= day_start,
                ScoreSnapshot.created_at < day_end,
            )
        )
        if already:
            return

        snippets_result = await db.execute(
            select(Message.content)
            .join(ChatSession, Message.session_id == ChatSession.id)
            .where(ChatSession.user_id == user_id, Message.role == "user")
            .order_by(Message.created_at.desc())
            .limit(50)
        )
        snippets = [row[0] for row in snippets_result.fetchall()]
        if len(snippets) < 5:
            return  # not enough data for a meaningful score

        analytics = await generate_analytics(snippets)
        snapshot = ScoreSnapshot(
            user_id=user_id,
            confidence_score=analytics.get("confidence_score"),
            anxiety_score=analytics.get("anxiety_score"),
            self_esteem_score=analytics.get("self_esteem_score"),
            ego_score=analytics.get("ego_score"),
            emotion_control_score=analytics.get("emotion_control_score"),
            self_awareness_score=analytics.get("self_awareness_score"),
            motivation_score=analytics.get("motivation_score"),
            stress_load=analytics.get("stress_load"),
            social_gratitude_index=analytics.get("social_gratitude_index"),
            data_reliability=analytics.get("data_reliability", "insufficient"),
        )
        db.add(snapshot)
        await db.commit()
