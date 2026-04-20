"""Tests for app/middleware/subscription.py

Covers:
  - get_current_user: resolves clerk_user_id → User, raises 404 when not found
  - require_pro: passes pro users, raises 402 for free users
  - check_message_quota: passes pro users immediately, enforces daily limit for free users
"""

import pytest
from fastapi import HTTPException
from unittest.mock import AsyncMock, MagicMock, patch

from tests.conftest import make_user, db_returning
from app.middleware.subscription import check_message_quota, get_current_user, require_pro


# ── get_current_user ───────────────────────────────────────────────────────

async def test_get_current_user_resolves_user():
    user = make_user()
    db = db_returning(user)

    result = await get_current_user(clerk_user_id=user.clerk_user_id, db=db)

    assert result is user


async def test_get_current_user_raises_404_when_missing():
    db = db_returning(None)

    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(clerk_user_id="user_unknown", db=db)

    assert exc_info.value.status_code == 404
    assert "sync" in exc_info.value.detail.lower()


# ── require_pro ────────────────────────────────────────────────────────────

async def test_require_pro_passes_pro_user():
    user = make_user(subscription_tier="pro")

    result = await require_pro(user=user)

    assert result is user


async def test_require_pro_blocks_free_user():
    user = make_user(subscription_tier="free")

    with pytest.raises(HTTPException) as exc_info:
        await require_pro(user=user)

    assert exc_info.value.status_code == 402
    assert exc_info.value.detail["code"] == "subscription_required"
    assert "upgrade_path" in exc_info.value.detail


# ── check_message_quota ────────────────────────────────────────────────────

async def test_check_message_quota_passes_pro_user_without_db_query():
    user = make_user(subscription_tier="pro")
    db = AsyncMock()

    result = await check_message_quota(user=user, db=db)

    assert result is user
    db.scalar.assert_not_called()  # pro users skip the count query entirely


async def test_check_message_quota_passes_free_user_under_limit():
    user = make_user(subscription_tier="free")
    db = AsyncMock()
    db.scalar.return_value = 2  # 2 messages sent today, limit is 5

    mock_settings = MagicMock(free_daily_message_limit=5)
    with patch("app.middleware.subscription.get_settings", return_value=mock_settings):
        result = await check_message_quota(user=user, db=db)

    assert result is user


async def test_check_message_quota_blocks_free_user_at_limit():
    user = make_user(subscription_tier="free")
    db = AsyncMock()
    db.scalar.return_value = 5  # exactly at the limit

    mock_settings = MagicMock(free_daily_message_limit=5)
    with patch("app.middleware.subscription.get_settings", return_value=mock_settings):
        with pytest.raises(HTTPException) as exc_info:
            await check_message_quota(user=user, db=db)

    assert exc_info.value.status_code == 429
    detail = exc_info.value.detail
    assert detail["code"] == "daily_limit_reached"
    assert detail["limit"] == 5
    assert "upgrade_path" in detail


async def test_check_message_quota_blocks_free_user_over_limit():
    user = make_user(subscription_tier="free")
    db = AsyncMock()
    db.scalar.return_value = 10  # well over the limit

    mock_settings = MagicMock(free_daily_message_limit=5)
    with patch("app.middleware.subscription.get_settings", return_value=mock_settings):
        with pytest.raises(HTTPException) as exc_info:
            await check_message_quota(user=user, db=db)

    assert exc_info.value.status_code == 429


async def test_check_message_quota_treats_null_count_as_zero():
    """db.scalar() can return None if no rows match; should be treated as 0."""
    user = make_user(subscription_tier="free")
    db = AsyncMock()
    db.scalar.return_value = None

    mock_settings = MagicMock(free_daily_message_limit=5)
    with patch("app.middleware.subscription.get_settings", return_value=mock_settings):
        result = await check_message_quota(user=user, db=db)

    assert result is user
