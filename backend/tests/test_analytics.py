"""Tests for analytics backend.

Covers:
  Schemas (app/schemas/analytics.py):
    - Score valid range (0, 50, 100)
    - Score rejects values below 0 and above 100
    - WellnessInsight rejects unknown trend
    - Recommendation rejects unknown type
    - PriorityItem rejects unknown urgency
    - PrimaryLoop.frequency rejects negative values
    - AnalyticsSummary extra fields silently ignored (extra="ignore")
    - AnalyticsSummary validates a fully-populated dict

  _empty_summary helper (app/routers/analytics.py):
    - Returns correct shape with the right values for all fields

  generate_analytics service (app/services/gemini.py):
    - Happy path: all expected keys present in returned dict
    - Legacy primary_loop key migrated to logic_loops list
    - Returns insufficient fallback when model returns invalid JSON
    - Returns insufficient fallback when Gemini raises an exception

  GET /analytics/summary:
    - 402 for free-tier user
    - Returns insufficient summary (no Gemini call) when message_count == 0
    - Returns Gemini result enriched with session/message counts
    - Writes a ScoreSnapshot when data_reliability != "insufficient"
    - Does NOT write a snapshot when data_reliability == "insufficient"
    - Caches successful result; second request does not call Gemini again
    - Does NOT cache insufficient result; second request calls Gemini again
    - Returns empty summary (not 500) when Gemini data fails schema validation

  GET /analytics/history:
    - 402 for free-tier user
    - Returns {"points": []} when no snapshots exist
    - Maps ScoreSnapshot column names to ScorePoint field names correctly
    - Returns points in chronological order (oldest-first)
"""

import json
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.config import get_settings
from app.database import get_db
from app.main import app
from app.middleware.subscription import get_current_user, require_pro
from app.models.score_snapshot import ScoreSnapshot
from app.routers.analytics import _empty_summary, _make_caches
from app.schemas.analytics import (
    AnalyticsSummary,
    PrimaryLoop,
    PriorityItem,
    Recommendation,
    WellnessInsight,
)
from tests.conftest import make_user

# ── Shared fixtures / helpers ─────────────────────────────────────────────────

_PRO_USER = make_user(subscription_tier="pro")
_FREE_USER = make_user(subscription_tier="free")


def _test_settings() -> MagicMock:
    """Minimal Settings-like mock for dependency injection in router tests."""
    s = MagicMock()
    s.analytics_cache_maxsize = 4
    s.analytics_cache_ttl = 300
    s.analytics_snippet_limit = 50
    s.analytics_history_limit = 90
    return s


def _make_summary_db(
    *,
    session_count: int,
    message_count: int,
    snippets: list[str] | None = None,
) -> AsyncMock:
    """Mock DB whose scalar()/execute() calls behave as the summary router expects.

    scalar() is called twice (session_count, then message_count).
    execute() is called once for snippet retrieval (only when message_count > 0).
    """
    db = AsyncMock()
    db.commit = AsyncMock()
    db.add = MagicMock()
    db.scalar.side_effect = [session_count, message_count, None]

    snippets_result = MagicMock()
    snippets_result.fetchall.return_value = [(s,) for s in (snippets or [])]
    db.execute.return_value = snippets_result
    return db


def _make_history_db(rows: list) -> AsyncMock:
    """Mock DB whose execute() call returns a scalars().all() list."""
    db = AsyncMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = rows
    db.execute.return_value = result
    return db


def _make_snapshot(
    *,
    created_at: datetime,
    confidence_score: int | None = None,
    anxiety_score: int | None = None,
    self_esteem_score: int | None = None,
    stress_load: int | None = None,
    social_gratitude_index: int | None = None,
    ego_score: int | None = None,
    emotion_control_score: int | None = None,
) -> MagicMock:
    row = MagicMock()
    row.created_at = created_at
    row.confidence_score = confidence_score
    row.anxiety_score = anxiety_score
    row.self_esteem_score = self_esteem_score
    row.stress_load = stress_load
    row.social_gratitude_index = social_gratitude_index
    row.ego_score = ego_score
    row.emotion_control_score = emotion_control_score
    return row


