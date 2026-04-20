"""Tests for app/routers/sessions.py

Covers:
  - list_sessions: returns only the authenticated user's sessions
  - create_session: creates a session owned by the authenticated user
  - delete_session: deletes own session (204)
  - delete_session: cannot delete another user's session (404)
  - list/delete when user is not synced returns 404
"""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from app.database import get_db
from app.main import app
from app.middleware.auth import get_current_user_id
from app.middleware.subscription import get_current_user
from tests.conftest import make_session, make_user


def _override(db, clerk_user_id: str = "user_test"):
    app.dependency_overrides[get_current_user_id] = lambda: clerk_user_id
    app.dependency_overrides[get_db] = lambda: db


def _clear():
    app.dependency_overrides.clear()


# ── list_sessions ──────────────────────────────────────────────────────────

async def test_list_sessions_returns_users_sessions():
    user = make_user()
    session = make_session(user)

    # First execute() call resolves the user; second returns their sessions.
    user_result = MagicMock()
    user_result.scalar_one_or_none.return_value = user

    sessions_result = MagicMock()
    sessions_result.scalars.return_value.all.return_value = [session]

    db = AsyncMock()
    db.execute.side_effect = [user_result, sessions_result]

    _override(db)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/api/v1/sessions")
    finally:
        _clear()

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["id"] == str(session.id)
    assert data[0]["title"] == session.title


async def test_list_sessions_returns_empty_when_no_sessions():
    user = make_user()

    user_result = MagicMock()
    user_result.scalar_one_or_none.return_value = user

    sessions_result = MagicMock()
    sessions_result.scalars.return_value.all.return_value = []

    db = AsyncMock()
    db.execute.side_effect = [user_result, sessions_result]

    _override(db)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/api/v1/sessions")
    finally:
        _clear()

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_sessions_returns_404_when_user_not_synced():
    user_result = MagicMock()
    user_result.scalar_one_or_none.return_value = None

    db = AsyncMock()
    db.execute.return_value = user_result

    _override(db)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/api/v1/sessions")
    finally:
        _clear()

    assert resp.status_code == 404
    assert "sync" in resp.json()["detail"].lower()


# ── create_session ─────────────────────────────────────────────────────────

async def test_create_session_returns_201_with_session():
    user = make_user()
    created_session = make_session(user, title="My New Session")

    user_result = MagicMock()
    user_result.scalar_one_or_none.return_value = user

    db = AsyncMock()
    db.execute.return_value = user_result
    db.commit = AsyncMock()

    # Simulate db.refresh populating the new session object
    async def fake_refresh(obj):
        obj.id = created_session.id
        obj.user_id = user.id
        obj.created_at = created_session.created_at
        obj.updated_at = created_session.updated_at

    db.refresh.side_effect = fake_refresh

    _override(db)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/api/v1/sessions", json={"title": "My New Session"})
    finally:
        _clear()

    assert resp.status_code == 201
    assert resp.json()["title"] == "My New Session"
    db.commit.assert_awaited_once()


# ── delete_session ─────────────────────────────────────────────────────────

async def test_delete_session_returns_204_for_own_session():
    user = make_user()
    session = make_session(user)

    user_result = MagicMock()
    user_result.scalar_one_or_none.return_value = user

    session_result = MagicMock()
    session_result.scalar_one_or_none.return_value = session

    db = AsyncMock()
    db.execute.side_effect = [user_result, session_result]
    db.commit = AsyncMock()
    db.delete = AsyncMock()

    _override(db)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.delete(f"/api/v1/sessions/{session.id}")
    finally:
        _clear()

    assert resp.status_code == 204
    db.delete.assert_awaited_once_with(session)
    db.commit.assert_awaited_once()


async def test_delete_session_returns_404_for_another_users_session():
    """A user cannot delete a session they don't own — ownership check returns None."""
    user = make_user()
    other_session_id = uuid.uuid4()

    user_result = MagicMock()
    user_result.scalar_one_or_none.return_value = user

    # The WHERE user_id = user.id AND id = other_session_id query finds nothing
    session_result = MagicMock()
    session_result.scalar_one_or_none.return_value = None

    db = AsyncMock()
    db.execute.side_effect = [user_result, session_result]

    _override(db)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.delete(f"/api/v1/sessions/{other_session_id}")
    finally:
        _clear()

    assert resp.status_code == 404
    db.delete.assert_not_awaited()


async def test_delete_session_returns_404_when_user_not_synced():
    user_result = MagicMock()
    user_result.scalar_one_or_none.return_value = None

    db = AsyncMock()
    db.execute.return_value = user_result

    _override(db)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.delete(f"/api/v1/sessions/{uuid.uuid4()}")
    finally:
        _clear()

    assert resp.status_code == 404
