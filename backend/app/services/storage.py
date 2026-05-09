import asyncio
import io
import logging
import uuid
from datetime import timedelta
from threading import Lock

import google.auth
import google.auth.credentials
import google.auth.transport.requests
from google.cloud import storage

from app.config import get_settings
from app.services.gcp_credentials import get_gcp_credentials

logger = logging.getLogger(__name__)

# ── GCS client singleton ──────────────────────────────────────────────────────

_client: storage.Client | None = None
_client_lock = Lock()

# Signed URLs are valid for a configurable number of hours (default 1). They are
# generated on-demand at read time so stored messages never have stale / expired URLs.

# Document AI text sidecar: extracted text is stored at "<blob_path>.txt".
# Defined at the top so every function below can reference it.
_SIDECAR_SUFFIX = ".txt"


def _get_client() -> storage.Client:
    """Return the process-level GCS client, creating it on first call (thread-safe)."""
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:
                credentials = get_gcp_credentials()
                _client = storage.Client(
                    project=get_settings().gcp_project_id, credentials=credentials
                )
    return _client


# ── MIME detection ────────────────────────────────────────────────────────────

# Magic bytes that the `filetype` library cannot detect — checked manually.
# Shared with routers so there is a single source of truth.
MAGIC_OVERRIDES: list[tuple[bytes, str]] = [
    (b"%PDF", "application/pdf"),
]


def detect_mime(content: bytes) -> str | None:
    """Return the MIME type detected from *content*'s magic bytes.

    Checks manual overrides first (for types the ``filetype`` library misses),
    then delegates to the library.  Returns ``None`` when unrecognised.
    """
    import filetype  # local import — optional dep, avoids cost on import path

    for magic, mime in MAGIC_OVERRIDES:
        if content[: len(magic)] == magic:
            return mime
    detected = filetype.guess(content)
    return detected.mime if detected else None


def is_blob_path(value: str) -> bool:
    """Return True if *value* looks like a GCS blob path rather than a URL."""
    return value.startswith("uploads/") and not value.startswith("http")


# ── Upload ────────────────────────────────────────────────────────────────────

async def upload_media(
    file_bytes: bytes, filename: str, content_type: str, user_id: str
) -> str:
    """Upload bytes to GCS and return the **blob path** (not a signed URL).

    The caller is responsible for generating a signed URL when the path must
    be exposed to the client.  Storing the path instead of a time-limited
    signed URL ensures that stored messages remain accessible indefinitely.
    """
    client = _get_client()
    bucket = client.bucket(get_settings().gcs_bucket_name)
    # Sanitise the filename to prevent path traversal: replace every slash and
    # every occurrence of ".." with "_".
    safe_filename = filename.replace("/", "_").replace("..", "_")
    blob_name = f"uploads/{user_id}/{uuid.uuid4()}_{safe_filename}"
    blob = bucket.blob(blob_name)

    await asyncio.to_thread(
        blob.upload_from_file, io.BytesIO(file_bytes), content_type=content_type
    )

    # Return the GCS path — e.g. "uploads/<uid>/<uuid>_photo.png"
    return blob_name


# ── Signed URL generation ─────────────────────────────────────────────────────

def _get_signing_credentials() -> tuple["google.auth.credentials.Credentials", str | None]:
    """Return (credentials, service_account_email_or_None) for URL signing.

    Service account credentials can sign locally.  User / ADC credentials
    require the IAM signBlob API — the caller must supply the SA email via
    the GCS_SIGNING_SA_EMAIL setting.
    """
    creds = get_gcp_credentials()
    if creds is None:
        # ADC path — discover the real credentials so we can inspect their type.
        creds, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )

    if isinstance(creds, google.auth.credentials.Signing):
        # Service account credentials: can sign directly, no SA email needed.
        return creds, None

    # User / workload credentials: must use IAM signBlob API.
    sa_email = get_settings().gcs_signing_sa_email
    if not sa_email:
        raise RuntimeError(
            "Signed URL generation requires service-account credentials. "
            "You are using user ADC credentials (gcloud auth application-default login). "
            "Set the GCS_SIGNING_SA_EMAIL environment variable to a service account "
            "email that your ADC user has the roles/iam.serviceAccountTokenCreator "
            "role on, e.g.:\n"
            "  GCS_SIGNING_SA_EMAIL=my-sa@my-project.iam.gserviceaccount.com"
        )
    return creds, sa_email


async def sign_blob_path(blob_path: str) -> str:
    """Generate a fresh 1-hour signed GET URL for a GCS blob path."""
    client = _get_client()
    bucket = client.bucket(get_settings().gcs_bucket_name)
    blob = bucket.blob(blob_path)

    creds, sa_email = _get_signing_credentials()

    if sa_email is None:
        # Service account — sign locally.
        signed_url_ttl = timedelta(hours=get_settings().signed_url_ttl_hours)
        url: str = await asyncio.to_thread(
            blob.generate_signed_url,
            expiration=signed_url_ttl,
            method="GET",
            version="v4",
        )
    else:
        # User ADC — refresh the token, then let GCS call IAM signBlob.
        await asyncio.to_thread(
            creds.refresh, google.auth.transport.requests.Request()
        )
        signed_url_ttl = timedelta(hours=get_settings().signed_url_ttl_hours)
        url = await asyncio.to_thread(
            blob.generate_signed_url,
            expiration=signed_url_ttl,
            method="GET",
            version="v4",
            service_account_email=sa_email,
            access_token=creds.token,
        )

    return url


