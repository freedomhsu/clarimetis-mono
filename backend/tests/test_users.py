"""Tests for app/routers/users.py

Covers:
  POST /users/sync:
    - Creates a new user with Stripe customer when user doesn't exist
    - Updates email/full_name for an existing user (upsert)
    - Creates user without Stripe customer when Stripe creation fails (non-fatal)

  GET /users/language:
    - Returns preferred_language for authenticated user
    - Returns 404 when user is not synced

  PATCH /users/language:
    - Updates preferred_language to a valid language code and commits
    - Returns 422 for unsupported language code
    - Returns 404 when user is not synced
    - Accepts all 8 supported language codes
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.database import get_db
from app.main import app
from app.middleware.auth import get_current_user_id
from tests.conftest import make_user


def _override(db: AsyncMock, clerk_user_id: str = "user_test") -> None:
    app.dependency_overrides[get_current_user_id] = lambda: clerk_user_id
    app.dependency_overrides[get_db] = lambda: db


def _clear() -> None:
    app.dependency_overrides.clear()


# ── POST /users/sync ───────────────────────────────────────────────────────

async def test_sync_creates_new_user_with_stripe_customer():
    """When the user doesn't exist yet, a User is created and a Stripe customer is provisioned."""
    no_user_result = MagicMock()
    no_user_result.scalar_one_or_none.return_value = None

    db = AsyncMock()
    db.execute.return_value = no_user_result
    db.add = MagicMock()
    db.commit = AsyncMock()

    # Simulate db.refresh populating the newly created User object
    new_user = make_user(clerk_user_id="user_test", email="new@example.com")
    new_user.preferred_language = "en"
    new_user.stripe_customer_id = "cus_new"

    async def _fake_refresh(obj):
        obj.id = new_user.id
        obj.clerk_user_id = "user_test"
        obj.email = "new@example.com"
        obj.full_name = "New User"
        obj.subscription_tier = "free"
        obj.storage_used_bytes = 0
        obj.preferred_language = "en"
        obj.stripe_customer_id = "cus_new"

    db.refresh.side_effect = _fake_refresh

    _override(db)
    try:
        with patch(
            "app.routers.users.stripe_service.create_customer",
            new=AsyncMock(return_value="cus_new"),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.post(
                    "/api/v1/users/sync",
                    json={"email": "new@example.com", "full_name": "New User"},
                )
    finally:
        _clear()

    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == "new@example.com"
    assert data["subscription_tier"] == "free"
    db.add.assert_called_once()
    db.commit.assert_awaited_once()


async def test_sync_updates_existing_user_fields():
    """When the user already exists, email and full_name are updated in-place (upsert)."""
    existing_user = make_user(clerk_user_id="user_test", email="old@example.com")
    existing_user.preferred_language = "en"
    existing_user.storage_used_bytes = 0

    user_result = MagicMock()
    user_result.scalar_one_or_none.return_value = existing_user

    db = AsyncMock()
    db.execute.return_value = user_result
    db.commit = AsyncMock()
    db.add = MagicMock()
    db.refresh = AsyncMock()

    _override(db)
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                "/api/v1/users/sync",
                json={"email": "updated@example.com", "full_name": "Updated Name"},
            )
    finally:
        _clear()

    assert resp.status_code == 200
    # Verify the in-place mutation happened before the response was serialised
    assert existing_user.email == "updated@example.com"
    assert existing_user.full_name == "Updated Name"
    db.commit.assert_awaited_once()
    # db.add must NOT be called for an existing user
    db.add.assert_not_called()