# Sample dict that represents a successful Gemini analytics result.
_FULL_GEMINI_RESULT: dict = {
    "data_reliability": "moderate",
    "confidence_score": 65,
    "anxiety_score": 42,
    "self_esteem_score": 58,
    "ego_score": 52,
    "emotion_control_score": 67,
    "stress_load": 38,
    "cognitive_noise": "moderate",
    "logic_loops": [
        {"topic": "Imposter syndrome", "frequency": 9, "efficiency": 35, "fix_type": "Cognitive reframe"},
    ],
    "insights": [{"category": "Growth", "observation": "Positive pattern.", "trend": "improving"}],
    "recommendations": [
        {"type": "practice", "title": "Box Breathing", "description": "4-4-4-4.", "why": "Stress."},
    ],
    "focus_areas": ["Confidence", "Stress regulation"],
    "relational_observations": [],
    "social_gratitude_index": 61,
    "priority_stack": [
        {"rank": 1, "category": "Regulation", "action": "Sleep ritual", "reasoning": "Load.", "urgency": "high"},
    ],
}

_INSUFFICIENT_GEMINI_RESULT: dict = {
    "data_reliability": "insufficient",
    "confidence_score": None,
    "anxiety_score": None,
    "self_esteem_score": None,
    "ego_score": None,
    "emotion_control_score": None,
    "stress_load": None,
    "cognitive_noise": None,
    "logic_loops": [],
    "insights": [],
    "recommendations": [],
    "focus_areas": [],
    "relational_observations": [],
    "social_gratitude_index": None,
    "priority_stack": [],
}


@pytest.fixture(autouse=True)
def _clear_analytics_cache():
    """Reset the functools.cache on _make_caches before every test.

    Without this, TTLCache instances created in one test persist into the next,
    causing cache-hit false positives and inter-test state bleed.
    """
    _make_caches.cache_clear()
    yield
    _make_caches.cache_clear()


def _override(db: AsyncMock, *, free: bool = False):
    settings = _test_settings()
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_db] = lambda: db
    if free:
        # Let require_pro run for real — override get_current_user to return free user.
        app.dependency_overrides[get_current_user] = lambda: _FREE_USER
    else:
        app.dependency_overrides[require_pro] = lambda: _PRO_USER


def _clear():
    app.dependency_overrides.clear()


# ── Schema unit tests ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("value", [0, 1, 50, 99, 100])
def test_score_accepts_valid_range(value):
    """Score type accepts integers in [0, 100]."""
    model = AnalyticsSummary(
        total_sessions=1,
        total_messages=5,
        data_reliability="low",
        confidence_score=value,
        generated_at="2026-05-03T10:00:00+00:00",
    )
    assert model.confidence_score == value


@pytest.mark.parametrize("value", [-1, 101, -100, 200])
def test_score_rejects_out_of_range(value):
    """Score type rejects integers outside [0, 100]."""
    with pytest.raises(ValidationError):
        AnalyticsSummary(
            total_sessions=1,
            total_messages=5,
            data_reliability="low",
            confidence_score=value,
            generated_at="2026-05-03T10:00:00+00:00",
        )


@pytest.mark.parametrize("bad_trend", ["getting_better", "worsening", "neutral", ""])
def test_wellness_insight_rejects_unknown_trend(bad_trend):
    """WellnessInsight.trend must be one of: improving, declining, stable, null."""
    with pytest.raises(ValidationError):
        WellnessInsight(category="Growth", observation="Test.", trend=bad_trend)


def test_wellness_insight_accepts_null_trend():
    """WellnessInsight.trend=None is valid (insufficient data)."""
    insight = WellnessInsight(category="Growth", observation="Test.", trend=None)
    assert insight.trend is None


@pytest.mark.parametrize("bad_type", ["article", "video", "podcast", ""])
def test_recommendation_rejects_unknown_type(bad_type):
    """Recommendation.type must be one of: book, practice, course, strategy."""
    with pytest.raises(ValidationError):
        Recommendation(type=bad_type, title="T", description="D", why="W")


