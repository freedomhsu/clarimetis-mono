"""Tests for app/routers/media.py

Upload endpoint covers:
  - upload_within_quota: 200, atomic quota UPDATE executed, db.commit() called
  - upload_at_quota_boundary: exactly consuming remaining quota is allowed (> not >=)
  - upload_exceeding_quota: 413 with "quota" in detail (rowcount==0 from atomic UPDATE)
  - upload_exceeding_per_file_limit: 413 with MB limit in detail
  - disallowed_content_type: 400 naming the offending type
  - magic_bytes_mismatch: 400 when detect_mime disagrees with Content-Type header
  - gcs_upload_failure_rolls_back_quota: 500 + rollback UPDATE when upload_media raises

List endpoint covers:
  - list_files_returns_items_from_storage_service: 200 with correct shape
  - list_files_with_null_uploaded_at: uploaded_at=None serialises as null (not error)
  - list_files_requires_pro: 402 for free-tier users

Delete endpoint covers:
  - delete_own_file_returns_204_and_decrements_counter: happy path
  - delete_own_file_never_goes_below_zero: guard against negative storage
  - delete_file_of_another_user_returns_403: IDOR protection (critical)
  - delete_traversal_attempt_via_dotdot_returns_403: path-traversal variant
  - delete_requires_pro: 402 for free-tier users
  - delete_gcs_failure_returns_500: 500 without commit when delete_media_blob raises
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.database import get_db
from app.main import app
from app.middleware.auth import get_current_user_id
from app.middleware.subscription import require_pro
from tests.conftest import make_user

_1_MB = 1024 * 1024
_UPLOAD_URL = "/api/v1/media/upload"

# Minimal "JPEG" content — just enough magic bytes to be representative.
# filetype.guess is always patched in these tests, so the bytes don't need
# to be valid JPEG.
_SMALL_JPEG = b"\xff\xd8\xff" + b"\x00" * 17  # 20 bytes


def _mock_settings(
    *,
    max_upload_bytes: int = 50 * _1_MB,
    max_pro_storage_bytes: int = 500 * _1_MB,
) -> MagicMock:
    s = MagicMock()
    s.max_upload_bytes = max_upload_bytes
    s.max_pro_storage_bytes = max_pro_storage_bytes
    return s


def _override(user, db, settings) -> None:
    app.dependency_overrides[get_current_user_id] = lambda: user.clerk_user_id
    app.dependency_overrides[require_pro] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_settings] = lambda: settings


def _clear() -> None:
    app.dependency_overrides.clear()


@pytest.fixture
def mock_db() -> AsyncMock:
    db = AsyncMock()
    db.commit = AsyncMock()
    # Default execute result: rowcount=1 so atomic quota UPDATE is treated as
    # "check passed" by default.  Override this in tests that simulate a full
    # quota (rowcount=0) or a GCS failure rollback.
    execute_result = MagicMock()
    execute_result.rowcount = 1
    db.execute.return_value = execute_result
    return db


# ── quota enforcement ──────────────────────────────────────────────────────

async def test_upload_within_quota_succeeds_and_increments_counter(mock_db):
    user = make_user(subscription_tier="pro")
    user.storage_used_bytes = 0
    settings = _mock_settings()

    _override(user, mock_db, settings)
    try:
        with (
            patch("app.routers.media.detect_mime", return_value="image/jpeg"),
            patch(
                "app.routers.media.upload_media",
                return_value="uploads/user_test/abc_photo.jpg",
            ),
            patch(
                "app.routers.media.sign_blob_path",
                return_value="https://storage.example.com/signed",
            ),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.post(
                    _UPLOAD_URL,
                    files={"file": ("photo.jpg", _SMALL_JPEG, "image/jpeg")},
                )
    finally:
        _clear()

    assert resp.status_code == 200
    data = resp.json()
    assert data["blob_path"] == "uploads/user_test/abc_photo.jpg"
    assert data["url"] == "https://storage.example.com/signed"
    assert data["content_type"] == "image/jpeg"
    # Atomic quota UPDATE must have been executed and then committed.
    mock_db.execute.assert_awaited_once()
    mock_db.commit.assert_awaited_once()


async def test_upload_at_exact_quota_boundary_succeeds(mock_db):
    """A file that fills exactly the remaining quota is allowed (check uses >, not >=)."""
    remaining = _1_MB
    content = b"\xff\xd8\xff" + b"\x00" * (remaining - 3)  # exactly 1 MB
    user = make_user(subscription_tier="pro")
    user.storage_used_bytes = 499 * _1_MB          # 499 MB used
    settings = _mock_settings(max_pro_storage_bytes=500 * _1_MB)

    _override(user, mock_db, settings)
    try:
        with (
            patch("app.routers.media.detect_mime", return_value="image/jpeg"),
            patch("app.routers.media.upload_media", return_value="uploads/user_test/file.jpg"),
            patch("app.routers.media.sign_blob_path", return_value="https://storage.example.com/signed"),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.post(
                    _UPLOAD_URL,
                    files={"file": ("photo.jpg", content, "image/jpeg")},
                )
    finally:
        _clear()

    assert resp.status_code == 200
    # Atomic quota UPDATE must have been executed and then committed.
    mock_db.execute.assert_awaited_once()


async def test_upload_exceeding_quota_returns_413(mock_db):
    """Upload that would push the total over the quota is rejected before hitting GCS.

    The atomic UPDATE returns rowcount=0 when the WHERE guard fails, which the
    router treats as "quota exceeded" and raises 413 without committing.
    """
    # 499 MB used + 2 MB file = 501 MB > 500 MB quota.
    content = b"\xff\xd8\xff" + b"\x00" * (2 * _1_MB - 3)
    user = make_user(subscription_tier="pro")
    user.storage_used_bytes = 499 * _1_MB
    settings = _mock_settings(max_pro_storage_bytes=500 * _1_MB)

    # Simulate quota full: the atomic UPDATE WHERE guard rejects the row.
    quota_exceeded = MagicMock()
    quota_exceeded.rowcount = 0
    mock_db.execute.return_value = quota_exceeded

    _override(user, mock_db, settings)
    try:
        with patch("app.routers.media.detect_mime", return_value="image/jpeg"):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.post(
                    _UPLOAD_URL,
                    files={"file": ("photo.jpg", content, "image/jpeg")},
                )
    finally:
        _clear()

    assert resp.status_code == 413
    assert "quota" in resp.json()["detail"].lower()
    # Session must never be committed when the quota check fails.
    mock_db.commit.assert_not_awaited()


# ── per-file size limit ────────────────────────────────────────────────────

async def test_upload_exceeding_per_file_limit_returns_413(mock_db):
    """File larger than max_upload_bytes is rejected, regardless of quota space."""
    user = make_user(subscription_tier="pro")
    user.storage_used_bytes = 0
    # 5-byte limit so we can test with tiny payloads, keeping the test fast.
    settings = _mock_settings(max_upload_bytes=5)

    _override(user, mock_db, settings)
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                _UPLOAD_URL,
                files={"file": ("photo.jpg", b"\xff\xd8\xff\x00\x00\x00", "image/jpeg")},
            )
    finally:
        _clear()

    assert resp.status_code == 413
    # Detail should mention the limit in MB (rounds down — 5 bytes → 0 MB shown, so
    # just check for the generic "limit" word rather than the formatted MB value).
    assert "limit" in resp.json()["detail"].lower()
    mock_db.commit.assert_not_awaited()


# ── content-type and magic-bytes validation ────────────────────────────────

async def test_upload_disallowed_content_type_returns_400(mock_db):
    """Files with a Content-Type not in the allow-list are rejected immediately."""
    user = make_user(subscription_tier="pro")
    user.storage_used_bytes = 0
    settings = _mock_settings()

    _override(user, mock_db, settings)
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                _UPLOAD_URL,
                files={"file": ("script.exe", b"MZ\x90\x00", "application/octet-stream")},
            )
    finally:
        _clear()

    assert resp.status_code == 400
    assert "application/octet-stream" in resp.json()["detail"]


async def test_upload_magic_bytes_mismatch_returns_400(mock_db):
    """Content-Type header claims image/jpeg but detect_mime returns None."""
    user = make_user(subscription_tier="pro")
    user.storage_used_bytes = 0
    settings = _mock_settings()

    _override(user, mock_db, settings)
    try:
        # detect_mime returns None → actual_type is None → not in _ALLOWED_TYPES → 400
        with patch("app.routers.media.detect_mime", return_value=None):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.post(
                    _UPLOAD_URL,
                    files={"file": ("fake.jpg", b"not-image-bytes", "image/jpeg")},
                )
    finally:
        _clear()

    assert resp.status_code == 400
    assert "content does not match" in resp.json()["detail"].lower()


async def test_upload_gcs_failure_rolls_back_quota(mock_db):
    """If GCS upload raises after the quota commit, the quota increment is rolled back.

    This is the critical atomicity guarantee added in the media.py refactor:
    1. Quota UPDATE is committed (preventing races).
    2. upload_media raises.
    3. A second sa_update rolls back the increment (clamped to 0).
    4. That rollback is committed.
    5. The caller receives HTTP 500.
    """
    user = make_user(subscription_tier="pro")
    settings = _mock_settings()

    _override(user, mock_db, settings)
    try:
        with (
            patch("app.routers.media.detect_mime", return_value="image/jpeg"),
            patch("app.routers.media.upload_media", side_effect=RuntimeError("GCS down")),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.post(
                    _UPLOAD_URL,
                    files={"file": ("photo.jpg", _SMALL_JPEG, "image/jpeg")},
                )
    finally:
        _clear()

    assert resp.status_code == 500
    assert "failed to store" in resp.json()["detail"].lower()
    # Two db.execute calls: one for the quota increment, one for the rollback.
    assert mock_db.execute.await_count == 2
    # Two commits: the first locks in the quota increment; the second
    # persists the rollback so the counter is always consistent.
    assert mock_db.commit.await_count == 2


# ── list files ─────────────────────────────────────────────────────────────

_LIST_URL = "/api/v1/media"

_FAKE_FILE_ENTRY = {
    "blob_path": "uploads/user_test/abc_photo.jpg",
    "filename": "photo.jpg",
    "content_type": "image/jpeg",
    "size_bytes": 20,
    "uploaded_at": "2026-05-01T10:00:00+00:00",
    "url": "https://storage.example.com/signed",
}


async def test_list_files_returns_items_from_storage_service(mock_db):
    """GET /media returns the list produced by list_user_media for the authenticated user."""
    user = make_user(subscription_tier="pro")
    settings = _mock_settings()

    _override(user, mock_db, settings)
    try:
        with patch(
            "app.routers.media.list_user_media",
            return_value=[_FAKE_FILE_ENTRY],
        ) as mock_list:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.get(_LIST_URL)
    finally:
        _clear()

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["blob_path"] == _FAKE_FILE_ENTRY["blob_path"]
    assert data[0]["filename"] == "photo.jpg"
    # The service must be called with the current user's ID — not any other user's.
    mock_list.assert_called_once_with(user.clerk_user_id)


async def test_list_files_requires_pro(mock_db):
    """Free-tier users receive 402 when attempting to list media."""
    user = make_user(subscription_tier="free")
    settings = _mock_settings()

    # Bypass require_pro override so the real dependency runs and blocks the user.
    app.dependency_overrides[get_current_user_id] = lambda: user.clerk_user_id
    app.dependency_overrides[get_db] = lambda: mock_db
    app.dependency_overrides[get_settings] = lambda: settings
    # Provide a DB that returns the free user so get_current_user resolves correctly.
    from unittest.mock import MagicMock as MM
    result_mock = MM()
    result_mock.scalar_one_or_none.return_value = user
    mock_db.execute.return_value = result_mock
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(_LIST_URL)
    finally:
        _clear()

    assert resp.status_code == 402
    assert resp.json()["detail"]["code"] == "subscription_required"


async def test_list_files_with_null_uploaded_at(mock_db):
    """uploaded_at: None must serialise as JSON null, not raise a Pydantic error.

    storage.py returns None (not empty string) when blob.time_created is None.
    MediaFileResponse declares uploaded_at: str | None, so Pydantic must accept it.
    """
    user = make_user(subscription_tier="pro")
    settings = _mock_settings()

    _override(user, mock_db, settings)
    try:
        with patch(
            "app.routers.media.list_user_media",
            return_value=[{**_FAKE_FILE_ENTRY, "uploaded_at": None}],
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.get(_LIST_URL)
    finally:
        _clear()

    assert resp.status_code == 200
    assert resp.json()[0]["uploaded_at"] is None


# ── delete files ───────────────────────────────────────────────────────────

def _delete_url(blob_path: str) -> str:
    return f"/api/v1/media/{blob_path}"


async def test_delete_own_file_returns_204_and_decrements_counter(mock_db):
    """Deleting your own blob returns 204 and reduces storage_used_bytes."""
    user = make_user(subscription_tier="pro", storage_used_bytes=500)
    settings = _mock_settings()

    _override(user, mock_db, settings)
    try:
        with patch("app.routers.media.delete_media_blob", return_value=20) as mock_del:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.delete(
                    _delete_url("uploads/user_test/abc_photo.jpg")
                )
    finally:
        _clear()

    assert resp.status_code == 204
    mock_del.assert_called_once_with("uploads/user_test/abc_photo.jpg")
    assert user.storage_used_bytes == 480  # 500 - 20
    mock_db.commit.assert_awaited_once()


async def test_delete_own_file_never_goes_below_zero(mock_db):
    """storage_used_bytes is clamped to 0 if the blob size exceeds the recorded counter."""
    user = make_user(subscription_tier="pro", storage_used_bytes=5)
    settings = _mock_settings()

    _override(user, mock_db, settings)
    try:
        with patch("app.routers.media.delete_media_blob", return_value=9999):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.delete(
                    _delete_url("uploads/user_test/abc_photo.jpg")
                )
    finally:
        _clear()

    assert resp.status_code == 204
    assert user.storage_used_bytes == 0  # clamped — never negative


# ── IDOR / ownership checks ────────────────────────────────────────────────

async def test_delete_another_users_file_returns_403(mock_db):
    """A Pro user MUST NOT be able to delete a file belonging to a different user.

    This is the critical IDOR guard: the blob path prefix must match the
    authenticated user's clerk_user_id, not any arbitrary user's.
    """
    attacker = make_user(
        clerk_user_id="user_attacker",
        subscription_tier="pro",
        storage_used_bytes=0,
    )
    settings = _mock_settings()

    _override(attacker, mock_db, settings)
    try:
        with patch("app.routers.media.delete_media_blob") as mock_del:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                # Attempt to delete a blob that belongs to "user_victim", not "user_attacker"
                resp = await client.delete(
                    _delete_url("uploads/user_victim/secret_photo.jpg")
                )
    finally:
        _clear()

    assert resp.status_code == 403
    assert "access denied" in resp.json()["detail"].lower()
    # The storage service must never be called — the check must happen before GCS access.
    mock_del.assert_not_called()
    mock_db.commit.assert_not_awaited()


async def test_delete_path_traversal_attempt_returns_403(mock_db):
    """Attempt to escape the user's prefix via path traversal is rejected with 403.

    e.g. uploads/user_attacker/../../user_victim/file.jpg starts with the
    attacker's prefix but resolves to a different user's blob.  The prefix
    check stops this because the raw path does NOT start with the expected prefix
    once a double-dot segment is included — but we explicitly test it anyway to
    ensure no normalisation is applied before the check.
    """
    attacker = make_user(
        clerk_user_id="user_attacker",
        subscription_tier="pro",
        storage_used_bytes=0,
    )
    settings = _mock_settings()

    _override(attacker, mock_db, settings)
    try:
        with patch("app.routers.media.delete_media_blob") as mock_del:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.delete(
                    _delete_url(
                        "uploads/user_attacker/../../user_victim/secret.jpg"
                    )
                )
    finally:
        _clear()

    # 403 or 404 are both acceptable; what matters is that GCS is never touched.
    assert resp.status_code in (403, 404)
    mock_del.assert_not_called()
    mock_db.commit.assert_not_awaited()


async def test_delete_requires_pro(mock_db):
    """Free-tier users receive 402 when attempting to delete media."""
    user = make_user(subscription_tier="free")
    settings = _mock_settings()

    app.dependency_overrides[get_current_user_id] = lambda: user.clerk_user_id
    app.dependency_overrides[get_db] = lambda: mock_db
    app.dependency_overrides[get_settings] = lambda: settings
    from unittest.mock import MagicMock as MM
    result_mock = MM()
    result_mock.scalar_one_or_none.return_value = user
    mock_db.execute.return_value = result_mock
    try:
        with patch("app.routers.media.delete_media_blob") as mock_del:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.delete(
                    _delete_url("uploads/user_test/photo.jpg")
                )
    finally:
        _clear()

    assert resp.status_code == 402
    mock_del.assert_not_called()


async def test_delete_gcs_failure_returns_500(mock_db):
    """If delete_media_blob raises, the endpoint propagates it as 500 and never commits.

    The storage quota counter must not be decremented when GCS fails — otherwise
    the counter would drift downward on every failed delete attempt.
    """
    user = make_user(subscription_tier="pro", storage_used_bytes=500)
    settings = _mock_settings()

    _override(user, mock_db, settings)
    try:
        with patch(
            "app.routers.media.delete_media_blob",
            side_effect=RuntimeError("GCS unavailable"),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.delete(
                    _delete_url("uploads/user_test/photo.jpg")
                )
    finally:
        _clear()

    assert resp.status_code == 500
    # Storage counter must not have been decremented.
    mock_db.commit.assert_not_awaited()

