import asyncio
import io
import uuid
from datetime import timedelta

from google.cloud import storage

from app.config import settings
from app.services.gcp_credentials import get_gcp_credentials

_client: storage.Client | None = None

# Signed URLs are valid for 1 hour. They are generated on-demand at read time
# so stored messages never have stale / expired URLs.
_SIGNED_URL_TTL = timedelta(hours=1)


def _get_client() -> storage.Client:
    global _client
    if _client is None:
        credentials = get_gcp_credentials()
        _client = storage.Client(project=settings.gcp_project_id, credentials=credentials)
    return _client


async def upload_media(
    file_bytes: bytes, filename: str, content_type: str, user_id: str
) -> str:
    """Upload bytes to GCS and return the **blob path** (not a signed URL).

    The caller is responsible for generating a signed URL when the path must
    be exposed to the client.  Storing the path instead of a time-limited
    signed URL ensures that stored messages remain accessible indefinitely.
    """
    client = _get_client()
    bucket = client.bucket(settings.gcs_bucket_name)
    # Scope uploads under the user's ID to prevent path traversal issues.
    safe_filename = filename.replace("/", "_").replace("..", "_")
    blob_name = f"uploads/{user_id}/{uuid.uuid4()}_{safe_filename}"
    blob = bucket.blob(blob_name)

    await asyncio.to_thread(
        blob.upload_from_file, io.BytesIO(file_bytes), content_type=content_type
    )

    # Return the GCS path — e.g. "uploads/<uid>/<uuid>_photo.png"
    return blob_name


async def sign_blob_path(blob_path: str) -> str:
    """Generate a fresh 1-hour signed GET URL for a GCS blob path."""
    client = _get_client()
    bucket = client.bucket(settings.gcs_bucket_name)
    blob = bucket.blob(blob_path)
    url: str = await asyncio.to_thread(
        blob.generate_signed_url,
        expiration=_SIGNED_URL_TTL,
        method="GET",
        version="v4",
    )
    return url


def is_blob_path(value: str) -> bool:
    """Return True if the string looks like a GCS blob path rather than a URL."""
    return value.startswith("uploads/") and not value.startswith("http")