@pytest.mark.parametrize("bad_urgency", ["critical_high", "urgent", "soon", ""])
def test_priority_item_rejects_unknown_urgency(bad_urgency):
    """PriorityItem.urgency must be one of: critical, high, medium, low."""
    with pytest.raises(ValidationError):
        PriorityItem(rank=1, category="Growth", action="A", reasoning="R", urgency=bad_urgency)


def test_primary_loop_frequency_must_be_non_negative():
    """PrimaryLoop.frequency has ge=0 — negative values must be rejected."""
    with pytest.raises(ValidationError):
        PrimaryLoop(topic="Topic", frequency=-1, efficiency=50, fix_type="Reframe")


def test_analytics_summary_ignores_extra_fields():
    """AnalyticsSummary has extra='ignore' — unknown fields must not raise."""
    data = {
        "total_sessions": 3,
        "total_messages": 20,
        "data_reliability": "low",
        "generated_at": "2026-05-03T10:00:00+00:00",
        "unknown_field_from_future_gemini_version": "some_value",
    }
    model = AnalyticsSummary.model_validate(data)
    assert not hasattr(model, "unknown_field_from_future_gemini_version")


def test_analytics_summary_validates_full_dict():
    """model_validate must succeed on a fully-populated Gemini result dict."""
    data = {
        **_FULL_GEMINI_RESULT,
        "total_sessions": 12,
        "total_messages": 84,
        "generated_at": "2026-05-03T10:00:00+00:00",
    }
    model = AnalyticsSummary.model_validate(data)
    assert model.data_reliability == "moderate"
    assert model.confidence_score == 65
    assert len(model.logic_loops) == 1
    assert model.logic_loops[0].topic == "Imposter syndrome"


# ── _empty_summary helper unit tests ─────────────────────────────────────────

def test_empty_summary_has_correct_shape():
    """`_empty_summary` must return the canonical insufficient dict with correct keys."""
    now = datetime.now(timezone.utc).isoformat()
    result = _empty_summary(session_count=3, message_count=0, now_iso=now)

    assert result["total_sessions"] == 3
    assert result["total_messages"] == 0
    assert result["data_reliability"] == "insufficient"
    assert result["generated_at"] == now

    # All score fields must be None.
    for key in ("confidence_score", "anxiety_score", "self_esteem_score",
                "ego_score", "emotion_control_score", "stress_load",
                "cognitive_noise", "social_gratitude_index"):
        assert result[key] is None, f"Expected {key} to be None"

    # All list fields must be empty.
    for key in ("logic_loops", "insights", "recommendations",
                "focus_areas", "relational_observations", "priority_stack"):
        assert result[key] == [], f"Expected {key} to be []"

    # Must be valid against the schema.
    AnalyticsSummary.model_validate(result)


# ── generate_analytics service unit tests ────────────────────────────────────

async def test_generate_analytics_happy_path():
    """On a valid JSON response, all expected keys must be present."""
    from app.services.gemini import generate_analytics

    response_text = json.dumps({
        "data_reliability": "moderate",
        "confidence_score": 65,
        "anxiety_score": 42,
        "self_esteem_score": 58,
        "ego_score": 52,
        "emotion_control_score": 67,
        "stress_load": 38,
        "cognitive_noise": "moderate",
        "logic_loops": [],
        "insights": [],
        "recommendations": [],
        "focus_areas": ["Confidence"],
        "relational_observations": [],
        "social_gratitude_index": None,
        "priority_stack": [],
    })

    mock_response = MagicMock()
    mock_response.text = response_text
    mock_model = MagicMock()
    mock_model.generate_content.return_value = mock_response

    async def _fake_to_thread(fn, *args, **kwargs):
        return fn()

    with (
        patch("app.services.gemini.GenerativeModel", return_value=mock_model),
        patch("app.services.gemini.init_vertexai"),
        patch("app.services.gemini.asyncio.to_thread", side_effect=_fake_to_thread),
        patch("app.services.gemini.get_settings") as mock_settings,
    ):
        mock_settings.return_value.gemini_pro_model = "gemini-2.5-pro"
        mock_settings.return_value.gemini_analytics_timeout = 60
        result = await generate_analytics(["Hello there", "I feel anxious"])

    assert result["data_reliability"] == "moderate"
    assert result["confidence_score"] == 65
    assert "logic_loops" in result
    assert "primary_loop" not in result  # old field must be absent


