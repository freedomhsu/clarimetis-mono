"""Media Library router.

Endpoints:
  POST   /media/upload          — validate, store, and OCR a media file
  GET    /media                 — list the caller's uploaded files
  DELETE /media/{blob_path}     — delete a file and reclaim quota

Design decisions:
  * All validation (size, MIME) is extracted into FastAPI dependencies so each
    route handler contains only business logic.
  * MIME detection uses magic bytes via ``storage.detect_mime`` — the
    client-supplied Content-Type header is checked only as a fast pre-flight
    to fail cheaply before reading the body; the magic-byte result is the
    authoritative type.
  * Storage quota is enforced with a single atomic UPDATE to prevent the
    read-check-write race that would allow concurrent uploads to exceed quota.
  * The sidecar OCR step runs after the quota commit so a Document AI failure
    never blocks the upload — Gemini falls back to native file handling.
"""

import logging
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import func as sa_func
from sqlalchemy import update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, SettingsDep, get_settings
from app.database import get_db
from app.middleware.auth import get_current_user_id
from app.middleware.subscription import require_pro
from app.models.user import User
from app.rate_limit import limiter
from app.services.document_ai import extract_document_text
from app.services.storage import (
    delete_media_blob,
    detect_mime,
    list_user_media,
    sign_blob_path,
    upload_media,
    upload_text_sidecar,
)

router = APIRouter(prefix="/media", tags=["media"])
logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

# MIME types the upload endpoint accepts.  Adding a new type here is the only
# change required — no logic changes needed anywhere else.
_ALLOWED_TYPES: frozenset[str] = frozenset({
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "application/pdf",
})

# Subset of _ALLOWED_TYPES for which Document AI OCR is attempted.
_OCR_TYPES: frozenset[str] = frozenset({
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
})


# ── Response schemas ──────────────────────────────────────────────────────────

class MediaUploadResponse(BaseModel):
    url: str        # fresh 1-hour signed URL for immediate preview
    blob_path: str  # GCS blob path — store this in Message.media_urls
    content_type: str


class MediaFileResponse(BaseModel):
    blob_path: str
    filename: str
    content_type: str
    size_bytes: int
    uploaded_at: str | None  # None when GCS metadata is unavailable
    url: str  # fresh 1-hour signed URL


# ── Dependencies ──────────────────────────────────────────────────────────────

class _ValidatedUpload:
    """Carries the validated file bytes and magic-byte-detected MIME type."""

    __slots__ = ("content", "actual_type", "filename")

    def __init__(self, content: bytes, actual_type: str, filename: str) -> None:
        self.content = content
        self.actual_type = actual_type
        self.filename = filename


async def _validate_upload(
    request: Request,
    settings: Settings = Depends(get_settings),
    file: UploadFile = File(...),
) -> _ValidatedUpload:
    """Dependency: read, size-check, and magic-byte-validate the upload.

    Steps in order:
    1. Cheap pre-flight: reject the declared Content-Type if it is not in the
       allow-list.  This avoids reading a large body just to reject it.
    2. Read the body (Content-Length guard first to avoid OOM on huge payloads).
    3. Re-check actual body size in case Content-Length was absent/spoofed.
    4. Detect the true MIME type from magic bytes — this is the authoritative
       check.  The pre-flight in step 1 is a best-effort optimisation only.
    """
    # ① Fast pre-flight on declared Content-Type (best-effort; not authoritative).
    if file.content_type and file.content_type not in _ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file.content_type}",
        )

    # ② Guard against reading huge bodies into memory.
    content_length = int(request.headers.get("content-length", 0))
    max_mb = settings.max_upload_bytes // (1024 * 1024)
    if content_length > settings.max_upload_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the {max_mb} MB limit.",
        )

    content = await file.read()

    # ③ Re-check after reading (Content-Length may have been absent or spoofed).
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the {max_mb} MB limit.",
        )

    # ④ Magic-byte detection — never trust the client-supplied Content-Type.
    actual_type = detect_mime(content)
    if actual_type not in _ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail="File content does not match an allowed media type.",
        )

    return _ValidatedUpload(
        content=content,
        actual_type=actual_type,
        filename=file.filename or "upload",
    )


# Annotated alias for use in route signatures.
ValidatedUploadDep = Annotated[_ValidatedUpload, Depends(_validate_upload)]


# ── Background task ───────────────────────────────────────────────────────────

