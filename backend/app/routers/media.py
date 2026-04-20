import filetype
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from app.config import SettingsDep
from app.middleware.auth import get_current_user_id
from app.middleware.subscription import require_pro
from app.models.user import User
from app.services.storage import sign_blob_path, upload_media

router = APIRouter(prefix="/media", tags=["media"])

_ALLOWED_TYPES = {
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "video/mp4",
    "video/webm",
    "video/quicktime",
}


class MediaUploadResponse(BaseModel):
    url: str        # fresh 1-hour signed URL for immediate preview
    blob_path: str  # GCS blob path — store this in Message.media_urls
    content_type: str


@router.post("/upload", response_model=MediaUploadResponse)
async def upload_file(
    request: Request,
    settings: SettingsDep,
    file: UploadFile = File(...),
    clerk_user_id: str = Depends(get_current_user_id),
    _pro: User = Depends(require_pro),
) -> dict:
    if file.content_type not in _ALLOWED_TYPES:
        raise HTTPException(
            status_code=400, detail=f"Unsupported file type: {file.content_type}"
        )

    # Reject oversized uploads before reading the body to avoid OOM on huge files.
    content_length = int(request.headers.get("content-length", 0))
    if content_length > settings.max_upload_bytes:
        max_mb = settings.max_upload_bytes // (1024 * 1024)
        raise HTTPException(status_code=413, detail=f"File exceeds the {max_mb} MB limit.")

    content = await file.read()
    # Re-check actual size in case Content-Length header was missing or spoofed.
    if len(content) > settings.max_upload_bytes:
        max_mb = settings.max_upload_bytes // (1024 * 1024)
        raise HTTPException(status_code=413, detail=f"File exceeds the {max_mb} MB limit.")

    # Verify the actual file magic bytes — never trust the client-supplied Content-Type.
    detected = filetype.guess(content)
    actual_type = detected.mime if detected else None
    if actual_type not in _ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail="File content does not match an allowed media type.",
        )

    blob_path = await upload_media(
        file_bytes=content,
        filename=file.filename or "upload",
        content_type=actual_type,
        user_id=clerk_user_id,
    )
    # Sign the blob immediately so the client can use the URL for preview.
    # The blob path (not this URL) is what gets stored in Message.media_urls.
    signed_url = await sign_blob_path(blob_path)
    return {"url": signed_url, "blob_path": blob_path, "content_type": actual_type}