# ── Media Library ─────────────────────────────────────────────────────────────

async def list_user_media(user_id: str) -> list[dict]:
    """Return metadata + signed URLs for every blob uploaded by *user_id*.

    Blobs are returned newest-first.  All signed URLs are generated in
    parallel so listing N files costs one GCS list call + N concurrent
    thread-pool tasks rather than N sequential round-trips.
    """
    client = _get_client()
    bucket = client.bucket(get_settings().gcs_bucket_name)
    prefix = f"uploads/{user_id}/"

    blobs: list = await asyncio.to_thread(
        lambda: list(bucket.list_blobs(prefix=prefix))
    )

    # Filter out Document AI text sidecar files — internal implementation
    # detail that must never appear in the user-facing Media Library.
    media_blobs = [b for b in blobs if not b.name.endswith(_SIDECAR_SUFFIX)]

    # Sign all URLs concurrently — one thread-pool task per blob.
    signed_urls: list[str] = await asyncio.gather(
        *[sign_blob_path(b.name) for b in media_blobs]
    )

    items = []
    for blob, url in zip(media_blobs, signed_urls):
        # Recover the original filename by stripping the "<uuid4>_" prefix.
        # blob name: "uploads/<user_id>/<uuid4>_<safe_filename>"
        basename = blob.name.rsplit("/", 1)[-1]
        # split on the first underscore that follows the UUID (36 chars + 1 "_")
        filename = basename[37:] if len(basename) > 37 and basename[36] == "_" else basename

        items.append({
            "blob_path": blob.name,
            "filename": filename,
            "content_type": blob.content_type or "application/octet-stream",
            "size_bytes": blob.size or 0,
            "uploaded_at": blob.time_created.isoformat() if blob.time_created else None,
            "url": url,
        })

    items.sort(key=lambda x: x["uploaded_at"], reverse=True)
    return items


async def delete_all_user_media(user_id: str) -> int:
    """Delete every GCS object under ``uploads/<user_id>/`` and return the
    total bytes freed.

    Called by the Clerk ``user.deleted`` webhook to purge media files when a
    user deletes their account.  Errors on individual blobs are logged but
    never re-raised so the webhook handler can still delete the DB row.
    """
    client = _get_client()
    bucket = client.bucket(get_settings().gcs_bucket_name)
    prefix = f"uploads/{user_id}/"

    blobs: list = await asyncio.to_thread(
        lambda: list(bucket.list_blobs(prefix=prefix))
    )

    total_freed = 0

    async def _delete_one(blob) -> int:
        try:
            size: int = blob.size or 0
            await asyncio.to_thread(blob.delete)
            return size
        except Exception as exc:
            logger.warning("Failed to delete GCS blob %s: %s", blob.name, exc)
            return 0

    results = await asyncio.gather(*[_delete_one(b) for b in blobs])
    total_freed = sum(results)
    logger.info(
        "Purged %d GCS object(s) (%d bytes) for user %s",
        len(blobs),
        total_freed,
        user_id,
    )
    return total_freed


async def delete_media_blob(blob_path: str) -> int:
    """Delete a blob from GCS and return its size in bytes.

    Also deletes the Document AI text sidecar (``blob_path + ".txt"``)
    if one exists, so orphaned sidecar files do not accumulate.

    Returns 0 if the blob was already gone (idempotent).
    """
    client = _get_client()
    bucket = client.bucket(get_settings().gcs_bucket_name)
    blob = bucket.blob(blob_path)
    try:
        await asyncio.to_thread(blob.reload)
        size: int = blob.size or 0
        await asyncio.to_thread(blob.delete)
    except Exception:
        # Blob not found or already deleted — treat as success.
        logger.debug("delete_media_blob: blob %s not found or already deleted", blob_path)
        size = 0

    # Best-effort sidecar cleanup — never let this block the response.
    sidecar = bucket.blob(blob_path + _SIDECAR_SUFFIX)
    try:
        await asyncio.to_thread(sidecar.delete)
    except Exception:
        logger.debug("delete_media_blob: sidecar cleanup skipped for %s", blob_path + _SIDECAR_SUFFIX)

    return size


# ── Document AI text sidecar ──────────────────────────────────────────────────
# For PDFs processed by Document AI, extracted text is stored alongside the
# original blob as "<blob_path>.txt".  This avoids re-extracting on every chat
# turn and keeps the text co-located with its source file.


async def upload_text_sidecar(blob_path: str, text: str) -> None:
    """Store extracted text as a plain-text sidecar blob next to *blob_path*."""
    client = _get_client()
    bucket = client.bucket(get_settings().gcs_bucket_name)
    sidecar = bucket.blob(blob_path + _SIDECAR_SUFFIX)
    await asyncio.to_thread(
        sidecar.upload_from_string, text, content_type="text/plain; charset=utf-8"
    )


async def download_text_sidecar(blob_path: str) -> str | None:
    """Return sidecar text for *blob_path*, or None if it doesn't exist yet."""
    client = _get_client()
    bucket = client.bucket(get_settings().gcs_bucket_name)
    sidecar = bucket.blob(blob_path + _SIDECAR_SUFFIX)
    try:
        data: bytes = await asyncio.to_thread(sidecar.download_as_bytes)
        return data.decode("utf-8")
    except Exception:
        # NotFound or any other error — treat as "not available"
        logger.debug("download_text_sidecar: not available for %s", blob_path)
        return None
