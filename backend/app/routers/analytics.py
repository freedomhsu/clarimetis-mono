import asyncio
import logging
from datetime import datetime, timezone
from functools import cache as _functools_cache

from cachetools import TTLCache
from fastapi import APIRouter, Depends
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, SettingsDep, get_settings
from app.database import get_db
from app.middleware.subscription import require_pro
from app.models.message import Message
from app.models.score_snapshot import ScoreSnapshot
from app.models.session import ChatSession
from app.models.user import User
from app.routers.users import SUPPORTED_LANGUAGES
from app.schemas.analytics import AnalyticsSummary, ScoreHistory
from app.services.gemini import generate_analytics

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analytics", tags=["analytics"])


# ── Cache initialisation ──────────────────────────────────────────────────────
#
# Caches are initialised lazily on first use, not at import time, so that
# test suites can override Settings via dependency_overrides before the caches
# are sized.  functools.cache memoises per (maxsize, ttl) pair — in production
# there is exactly one pair, so only one set of caches is ever created.
# Tests that need a clean slate call `_make_caches.cache_clear()`.

@_functools_cache
def _make_caches(maxsize: int, ttl: int) -> tuple[TTLCache, TTLCache]:
    """Return the (analytics_cache, lock_cache) singletons for the given settings."""
    return (
        TTLCache(maxsize=maxsize, ttl=ttl),
        TTLCache(maxsize=maxsize, ttl=ttl * 2),
    )


def _get_caches(settings: Settings) -> tuple[TTLCache, TTLCache]:
    return _make_caches(settings.analytics_cache_maxsize, settings.analytics_cache_ttl)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _empty_summary(session_count: int, message_count: int, now_iso: str) -> dict:
    """Return the canonical "insufficient data" response dict.

    Used for both the zero-messages fast-path and as the fallback when Gemini
    returns data that fails schema validation.
    """
    return {
        "total_sessions": session_count,
        "total_messages": message_count,
        "data_reliability": "insufficient",
        "confidence_score": None,
        "anxiety_score": None,
        "self_esteem_score": None,
        "ego_score": None,
        "emotion_control_score": None,
        "self_awareness_score": None,
        "motivation_score": None,
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


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/summary", response_model=AnalyticsSummary)
async def get_analytics_summary(
    settings: SettingsDep,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_pro),
    force: bool = False,
) -> dict:
    analytics_cache, analytics_locks = _get_caches(settings)

    cache_key = str(user.id)

    # Bust the cache when the client explicitly requests fresh data.
    if force:
        analytics_cache.pop(cache_key, None)

    # Return cached result if still fresh.
    cached = analytics_cache.get(cache_key)
    if cached is not None:
        return cached

    # One concurrent Gemini call per user — others wait and reuse the result.
    # setdefault() is atomic for in-process dict/TTLCache operations: it either
    # returns the existing lock or inserts the new one in a single step, closing
    # the TOCTOU window where two coroutines could both see None and each create
    # an independent lock (defeating the serialisation guarantee).
    lock = analytics_locks.setdefault(cache_key, asyncio.Lock())

    async with lock:
        # Re-check after acquiring lock — a concurrent waiter may have populated
        # the cache while we were blocked.
        cached = analytics_cache.get(cache_key)
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
            # Zero messages — return immediately without calling Gemini.
            # Not cached: once the user adds messages the next call must
            # reach Gemini rather than serving this stale empty response.
            return _empty_summary(session_count or 0, 0, now_iso)

        snippets_result = await db.execute(
            select(Message.content)
            .join(ChatSession, Message.session_id == ChatSession.id)
            .where(ChatSession.user_id == user.id, Message.role == "user")
            .order_by(Message.created_at.desc())
            .limit(settings.analytics_snippet_limit)
        )
        snippets = [row[0] for row in snippets_result.fetchall()]

        # Sanitise language: fall back to "en" if the stored value is somehow
        # not in the supported set (e.g. a legacy row or direct DB edit).
        lang = user.preferred_language if user.preferred_language in SUPPORTED_LANGUAGES else "en"
        analytics = await generate_analytics(snippets, language=lang)
        analytics["total_sessions"] = session_count or 0
        analytics["total_messages"] = message_count or 0
        analytics["generated_at"] = now_iso

        # Validate the enriched dict against the response schema *before* caching
        # or writing a snapshot.  If Gemini returns a field value outside the
        # allowed Literal / range (e.g. a score of 150 or an unknown urgency
        # string), this surfaces a clear warning rather than a 500 from FastAPI's
        # response-serialisation layer.
        try:
            AnalyticsSummary.model_validate(analytics)
        except ValidationError as exc:
            logger.warning("Analytics schema validation failed — returning empty summary: %s", exc)
            return _empty_summary(session_count or 0, message_count or 0, now_iso)

        # Only persist a snapshot and cache when Gemini produced a real result.
        # The generate_analytics fallback returns data_reliability="insufficient"
        # with all scores None when it hits an exception — caching that would
        # lock the user out for the full TTL, and writing an all-None snapshot
        # would appear as a flat zero-line in the history chart.
        generated_successfully = analytics.get("data_reliability") != "insufficient"

        if generated_successfully:
            snapshot = ScoreSnapshot(
                user_id=user.id,
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

            analytics_cache[cache_key] = analytics

        return analytics


@router.get("/history", response_model=ScoreHistory)
async def get_score_history(
    settings: SettingsDep,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_pro),
) -> dict:
    """Return score snapshots for time-series charts."""
    rows_result = await db.execute(
        select(ScoreSnapshot)
        .where(ScoreSnapshot.user_id == user.id)
        # Fetch newest N first so LIMIT keeps the most recent snapshots, then
        # reverse so the chart receives them in chronological (oldest→newest) order.
        .order_by(ScoreSnapshot.created_at.desc())
        .limit(settings.analytics_history_limit)
    )
    rows = list(reversed(rows_result.scalars().all()))

    points = [
        {
            # created_at is TIMESTAMPTZ — asyncpg returns a tz-aware datetime,
            # so .isoformat() already includes the UTC offset.  Using .replace()
            # would silently truncate any non-UTC tzinfo; .isoformat() is safe.
            "date": row.created_at.isoformat(),
            "confidence": row.confidence_score,
            "anxiety": row.anxiety_score,
            "self_esteem": row.self_esteem_score,
            "stress": row.stress_load,
            "social": row.social_gratitude_index,
            "ego": row.ego_score,
            "emotion_control": row.emotion_control_score,
            "self_awareness": row.self_awareness_score,
            "motivation": row.motivation_score,
        }
        for row in rows
    ]
    return {"points": points}

