"""Unit tests for app/services/storage.py

Covers:
  - list_user_media_uses_sign_blob_path: confirms the signed URL is generated
    via sign_blob_path() (the IAM-impersonation-aware helper), NOT via
    blob.generate_signed_url() directly. This is the regression test for the
    bug where list_user_media bypassed SA impersonation for ADC credentials.
  - list_user_media_returns_correct_metadata: checks blob metadata is mapped
    into the returned dicts correctly (filename, content_type, size_bytes, url).
  - list_user_media_scopes_to_user_prefix: confirms the GCS list is scoped to
    uploads/<user_id>/ so users never see each other's files.
  - list_user_media_returns_empty_when_no_blobs: empty GCS prefix → empty list.
  - sign_blob_path_uses_sa_email_for_adc_credentials: when credentials are not
    a Signing instance (ADC user creds), GCS signBlob is called with the SA email
    and the refreshed access token from the settings.
  - sign_blob_path_signs_directly_for_sa_credentials: SA credentials (Signing)
    call generate_signed_url without service_account_email.
"""

import sys
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, call, patch

import pytest

# ── All GCP imports must be stubbed before storage.py is imported ──────────
# conftest.py already stubs these at the sys.modules level, but we guard here
# to be explicit and allow this file to be run in isolation if needed.
for _mod in [
    "google",
    "google.auth",
    "google.auth.credentials",
    "google.auth.transport",
    "google.auth.transport.requests",
    "google.cloud",
    "google.cloud.storage",
]:
    sys.modules.setdefault(_mod, MagicMock())


def _make_fake_blob(
    name: str,
    content_type: str = "image/jpeg",
    size: int = 1024,
    time_created: datetime | None = None,
) -> MagicMock:
    blob = MagicMock()
    blob.name = name
    blob.content_type = content_type
    blob.size = size
    blob.time_created = time_created or datetime(2026, 5, 1, 10, 0, 0, tzinfo=timezone.utc)
    return blob


# ── list_user_media ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_user_media_uses_sign_blob_path():
    """Signed URLs must be generated via sign_blob_path(), not blob.generate_signed_url().

    This is the regression test for the bug where list_user_media called
    blob.generate_signed_url() directly, which bypasses the IAM signBlob
    impersonation path required when running with ADC user credentials.
    """
    fake_blob = _make_fake_blob("uploads/user_abc/uuid1_photo.jpg")

    mock_bucket = MagicMock()
    mock_bucket.list_blobs.return_value = [fake_blob]

    mock_client = MagicMock()
    mock_client.bucket.return_value = mock_bucket

    signed_url = "https://storage.googleapis.com/signed-url-for-photo"

    with (
        patch("app.services.storage._get_client", return_value=mock_client),
        patch(
            "app.services.storage.sign_blob_path",
            new_callable=AsyncMock,
            return_value=signed_url,
        ) as mock_sign,
    ):
        from app.services.storage import list_user_media

        result = await list_user_media("user_abc")

    # sign_blob_path must have been called with the blob's name.
    mock_sign.assert_awaited_once_with("uploads/user_abc/uuid1_photo.jpg")
    # The signed URL must appear in the returned item, not a blob.generate_signed_url() call.
    assert result[0]["url"] == signed_url
    # The raw blob must never have had generate_signed_url called on it.
    fake_blob.generate_signed_url.assert_not_called()


@pytest.mark.asyncio
async def test_list_user_media_returns_correct_metadata():
    """Metadata fields in the returned dicts match the GCS blob attributes."""
    created_at = datetime(2026, 4, 15, 8, 30, 0, tzinfo=timezone.utc)
    fake_blob = _make_fake_blob(
        "uploads/user_abc/550e8400-e29b-41d4-a716-446655440000_my_file.pdf",
        content_type="application/pdf",
        size=204800,
        time_created=created_at,
    )

    mock_bucket = MagicMock()
    mock_bucket.list_blobs.return_value = [fake_blob]
    mock_client = MagicMock()
    mock_client.bucket.return_value = mock_bucket

    with (
        patch("app.services.storage._get_client", return_value=mock_client),
        patch(
            "app.services.storage.sign_blob_path",
            new_callable=AsyncMock,
            return_value="https://storage.example.com/signed",
        ),
    ):
        from app.services.storage import list_user_media

        result = await list_user_media("user_abc")

    assert len(result) == 1
    item = result[0]
    assert item["blob_path"] == "uploads/user_abc/550e8400-e29b-41d4-a716-446655440000_my_file.pdf"
    assert item["filename"] == "my_file.pdf"  # UUID prefix stripped
    assert item["content_type"] == "application/pdf"
    assert item["size_bytes"] == 204800
    assert item["uploaded_at"] == created_at.isoformat()
    assert item["url"] == "https://storage.example.com/signed"