async def test_generate_analytics_migrates_primary_loop():
    """If Gemini returns legacy primary_loop, it must be migrated to logic_loops."""
    from app.services.gemini import generate_analytics

    legacy_loop = {"topic": "Legacy", "frequency": 5, "efficiency": 40, "fix_type": "Reframe"}
    response_text = json.dumps({
        "data_reliability": "low",
        "primary_loop": legacy_loop,   # old field
        "logic_loops": [],             # empty — migration should populate this
        "insights": [], "recommendations": [], "focus_areas": [],
        "relational_observations": [], "social_gratitude_index": None, "priority_stack": [],
    })

    mock_response = MagicMock()
    mock_response.text = response_text
    mock_model = MagicMock()
    mock_model.generate_content.return_value = mock_response

    async def _fake_to_thread(fn, *args, **kwargs):
        return fn()

    with (
        patch("app.services.gemini.GenerativeModel", return_value=mock_model),
        patch("app.services.gemini.init_vertexai"),
        patch("app.services.gemini.asyncio.to_thread", side_effect=_fake_to_thread),
        patch("app.services.gemini.get_settings") as mock_settings,
    ):
        mock_settings.return_value.gemini_pro_model = "gemini-2.5-pro"
        mock_settings.return_value.gemini_analytics_timeout = 60
        result = await generate_analytics(["Test"])

    assert len(result["logic_loops"]) == 1
    assert result["logic_loops"][0]["topic"] == "Legacy"
    assert "primary_loop" not in result


async def test_generate_analytics_fallback_on_invalid_json():
    """If the model returns non-JSON text, the fallback insufficient dict is returned."""
    from app.services.gemini import generate_analytics

    mock_response = MagicMock()
    mock_response.text = "Sorry, I cannot generate a JSON response right now."
    mock_model = MagicMock()
    mock_model.generate_content.return_value = mock_response

    async def _fake_to_thread(fn, *args, **kwargs):
        return fn()

    with (
        patch("app.services.gemini.GenerativeModel", return_value=mock_model),
        patch("app.services.gemini.init_vertexai"),
        patch("app.services.gemini.asyncio.to_thread", side_effect=_fake_to_thread),
        patch("app.services.gemini.get_settings") as mock_settings,
    ):
        mock_settings.return_value.gemini_pro_model = "gemini-2.5-pro"
        result = await generate_analytics(["Test"])

    assert result["data_reliability"] == "insufficient"
    assert result["confidence_score"] is None
    assert result["logic_loops"] == []


async def test_generate_analytics_fallback_on_exception():
    """If the Gemini call raises, the fallback insufficient dict is returned."""
    from app.services.gemini import generate_analytics

    async def _raising_to_thread(fn, *args, **kwargs):
        raise asyncio.TimeoutError()

    with (
        patch("app.services.gemini.GenerativeModel"),
        patch("app.services.gemini.init_vertexai"),
        patch("app.services.gemini.asyncio.to_thread", side_effect=_raising_to_thread),
        patch("app.services.gemini.get_settings") as mock_settings,
    ):
        mock_settings.return_value.gemini_pro_model = "gemini-2.5-pro"
        result = await generate_analytics(["Test"])

    assert result["data_reliability"] == "insufficient"
    assert result["confidence_score"] is None


