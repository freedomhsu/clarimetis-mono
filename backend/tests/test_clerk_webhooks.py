"""Tests for app/routers/clerk_webhooks.py

Unit tests:
  _verify_svix_signature:
    - Valid signature passes
    - Wrong signature raises 400
    - Missing svix headers raises 400
    - Stale timestamp raises 400
    - Future timestamp raises 400 (outside tolerance)

  delete_user_data:
    - Deletes user row + calls GCS purge when user exists
    - Returns not_found status when user does not exist (idempotent)
    - Commits even when GCS purge raises (partial failure resilience)

E2E tests (HTTP):
  POST /api/v1/webhooks/clerk:
    - user.deleted with valid signature → 200 {"received": True}
    - user.deleted with invalid signature → 400
    - user.deleted with no secret configured → skips verification, returns 200
    - user.deleted for unknown user → 200 (idempotent)
    - Unknown event type → 200 (ignored, no error)
    - Malformed JSON → 400
    - Missing svix headers when secret is set → 400
"""

import base64
import hashlib
import hmac
import json
import time
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.database import get_db
from app.main import app
from app.middleware.auth import get_current_user_id
from app.routers.clerk_webhooks import _verify_svix_signature, delete_user_data
from tests.conftest import make_user

# ── Helpers ────────────────────────────────────────────────────────────────

_TEST_SECRET = "whsec_" + base64.b64encode(b"test-secret-32-bytes-exactly!!!").decode()


def _sign(payload: bytes, msg_id: str = "msg_test", msg_timestamp: str | None = None) -> str:
    """Return a valid svix-signature header value for the given payload."""
    ts = msg_timestamp or str(int(time.time()))
    key = base64.b64decode(_TEST_SECRET.removeprefix("whsec_"))
    signed = f"{msg_id}.{ts}.".encode() + payload
    digest = hmac.new(key, signed, hashlib.sha256).digest()
    return "v1," + base64.b64encode(digest).decode()


def _event(event_type: str = "user.deleted", clerk_user_id: str = "user_clerk_123") -> bytes:
    return json.dumps({"type": event_type, "data": {"id": clerk_user_id}}).encode()


def _make_settings_override(clerk_webhook_secret: str = ""):
    """Return a lambda that provides a settings mock with the given webhook secret."""
    mock = MagicMock()
    mock.clerk_webhook_secret = clerk_webhook_secret
    return lambda: mock


def _db_returning(user):
    """Return an AsyncMock DB session that returns *user* (or None) from execute."""
    result = MagicMock()
    result.scalar_one_or_none.return_value = user
    db = AsyncMock()
    db.execute.return_value = result
    db.delete = AsyncMock()
    db.commit = AsyncMock()
    return db


def _override(db: AsyncMock, settings_override=None) -> None:
    app.dependency_overrides[get_current_user_id] = lambda: "user_test"
    app.dependency_overrides[get_db] = lambda: db
    if settings_override is not None:
        app.dependency_overrides[get_settings] = settings_override


def _clear() -> None:
    app.dependency_overrides.clear()


# ── Unit: _verify_svix_signature ──────────────────────────────────────────

def test_verify_svix_signature_valid():
    """A correctly signed payload passes without raising."""
    payload = b'{"type":"user.deleted"}'
    msg_id = "msg_123"
    ts = str(int(time.time()))
    sig = _sign(payload, msg_id, ts)
    # Should not raise
    _verify_svix_signature(payload, msg_id, ts, sig, _TEST_SECRET)


def test_verify_svix_signature_wrong_signature():
    payload = b'{"type":"user.deleted"}'
    ts = str(int(time.time()))
    with pytest.raises(HTTPException) as exc_info:
        _verify_svix_signature(payload, "msg_1", ts, "v1,invalidsig==", _TEST_SECRET)
    assert exc_info.value.status_code == 400
    assert "signature" in exc_info.value.detail.lower()


def test_verify_svix_signature_stale_timestamp():
    payload = b'{"type":"user.deleted"}'
    old_ts = str(int(time.time()) - 400)  # 400s ago — outside 300s tolerance
    sig = _sign(payload, "msg_1", old_ts)
    with pytest.raises(HTTPException) as exc_info:
        _verify_svix_signature(payload, "msg_1", old_ts, sig, _TEST_SECRET)
    assert exc_info.value.status_code == 400
    assert "timestamp" in exc_info.value.detail.lower()


def test_verify_svix_signature_future_timestamp():
    payload = b'{"type":"user.deleted"}'
    future_ts = str(int(time.time()) + 400)  # 400s in the future
    sig = _sign(payload, "msg_1", future_ts)
    with pytest.raises(HTTPException) as exc_info:
        _verify_svix_signature(payload, "msg_1", future_ts, sig, _TEST_SECRET)
    assert exc_info.value.status_code == 400


def test_verify_svix_signature_non_integer_timestamp():
    with pytest.raises(HTTPException) as exc_info:
        _verify_svix_signature(b"body", "msg_1", "not-a-number", "v1,sig", _TEST_SECRET)
    assert exc_info.value.status_code == 400


def test_verify_svix_signature_accepts_multiple_signatures():
    """Svix may include multiple v1 signatures during key rotation; any valid one is sufficient."""
    payload = b'{"type":"user.deleted"}'
    ts = str(int(time.time()))
    good_sig = _sign(payload, "msg_1", ts)
    multi_sig = f"v1,oldinvalid== {good_sig}"
    _verify_svix_signature(payload, "msg_1", ts, multi_sig, _TEST_SECRET)  # must not raise