@pytest.mark.asyncio
async def test_list_user_media_scopes_to_user_prefix():
    """GCS list_blobs is called with the correct per-user prefix."""
    mock_bucket = MagicMock()
    mock_bucket.list_blobs.return_value = []
    mock_client = MagicMock()
    mock_client.bucket.return_value = mock_bucket

    with (
        patch("app.services.storage._get_client", return_value=mock_client),
        patch("app.services.storage.sign_blob_path", new_callable=AsyncMock),
    ):
        from app.services.storage import list_user_media

        await list_user_media("user_xyz")

    # list_blobs must be called with the scoped prefix, not an empty prefix that
    # would return every file in the bucket.
    mock_bucket.list_blobs.assert_called_once_with(prefix="uploads/user_xyz/")


@pytest.mark.asyncio
async def test_list_user_media_returns_empty_when_no_blobs():
    """An empty GCS prefix produces an empty list without errors."""
    mock_bucket = MagicMock()
    mock_bucket.list_blobs.return_value = []
    mock_client = MagicMock()
    mock_client.bucket.return_value = mock_bucket

    with (
        patch("app.services.storage._get_client", return_value=mock_client),
        patch("app.services.storage.sign_blob_path", new_callable=AsyncMock),
    ):
        from app.services.storage import list_user_media

        result = await list_user_media("user_no_uploads")

    assert result == []


# ── sign_blob_path ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_sign_blob_path_uses_sa_email_for_adc_credentials():
    """When credentials are NOT a Signing instance (ADC user creds), sign_blob_path
    calls generate_signed_url with service_account_email and access_token from settings.

    This is the ADC + SA impersonation path that was broken by the list_user_media bug.
    """
    import google.auth.credentials as _creds_mod

    # Non-signing credentials (ADC user credentials): has refresh/token but no Signing methods.
    fake_creds = MagicMock(spec=["refresh", "token"])
    fake_creds.token = "ya29.fresh-access-token"

    fake_blob = MagicMock()
    fake_blob.generate_signed_url.return_value = "https://storage.googleapis.com/signed"

    mock_bucket = MagicMock()
    mock_bucket.blob.return_value = fake_blob
    mock_client = MagicMock()
    mock_client.bucket.return_value = mock_bucket

    mock_settings = MagicMock()
    mock_settings.gcs_bucket_name = "clarimetis-media-dev"
    mock_settings.gcs_signing_sa_email = "signer@my-project.iam.gserviceaccount.com"

    with (
        patch("app.services.storage._get_client", return_value=mock_client),
        patch("app.services.storage.get_gcp_credentials", return_value=fake_creds),
        patch(
            "app.services.storage.get_settings",
            return_value=mock_settings,
        ),
        # isinstance(creds, google.auth.credentials.Signing) must return False
        patch(
            "app.services.storage.google.auth.credentials.Signing",
            new=type("_NeverMatch", (), {}),  # a class nothing will match
        ),
        patch("asyncio.to_thread", side_effect=_fake_to_thread),
    ):
        from app.services.storage import sign_blob_path

        url = await sign_blob_path("uploads/user_abc/uuid1_photo.jpg")

    # Must have been called with the IAM impersonation kwargs.
    call_kwargs = fake_blob.generate_signed_url.call_args.kwargs
    assert call_kwargs["service_account_email"] == "signer@my-project.iam.gserviceaccount.com"
    assert call_kwargs["access_token"] == "ya29.fresh-access-token"
    assert url == "https://storage.googleapis.com/signed"


async def _fake_to_thread(fn, *args, **kwargs):
    """Minimal asyncio.to_thread shim that calls the function synchronously."""
    if callable(fn):
        return fn(*args, **kwargs)
    # For lambdas passed as positional arg (asyncio.to_thread(lambda: ...))
    return fn()
