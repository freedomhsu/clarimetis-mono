import asyncio
from datetime import datetime, timezone

from cachetools import TTLCache
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.middleware.subscription import require_pro
from app.models.message import Message
from app.models.score_snapshot import ScoreSnapshot
from app.models.session import ChatSession
from app.models.user import User
from app.schemas.analytics import AnalyticsSummary, ScoreHistory
from app.services.gemini import generate_analytics

router = APIRouter(prefix="/analytics", tags=["analytics"])

# Bounded TTL cache: max 1 000 users, entries expire after analytics_cache_ttl seconds.
# TTLCache handles eviction automatically — no memory leak.
_analytics_cache: TTLCache = TTLCache(maxsize=1_000, ttl=get_settings().analytics_cache_ttl)
_analytics_locks: TTLCache = TTLCache(maxsize=1_000, ttl=get_settings().analytics_cache_ttl * 2)


@router.get("/summary", response_model=AnalyticsSummary)
async def get_analytics_summary(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_pro),
) -> dict:
    # Return cached result if still fresh
    cache_key = str(user.id)
    cached = _analytics_cache.get(cache_key)
    if cached is not None:
        return cached

    # One concurrent Gemini call per user — others wait and reuse the result.
    # TTLCache auto-evicts the lock entry after 2× the analytics TTL.
    if cache_key not in _analytics_locks:
        _analytics_locks[cache_key] = asyncio.Lock()
    async with _analytics_locks[cache_key]:
        # Re-check after acquiring lock
        cached = _analytics_cache.get(cache_key)
        if cached is not None:
            return cached

        session_count = await db.scalar(
            select(func.count()).select_from(ChatSession).where(ChatSession.user_id == user.id)
        )
        message_count = await db.scalar(
            select(func.count())
            .select_from(Message)
            .join(ChatSession, Message.session_id == ChatSession.id)
            .where(ChatSession.user_id == user.id, Message.role == "user")
        )

        now_iso = datetime.now(timezone.utc).isoformat()

        if not message_count:
            return {
                "total_sessions": session_count or 0,
                "total_messages": 0,
                "data_reliability": "insufficient",
                "confidence_score": None,
                "anxiety_score": None,
                "self_esteem_score": None,
                "stress_load": None,
                "cognitive_noise": None,
                "logic_loops": [],
                "insights": [],
                "recommendations": [],
                "focus_areas": [],
                "relational_observations": [],
                "social_gratitude_index": None,
                "priority_stack": [],
                "generated_at": now_iso,
            }

        snippets_result = await db.execute(
            select(Message.content)
            .join(ChatSession, Message.session_id == ChatSession.id)
            .where(ChatSession.user_id == user.id, Message.role == "user")
            .order_by(Message.created_at.desc())
            .limit(50)
        )
        snippets = [row[0] for row in snippets_result.fetchall()]

        analytics = await generate_analytics(snippets)
        analytics["total_sessions"] = session_count or 0
        analytics["total_messages"] = message_count or 0
        analytics["generated_at"] = now_iso

        # Persist a score snapshot so we can render a time-series chart
        snapshot = ScoreSnapshot(
            user_id=user.id,
            confidence_score=analytics.get("confidence_score"),
            anxiety_score=analytics.get("anxiety_score"),
            self_esteem_score=analytics.get("self_esteem_score"),
            stress_load=analytics.get("stress_load"),
            social_gratitude_index=analytics.get("social_gratitude_index"),
            data_reliability=analytics.get("data_reliability", "insufficient"),
        )
        db.add(snapshot)
        await db.commit()

        _analytics_cache[cache_key] = analytics
        return analytics


@router.get("/history", response_model=ScoreHistory)
async def get_score_history(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_pro),
) -> dict:
    """Return the last 30 score snapshots for time-series charts."""
    rows_result = await db.execute(
        select(ScoreSnapshot)
        .where(ScoreSnapshot.user_id == user.id)
        .order_by(ScoreSnapshot.created_at.asc())
        .limit(30)
    )
    rows = rows_result.scalars().all()

    points = [
        {
            "date": row.created_at.strftime("%b %d"),
            "confidence": row.confidence_score,
            "anxiety": row.anxiety_score,
            "self_esteem": row.self_esteem_score,
            "stress": row.stress_load,
            "social": row.social_gratitude_index,
        }
        for row in rows
    ]
    return {"points": points}
