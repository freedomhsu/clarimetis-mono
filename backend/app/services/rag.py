import json
import uuid

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.message import Message
from app.models.user_profile import UserProfile
from app.services.embeddings import embed_text


async def get_relevant_context(
    db: AsyncSession,
    user_id: uuid.UUID,
    query: str,
    limit: int | None = None,
    embedding: list[float] | None = None,
) -> list[str]:
    """Return the top-k semantically similar past messages for the given user."""
    resolved_limit = limit if limit is not None else get_settings().rag_context_limit
    query_embedding = embedding if embedding is not None else await embed_text(query)

    stmt = text(
        """
        SELECT m.role, m.content
        FROM messages m
        JOIN chat_sessions cs ON m.session_id = cs.id
        WHERE cs.user_id = :user_id
          AND m.embedding IS NOT NULL
        ORDER BY m.embedding <=> CAST(:embedding AS vector)
        LIMIT :limit
        """
    )
    result = await db.execute(
        stmt,
        {
            "user_id": str(user_id),
            "embedding": json.dumps(query_embedding),
            "limit": resolved_limit,
        },
    )
    rows = result.fetchall()
    return [f"{row.role}: {row.content}" for row in rows]


async def get_tier1_context(
    db: AsyncSession,
    query: str,
    limit: int | None = None,
    embedding: list[float] | None = None,
) -> list[str]:
    """Return the top-k most relevant Tier-1 knowledge docs for the given query.

    Returns empty list if the knowledge_docs table is not yet seeded.
    """
    try:
        resolved_limit = limit if limit is not None else get_settings().rag_tier1_limit
        query_embedding = embedding if embedding is not None else await embed_text(query)
        stmt = text(
            """
            SELECT title, content, category
            FROM knowledge_docs
            WHERE embedding IS NOT NULL
            ORDER BY embedding <=> CAST(:embedding AS vector)
            LIMIT :limit
            """
        )
        result = await db.execute(
            stmt,
            {"embedding": json.dumps(query_embedding), "limit": resolved_limit},
        )
        rows = result.fetchall()
        return [f"[{row.category}] {row.title}\n{row.content}" for row in rows]
    except Exception:
        # Table not yet created / seeded — rollback so the session stays usable
        await db.rollback()
        return []


async def get_user_profile_context(db: AsyncSession, user_id: uuid.UUID) -> str | None:
    """Return a formatted Tier-2 identity summary to prepend to the system prompt."""
    result = await db.execute(
        select(UserProfile).where(UserProfile.user_id == user_id)
    )
    profile = result.scalar_one_or_none()

    parts: list[str] = []

    if profile is None:
        return (
            "[User identity context]\n"
            "This is an early conversation — you don't know this person well yet. "
            "Focus on understanding them before offering advice. "
            "Ask a clarifying question to get beneath the surface of what they've shared."
        )

    parts.append(
        "You have spoken with this person before. "
        "Reference what they've shared in past sessions to show continuity."
    )

    if profile.core_values:
        parts.append(f"Core values: {profile.core_values}")
    if profile.long_term_goals:
        parts.append(f"Long-term goals: {profile.long_term_goals}")
    if profile.recurring_patterns:
        parts.append(f"Recurring patterns you've noticed: {profile.recurring_patterns}")

    telemetry = profile.telemetry or {}

    # Identity facts extracted from conversation history
    identity_facts: list[str] = telemetry.get("identity_facts", [])
    if identity_facts:
        parts.append("Known facts about this person: " + "; ".join(identity_facts))

    stress = telemetry.get("stress_score")
    if stress is not None:
        parts.append(f"Current stress score: {stress}/100")

    return "[User identity context]\n" + "\n".join(parts)


async def store_message_embedding(db: AsyncSession, message: Message) -> None:
    """Generate and persist an embedding for a message (called as a background task)."""
    embedding = await embed_text(message.content)
    message.embedding = embedding
    await db.commit()