async def _run_ocr_and_store_sidecar(
    blob_path: str, actual_type: str, gcs_bucket: str
) -> None:
    """Run Document AI OCR and write the text sidecar.

    Runs as a BackgroundTask so it never delays the upload response.
    Failures are silently swallowed — Gemini falls back to native handling.
    """
    if actual_type not in _OCR_TYPES:
        return
    gcs_uri = f"gs://{gcs_bucket}/{blob_path}"
    extracted_text = await extract_document_text(gcs_uri, actual_type)
    if extracted_text:
        await upload_text_sidecar(blob_path, extracted_text)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/upload", response_model=MediaUploadResponse)
@limiter.limit("20/hour")
@limiter.limit("30/day")
async def upload_file(
    request: Request,
    background_tasks: BackgroundTasks,
    settings: SettingsDep,
    validated: ValidatedUploadDep,
    clerk_user_id: str = Depends(get_current_user_id),
    user: User = Depends(require_pro),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Validate, store, and optionally OCR a media file.

    The quota increment is a single atomic UPDATE (WHERE clause guard) to
    prevent concurrent uploads from exceeding the per-user storage limit.
    OCR runs in a BackgroundTask so it never delays the response.
    """
    # Atomic quota check + increment.  A plain read-check-write would allow two
    # concurrent uploads to both pass the check and overwrite each other's update.
    quota_result = await db.execute(
        sa_update(User)
        .where(
            User.id == user.id,
            User.storage_used_bytes + len(validated.content) <= settings.max_pro_storage_bytes,
        )
        .values(storage_used_bytes=User.storage_used_bytes + len(validated.content))
    )
    if quota_result.rowcount == 0:
        quota_mb = settings.max_pro_storage_bytes // (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"Upload would exceed your {quota_mb} MB storage quota.",
        )
    await db.commit()

    # Upload to GCS — if this fails, immediately roll back the quota increment
    # so the user's storage counter reflects reality.
    try:
        blob_path = await upload_media(
            file_bytes=validated.content,
            filename=validated.filename,
            content_type=validated.actual_type,
            user_id=clerk_user_id,
        )
    except Exception as gcs_exc:
        logger.error("upload_media: GCS upload failed for user %s: %s", clerk_user_id, gcs_exc, exc_info=True)
        try:
            await db.execute(
                sa_update(User)
                .where(User.id == user.id)
                .values(
                    storage_used_bytes=sa_func.greatest(
                        User.storage_used_bytes - len(validated.content), 0
                    )
                )
            )
            await db.commit()
        except Exception as rollback_exc:
            logger.error("upload_media: quota rollback failed for user %s: %s", clerk_user_id, rollback_exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Failed to store the file. Please try again.",
        ) from gcs_exc

    # OCR runs after the commit: a failure here never blocks the upload.
    background_tasks.add_task(
        _run_ocr_and_store_sidecar,
        blob_path,
        validated.actual_type,
        settings.gcs_bucket_name,
    )

    # Sign the blob so the client can preview it immediately.
    # The blob path (not this URL) is what gets stored in Message.media_urls.
    signed_url = await sign_blob_path(blob_path)
    return {"url": signed_url, "blob_path": blob_path, "content_type": validated.actual_type}


@router.get("", response_model=list[MediaFileResponse])
async def list_files(
    user: User = Depends(require_pro),
) -> list[dict]:
    """Return all media files uploaded by the authenticated Pro user."""
    return await list_user_media(user.clerk_user_id)


@router.delete("/{blob_path:path}", status_code=204)
async def delete_file(
    blob_path: str,
    user: User = Depends(require_pro),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a media file and atomically decrement the user's storage quota.

    Only the file's owner may delete it — any attempt to delete another user's
    blob is rejected with 403.
    """
    expected_prefix = f"uploads/{user.clerk_user_id}/"
    if not blob_path.startswith(expected_prefix):
        raise HTTPException(status_code=403, detail="Access denied.")

    try:
        size = await delete_media_blob(blob_path)
    except Exception as exc:
        logger.error("delete_media_blob failed for %s: %s", blob_path, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to delete file from storage.")

    # Atomic decrement — clamp to 0 to guard against counter drift.
    await db.execute(
        sa_update(User)
        .where(User.id == user.id)
        .values(
            storage_used_bytes=sa_func.greatest(User.storage_used_bytes - size, 0)
        )
    )
    await db.commit()