# ── Unit: delete_user_data ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_user_data_deletes_user_and_purges_gcs():
    user = make_user(clerk_user_id="user_clerk_123")
    db = _db_returning(user)

    with patch(
        "app.routers.clerk_webhooks.delete_all_user_media",
        new_callable=AsyncMock,
        return_value=1024,
    ) as mock_purge:
        summary = await delete_user_data("user_clerk_123", db)

    mock_purge.assert_awaited_once_with("user_clerk_123")
    db.delete.assert_awaited_once_with(user)
    db.commit.assert_awaited_once()
    assert summary["status"] == "deleted"
    assert summary["gcs_bytes_freed"] == 1024


@pytest.mark.asyncio
async def test_delete_user_data_idempotent_when_user_not_found():
    db = _db_returning(None)

    with patch(
        "app.routers.clerk_webhooks.delete_all_user_media",
        new_callable=AsyncMock,
    ) as mock_purge:
        summary = await delete_user_data("user_gone", db)

    mock_purge.assert_not_awaited()
    db.delete.assert_not_awaited()
    assert summary["status"] == "not_found"


@pytest.mark.asyncio
async def test_delete_user_data_commits_even_when_gcs_purge_fails():
    """GCS errors are logged but the DB row is still deleted."""
    user = make_user(clerk_user_id="user_clerk_fail")
    db = _db_returning(user)

    with patch(
        "app.routers.clerk_webhooks.delete_all_user_media",
        side_effect=Exception("GCS unavailable"),
    ):
        summary = await delete_user_data("user_clerk_fail", db)

    db.delete.assert_awaited_once_with(user)
    db.commit.assert_awaited_once()
    assert summary["status"] == "deleted"
    assert summary["gcs_bytes_freed"] == 0


# ── E2E: POST /api/v1/webhooks/clerk ──────────────────────────────────────

@pytest.mark.asyncio
async def test_clerk_webhook_user_deleted_valid_signature():
    user = make_user(clerk_user_id="user_clerk_123")
    db = _db_returning(user)
    payload = _event("user.deleted", "user_clerk_123")
    msg_id = "msg_e2e_1"
    ts = str(int(time.time()))
    sig = _sign(payload, msg_id, ts)

    _override(db, _make_settings_override(clerk_webhook_secret=_TEST_SECRET))
    try:
        with patch(
            "app.routers.clerk_webhooks.delete_all_user_media",
            new_callable=AsyncMock,
            return_value=0,
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.post(
                    "/api/v1/webhooks/clerk",
                    content=payload,
                    headers={
                        "svix-id": msg_id,
                        "svix-timestamp": ts,
                        "svix-signature": sig,
                        "content-type": "application/json",
                    },
                )
        assert resp.status_code == 200
        assert resp.json() == {"received": True}
    finally:
        _clear()


@pytest.mark.asyncio
async def test_clerk_webhook_invalid_signature_returns_400():
    db = _db_returning(None)
    _override(db, _make_settings_override(clerk_webhook_secret=_TEST_SECRET))
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                "/api/v1/webhooks/clerk",
                content=_event(),
                headers={
                    "svix-id": "msg_bad",
                    "svix-timestamp": str(int(time.time())),
                    "svix-signature": "v1,badsignature==",
                    "content-type": "application/json",
                },
            )
        assert resp.status_code == 400
    finally:
        _clear()


@pytest.mark.asyncio
async def test_clerk_webhook_no_secret_skips_verification():
    """When clerk_webhook_secret is empty, signature verification is bypassed."""
    user = make_user(clerk_user_id="user_clerk_nocheck")
    db = _db_returning(user)
    payload = _event("user.deleted", "user_clerk_nocheck")

    # No secret = skip verification — no svix headers needed
    _override(db, _make_settings_override(clerk_webhook_secret=""))
    try:
        with patch(
            "app.routers.clerk_webhooks.delete_all_user_media",
            new_callable=AsyncMock,
            return_value=0,
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.post(
                    "/api/v1/webhooks/clerk",
                    content=payload,
                    headers={"content-type": "application/json"},
                )
        assert resp.status_code == 200
        assert resp.json() == {"received": True}
    finally:
        _clear()


@pytest.mark.asyncio
async def test_clerk_webhook_unknown_user_is_idempotent():
    """user.deleted for an unknown clerk_user_id returns 200 without error."""
    db = _db_returning(None)
    _override(db, _make_settings_override())
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                "/api/v1/webhooks/clerk",
                content=_event("user.deleted", "user_never_synced"),
                headers={"content-type": "application/json"},
            )
        assert resp.status_code == 200
    finally:
        _clear()


@pytest.mark.asyncio
async def test_clerk_webhook_unknown_event_type_ignored():
    """Unrecognised event types return 200 without mutating any data."""
    db = _db_returning(None)
    _override(db, _make_settings_override())
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                "/api/v1/webhooks/clerk",
                content=json.dumps({"type": "user.created", "data": {"id": "user_1"}}).encode(),
                headers={"content-type": "application/json"},
            )
        assert resp.status_code == 200
        assert resp.json() == {"received": True}
    finally:
        _clear()


@pytest.mark.asyncio
async def test_clerk_webhook_malformed_json_returns_400():
    db = _db_returning(None)
    _override(db, _make_settings_override())
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                "/api/v1/webhooks/clerk",
                content=b"not json {{",
                headers={"content-type": "application/json"},
            )
        assert resp.status_code == 400
    finally:
        _clear()


@pytest.mark.asyncio
async def test_clerk_webhook_missing_svix_headers_returns_400():
    """When a secret is configured, omitting svix headers must return 400."""
    db = _db_returning(None)
    _override(db, _make_settings_override(clerk_webhook_secret=_TEST_SECRET))
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                "/api/v1/webhooks/clerk",
                content=_event(),
                headers={"content-type": "application/json"},
                # No svix-id / svix-timestamp / svix-signature
            )
        assert resp.status_code == 400
    finally:
        _clear()