async def test_sync_creates_user_when_stripe_creation_fails():
    """Stripe customer creation failure must be non-fatal: user is still created with
    stripe_customer_id=None and the endpoint returns 200."""
    no_user_result = MagicMock()
    no_user_result.scalar_one_or_none.return_value = None

    db = AsyncMock()
    db.execute.return_value = no_user_result
    db.add = MagicMock()
    db.commit = AsyncMock()

    fallback_user = make_user(
        clerk_user_id="user_test",
        email="fallback@example.com",
        stripe_customer_id=None,
    )
    fallback_user.preferred_language = "en"
    fallback_user.storage_used_bytes = 0
    fallback_user.stripe_customer_id = None

    async def _fake_refresh(obj):
        obj.id = fallback_user.id
        obj.clerk_user_id = "user_test"
        obj.email = "fallback@example.com"
        obj.full_name = None
        obj.subscription_tier = "free"
        obj.storage_used_bytes = 0
        obj.preferred_language = "en"
        obj.stripe_customer_id = None

    db.refresh.side_effect = _fake_refresh

    _override(db)
    try:
        with patch(
            "app.routers.users.stripe_service.create_customer",
            new=AsyncMock(side_effect=Exception("Stripe unavailable")),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.post(
                    "/api/v1/users/sync",
                    json={"email": "fallback@example.com"},
                )
    finally:
        _clear()

    # Stripe failure must NOT block user creation
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == "fallback@example.com"
    db.add.assert_called_once()


# ── GET /users/language ────────────────────────────────────────────────────

async def test_get_language_returns_current_preference():
    """GET /users/language must return the user's stored preferred_language."""
    user = make_user()
    user.preferred_language = "ja"

    user_result = MagicMock()
    user_result.scalar_one_or_none.return_value = user

    db = AsyncMock()
    db.execute.return_value = user_result

    _override(db)
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get("/api/v1/users/language")
    finally:
        _clear()

    assert resp.status_code == 200
    assert resp.json() == {"preferred_language": "ja"}


async def test_get_language_returns_404_when_user_not_synced():
    """GET /users/language must return 404 when the clerk_user_id is not in the DB."""
    no_user_result = MagicMock()
    no_user_result.scalar_one_or_none.return_value = None

    db = AsyncMock()
    db.execute.return_value = no_user_result

    _override(db)
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get("/api/v1/users/language")
    finally:
        _clear()

    assert resp.status_code == 404


# ── PATCH /users/language ──────────────────────────────────────────────────

async def test_set_language_updates_preference():
    """PATCH /users/language must persist the new language and return it."""
    user = make_user()
    user.preferred_language = "en"

    user_result = MagicMock()
    user_result.scalar_one_or_none.return_value = user

    db = AsyncMock()
    db.execute.return_value = user_result
    db.commit = AsyncMock()

    _override(db)
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.patch("/api/v1/users/language", json={"language": "es"})
    finally:
        _clear()

    assert resp.status_code == 200
    assert resp.json() == {"preferred_language": "es"}
    assert user.preferred_language == "es"
    db.commit.assert_awaited_once()


async def test_set_language_returns_422_for_unsupported_language():
    """PATCH /users/language must return 422 for a language code not in SUPPORTED_LANGUAGES."""
    db = AsyncMock()
    _override(db)
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.patch("/api/v1/users/language", json={"language": "klingon"})
    finally:
        _clear()

    assert resp.status_code == 422


async def test_set_language_returns_404_when_user_not_synced():
    """PATCH /users/language must return 404 when the user is not in the DB."""
    no_user_result = MagicMock()
    no_user_result.scalar_one_or_none.return_value = None

    db = AsyncMock()
    db.execute.return_value = no_user_result

    _override(db)
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.patch("/api/v1/users/language", json={"language": "fr"})
    finally:
        _clear()

    assert resp.status_code == 404


@pytest.mark.parametrize("lang", ["en", "es", "pt", "fr", "zh-TW", "ja", "ko", "it"])
async def test_set_language_accepts_all_supported_languages(lang: str):
    """All 8 supported language codes must be accepted by PATCH /users/language."""
    user = make_user()
    user.preferred_language = "en"

    user_result = MagicMock()
    user_result.scalar_one_or_none.return_value = user

    db = AsyncMock()
    db.execute.return_value = user_result
    db.commit = AsyncMock()

    _override(db)
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.patch("/api/v1/users/language", json={"language": lang})
    finally:
        _clear()

    assert resp.status_code == 200, f"Language {lang!r} was unexpectedly rejected"
    assert resp.json()["preferred_language"] == lang