async def test_generate_analytics_does_not_re_slice_snippets():
    """generate_analytics must not internally re-slice snippets[:50].

    The caller (analytics router) already applies .limit(settings.analytics_snippet_limit).
    A hidden [:50] inside the service would silently override the config value.
    """
    from app.services.gemini import generate_analytics

    captured: list[str] = []

    def _capture_prompt(prompt: str):
        captured.append(prompt)
        return MagicMock(text=json.dumps({
            "data_reliability": "high",
            "confidence_score": 70,
            "anxiety_score": 30,
            "self_esteem_score": 60,
            "ego_score": 45,
            "emotion_control_score": 75,
            "stress_load": 25,
            "cognitive_noise": "low",
            "logic_loops": [],
            "insights": [],
            "recommendations": [],
            "focus_areas": [],
            "relational_observations": [],
            "social_gratitude_index": None,
            "priority_stack": [],
        }))

    mock_model = MagicMock()
    mock_model.generate_content.side_effect = _capture_prompt

    async def _fake_to_thread(fn, *args, **kwargs):
        return fn(*args, **kwargs)

    # Provide 60 snippets — all 60 should appear in the prompt if no internal slice.
    snippets = [f"Message {i}" for i in range(60)]

    with (
        patch("app.services.gemini.GenerativeModel", return_value=mock_model),
        patch("app.services.gemini.init_vertexai"),
        patch("app.services.gemini.asyncio.to_thread", side_effect=_fake_to_thread),
        patch("app.services.gemini.get_settings") as mock_settings,
    ):
        mock_settings.return_value.gemini_pro_model = "gemini-2.5-pro"
        mock_settings.return_value.gemini_analytics_timeout = 60
        await generate_analytics(snippets)

    assert len(captured) == 1
    prompt = captured[0]
    # All 60 messages should be present in the prompt (no internal [:50] truncation).
    assert "Message 59" in prompt, "generate_analytics truncated snippets internally"


# ── GET /analytics/summary router tests ──────────────────────────────────────

async def test_summary_returns_402_for_free_user():
    """Free-tier users must receive 402 Payment Required."""
    db = AsyncMock()
    _override(db, free=True)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/api/v1/analytics/summary")
    finally:
        _clear()

    assert resp.status_code == 402
    body = resp.json()
    assert body["detail"]["code"] == "subscription_required"


async def test_summary_returns_insufficient_when_no_messages():
    """When message_count == 0, the router must return insufficient immediately (no Gemini call)."""
    db = _make_summary_db(session_count=3, message_count=0)
    _override(db)
    try:
        with patch("app.routers.analytics.generate_analytics") as mock_gen:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                resp = await client.get("/api/v1/analytics/summary")
    finally:
        _clear()

    assert resp.status_code == 200
    body = resp.json()
    assert body["data_reliability"] == "insufficient"
    assert body["total_sessions"] == 3
    assert body["total_messages"] == 0
    mock_gen.assert_not_called()


async def test_summary_returns_gemini_result_enriched_with_counts():
    """When messages exist, Gemini is called and the result is enriched with counts."""
    db = _make_summary_db(session_count=5, message_count=42, snippets=["msg1"])
    _override(db)
    try:
        with patch("app.routers.analytics.generate_analytics", return_value=dict(_FULL_GEMINI_RESULT)):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                resp = await client.get("/api/v1/analytics/summary")
    finally:
        _clear()

    assert resp.status_code == 200
    body = resp.json()
    assert body["data_reliability"] == "moderate"
    assert body["total_sessions"] == 5
    assert body["total_messages"] == 42
    assert "generated_at" in body


async def test_summary_writes_snapshot_on_success():
    """A ScoreSnapshot row must be written to the DB on a successful (non-insufficient) result."""
    db = _make_summary_db(session_count=5, message_count=42, snippets=["msg1"])
    _override(db)
    try:
        with patch("app.routers.analytics.generate_analytics", return_value=dict(_FULL_GEMINI_RESULT)):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                resp = await client.get("/api/v1/analytics/summary")
    finally:
        _clear()

    assert resp.status_code == 200
    db.add.assert_called_once()
    db.commit.assert_awaited_once()


async def test_summary_does_not_write_snapshot_when_insufficient():
    """When Gemini returns insufficient data, NO snapshot must be written."""
    db = _make_summary_db(session_count=1, message_count=3, snippets=["hi"])
    _override(db)
    try:
        with patch(
            "app.routers.analytics.generate_analytics",
            return_value=dict(_INSUFFICIENT_GEMINI_RESULT),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                resp = await client.get("/api/v1/analytics/summary")
    finally:
        _clear()

    assert resp.status_code == 200
    assert resp.json()["data_reliability"] == "insufficient"
    db.add.assert_not_called()
    db.commit.assert_not_awaited()


async def test_summary_caches_successful_result():
    """Second request for the same user must not call Gemini (result is cached)."""
    # DB mock handles two sets of scalar() calls in case the cache misses.
    db = AsyncMock()
    db.commit = AsyncMock()
    db.add = MagicMock()
    # First request: session_count, message_count, today-snapshot-check; second hits cache.
    db.scalar.side_effect = [5, 42, None]
    snippets_result = MagicMock()
    snippets_result.fetchall.return_value = [("msg1",)]
    db.execute.return_value = snippets_result

    _override(db)
    try:
        with patch(
            "app.routers.analytics.generate_analytics",
            return_value=dict(_FULL_GEMINI_RESULT),
        ) as mock_gen:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                resp1 = await client.get("/api/v1/analytics/summary")
                resp2 = await client.get("/api/v1/analytics/summary")
    finally:
        _clear()

    assert resp1.status_code == 200
    assert resp2.status_code == 200
    # Gemini must only be called once despite two requests.
    mock_gen.assert_called_once()


async def test_summary_does_not_cache_insufficient_result():
    """After an insufficient result, the next request must call Gemini again (not cached)."""
    db = AsyncMock()
    db.commit = AsyncMock()
    db.add = MagicMock()
    db.scalar.side_effect = [1, 3, 1, 3]
    snippets_result = MagicMock()
    snippets_result.fetchall.return_value = [("hi",)]
    db.execute.return_value = snippets_result

    _override(db)
    try:
        with patch(
            "app.routers.analytics.generate_analytics",
            return_value=dict(_INSUFFICIENT_GEMINI_RESULT),
        ) as mock_gen:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                await client.get("/api/v1/analytics/summary")
                await client.get("/api/v1/analytics/summary")
    finally:
        _clear()

    # Gemini must be called on BOTH requests since insufficient results are not cached.
    assert mock_gen.call_count == 2


async def test_summary_returns_empty_on_schema_validation_error():
    """If Gemini returns a score outside 0–100, the router must return an empty summary
    (data_reliability="insufficient") rather than raising a 500."""
    db = _make_summary_db(session_count=5, message_count=20, snippets=["msg1"])
    _override(db)

    bad_result = {
        **_FULL_GEMINI_RESULT,
        "confidence_score": 150,  # violates Score (ge=0, le=100)
    }

    try:
        with patch("app.routers.analytics.generate_analytics", return_value=bad_result):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                resp = await client.get("/api/v1/analytics/summary")
    finally:
        _clear()

    assert resp.status_code == 200
    body = resp.json()
    assert body["data_reliability"] == "insufficient"
    # Snapshot must NOT be written for a validation-failed result.
    db.add.assert_not_called()


# ── GET /analytics/history router tests ──────────────────────────────────────

async def test_history_returns_402_for_free_user():
    """Free-tier users must receive 402 Payment Required."""
    db = AsyncMock()
    _override(db, free=True)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/api/v1/analytics/history")
    finally:
        _clear()

    assert resp.status_code == 402
    assert resp.json()["detail"]["code"] == "subscription_required"


async def test_history_returns_empty_when_no_snapshots():
    """When no ScoreSnapshot rows exist, the response must be {"points": []}."""
    db = _make_history_db([])
    _override(db)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/api/v1/analytics/history")
    finally:
        _clear()

    assert resp.status_code == 200
    assert resp.json() == {"points": []}


async def test_history_maps_column_names_to_scorepoint_fields():
    """ScoreSnapshot column names must map to the correct ScorePoint field names:
      confidence_score → confidence
      anxiety_score    → anxiety
      self_esteem_score → self_esteem
      stress_load      → stress
      social_gratitude_index → social
      ego_score        → ego
      emotion_control_score → emotion_control
    """
    now = datetime(2026, 5, 3, 10, 0, 0, tzinfo=timezone.utc)
    row = _make_snapshot(
        created_at=now,
        confidence_score=71,
        anxiety_score=45,
        self_esteem_score=60,
        stress_load=55,
        social_gratitude_index=68,
        ego_score=48,
        emotion_control_score=73,
    )
    db = _make_history_db([row])
    _override(db)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/api/v1/analytics/history")
    finally:
        _clear()

    assert resp.status_code == 200
    points = resp.json()["points"]
    assert len(points) == 1
    pt = points[0]
    assert pt["confidence"] == 71,       "confidence_score → confidence"
    assert pt["anxiety"] == 45,          "anxiety_score → anxiety"
    assert pt["self_esteem"] == 60,      "self_esteem_score → self_esteem"
    assert pt["stress"] == 55,           "stress_load → stress"
    assert pt["social"] == 68,           "social_gratitude_index → social"
    assert pt["ego"] == 48,              "ego_score → ego"
    assert pt["emotion_control"] == 73,  "emotion_control_score → emotion_control"
    assert pt["date"] == now.isoformat()


async def test_history_returns_chronological_order():
    """History points must be returned oldest-first regardless of DB query order.

    The router fetches newest-first (LIMIT keeps recent snapshots) then reverses.
    The DB mock returns rows in newest-first order to simulate what PostgreSQL
    returns after ORDER BY created_at DESC.
    """
    older = datetime(2026, 4, 1, 10, 0, 0, tzinfo=timezone.utc)
    middle = datetime(2026, 4, 15, 10, 0, 0, tzinfo=timezone.utc)
    newer = datetime(2026, 5, 3, 10, 0, 0, tzinfo=timezone.utc)

    # DB returns rows newest-first (as ORDER BY DESC would).
    rows = [
        _make_snapshot(created_at=newer, confidence_score=71),
        _make_snapshot(created_at=middle, confidence_score=60),
        _make_snapshot(created_at=older, confidence_score=50),
    ]
    db = _make_history_db(rows)
    _override(db)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/api/v1/analytics/history")
    finally:
        _clear()

    assert resp.status_code == 200
    dates = [p["date"] for p in resp.json()["points"]]
    # Must be in ascending (chronological) order.
    assert dates == sorted(dates), f"Points not in chronological order: {dates}"
    # First point is the oldest, last is the newest.
    assert resp.json()["points"][0]["confidence"] == 50
    assert resp.json()["points"][-1]["confidence"] == 71


async def test_history_appends_today_from_cache_when_no_snapshot_today():
    """If the latest DB snapshot is from a previous day but the analytics cache
    has a fresh result, the history endpoint must append today as a virtual point.
    This covers the common case where the user visits Insights and gets a cached
    summary (no Gemini call → no new DB snapshot) then opens the history chart."""
    past_date = datetime(2026, 5, 11, 10, 0, 0, tzinfo=timezone.utc)
    row = _make_snapshot(created_at=past_date, confidence_score=60)
    db = _make_history_db([row])
    _override(db)

    cached_analytics = dict(_FULL_GEMINI_RESULT)
    cached_analytics["confidence_score"] = 75
    cached_analytics["data_reliability"] = "high"

    try:
        with patch("app.routers.analytics._get_caches") as mock_get_caches:
            mock_cache = {_PRO_USER.id.__str__(): cached_analytics}
            mock_get_caches.return_value = (mock_cache, {})
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                resp = await client.get("/api/v1/analytics/history")
    finally:
        _clear()

    assert resp.status_code == 200
    points = resp.json()["points"]
    # Must have the DB point + today's cached point
    assert len(points) == 2
    assert points[0]["confidence"] == 60   # DB snapshot from yesterday
    assert points[1]["confidence"] == 75   # Today from cache
    # Today's point must have a timestamp >= past_date
    from datetime import datetime as _dt
    today_dt = _dt.fromisoformat(points[1]["date"])
    assert today_dt > past_date


# ── force=true cache-busting ──────────────────────────────────────────────────

async def test_summary_force_true_busts_cache():
    """?force=true must bypass the in-memory cache and invoke Gemini again."""
    db = AsyncMock()
    db.commit = AsyncMock()
    db.add = MagicMock()
    # Two full sets of scalar() calls — one per request (cache won't be hit on 2nd)
    db.scalar.side_effect = [5, 42, None, 5, 42, None]
    snippets_result = MagicMock()
    snippets_result.fetchall.return_value = [("msg1",)]
    db.execute.return_value = snippets_result

    _override(db)
    try:
        with patch(
            "app.routers.analytics.generate_analytics",
            return_value=dict(_FULL_GEMINI_RESULT),
        ) as mock_gen:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                # First request — result is cached
                resp1 = await client.get("/api/v1/analytics/summary")
                # Second request with force=true — must bust the cache
                resp2 = await client.get("/api/v1/analytics/summary?force=true")
    finally:
        _clear()

    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert mock_gen.call_count == 2, (
        f"Expected Gemini called twice (force=true busts cache), "
        f"got {mock_gen.call_count}"
    )


# ── Language parameter ────────────────────────────────────────────────────────

async def test_summary_passes_user_preferred_language_to_gemini():
    """generate_analytics must be called with the user's stored preferred_language."""
    user_es = make_user(subscription_tier="pro")
    user_es.preferred_language = "es"

    db = _make_summary_db(session_count=3, message_count=10, snippets=["hola"])
    settings_mock = _test_settings()

    app.dependency_overrides[get_settings] = lambda: settings_mock
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_pro] = lambda: user_es
    try:
        with patch(
            "app.routers.analytics.generate_analytics",
            return_value=dict(_FULL_GEMINI_RESULT),
        ) as mock_gen:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                resp = await client.get("/api/v1/analytics/summary")
    finally:
        _clear()

    assert resp.status_code == 200
    mock_gen.assert_called_once()
    assert mock_gen.call_args.kwargs.get("language") == "es", (
        f"Expected language='es', got {mock_gen.call_args.kwargs.get('language')!r}"
    )


async def test_summary_falls_back_to_en_for_unsupported_language():
    """When user.preferred_language is not in SUPPORTED_LANGUAGES, generate_analytics
    must be called with language='en' (safe fallback)."""
    user_xx = make_user(subscription_tier="pro")
    user_xx.preferred_language = "xx"  # not a supported code

    db = _make_summary_db(session_count=3, message_count=10, snippets=["hello"])
    settings_mock = _test_settings()

    app.dependency_overrides[get_settings] = lambda: settings_mock
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_pro] = lambda: user_xx
    try:
        with patch(
            "app.routers.analytics.generate_analytics",
            return_value=dict(_FULL_GEMINI_RESULT),
        ) as mock_gen:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                resp = await client.get("/api/v1/analytics/summary")
    finally:
        _clear()

    assert resp.status_code == 200
    mock_gen.assert_called_once()
    assert mock_gen.call_args.kwargs.get("language") == "en", (
        f"Expected fallback to 'en' for unsupported language 'xx', "
        f"got {mock_gen.call_args.kwargs.get('language')!r}"
    )


# ── ScoreSnapshot field coverage ──────────────────────────────────────────────

async def test_summary_snapshot_persists_self_awareness_and_motivation():
    """ScoreSnapshot written to DB must include self_awareness_score and motivation_score
    when Gemini returns them (these were added in migration 008)."""
    full_result = {
        **_FULL_GEMINI_RESULT,
        "self_awareness_score": 61,
        "motivation_score": 44,
    }
    db = _make_summary_db(session_count=5, message_count=42, snippets=["msg1"])
    _override(db)
    try:
        with patch("app.routers.analytics.generate_analytics", return_value=full_result):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                resp = await client.get("/api/v1/analytics/summary")
    finally:
        _clear()

    assert resp.status_code == 200
    db.add.assert_called_once()
    snapshot: ScoreSnapshot = db.add.call_args[0][0]
    assert snapshot.self_awareness_score == 61, (
        "self_awareness_score must be persisted to ScoreSnapshot"
    )
    assert snapshot.motivation_score == 44, (
        "motivation_score must be persisted to ScoreSnapshot"
    )
