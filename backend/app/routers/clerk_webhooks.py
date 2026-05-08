"""Clerk webhook handler.

Handles ``user.deleted`` to cascade-delete all user data from the database and
GCS when a user deletes their account via Clerk.

Verification uses the Svix signature scheme (HMAC-SHA256) so only genuine
Clerk events are processed.  Set ``CLERK_WEBHOOK_SECRET`` in Secret Manager to
the signing secret shown in the Clerk Dashboard → Webhooks → your endpoint.
Leave it empty only during local development where the endpoint is not
internet-exposed.

Relevant Clerk docs:
  https://clerk.com/docs/integrations/webhooks/overview
  https://docs.svix.com/receiving/verifying-payloads/how-manual
"""

import base64
import hashlib
import hmac
import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import SettingsDep
from app.database import get_db
from app.models.user import User
from app.services.storage import delete_all_user_media

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

# Svix replays are rejected when the timestamp is older than this many seconds.
_SVIX_TOLERANCE_SECONDS = 300


def _verify_svix_signature(
    payload: bytes,
    msg_id: str,
    msg_timestamp: str,
    msg_signature: str,
    secret: str,
) -> None:
    """Raise HTTPException(400) if the Svix signature is invalid or stale.

    The signing secret from the Clerk dashboard is prefixed with ``whsec_``
    followed by the base64-encoded HMAC key.

    Algorithm (from https://docs.svix.com/receiving/verifying-payloads/how-manual):
      signed_content = f"{msg_id}.{msg_timestamp}.{body}"
      key = base64.b64decode(secret.removeprefix("whsec_"))
      signature = base64.b64encode(hmac.new(key, signed_content, sha256).digest())
      expected = f"v1,{signature}"
    """
    # ── Replay protection ──────────────────────────────────────────────────
    try:
        event_ts = int(msg_timestamp)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid svix-timestamp header")
    age = abs(time.time() - event_ts)
    if age > _SVIX_TOLERANCE_SECONDS:
        raise HTTPException(status_code=400, detail="Webhook timestamp too old or too new")

    # ── Recompute expected signature ───────────────────────────────────────
    try:
        key = base64.b64decode(secret.removeprefix("whsec_"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid webhook secret format")

    signed_content = f"{msg_id}.{msg_timestamp}.".encode() + payload
    digest = hmac.new(key, signed_content, hashlib.sha256).digest()
    expected = "v1," + base64.b64encode(digest).decode()

    # ── Compare against all signatures in the header (space-separated) ────
    # Svix may include multiple signatures during key rotation.
    provided = [s.strip() for s in msg_signature.split(" ") if s.strip()]
    if not any(hmac.compare_digest(expected, sig) for sig in provided):
        raise HTTPException(status_code=400, detail="Invalid webhook signature")


async def delete_user_data(clerk_user_id: str, db: AsyncSession) -> dict[str, Any]:
    """Delete all application data for *clerk_user_id*.

    Steps:
    1. Look up the internal User row by clerk_user_id.
    2. Purge every GCS object under ``uploads/<clerk_user_id>/`` (best-effort).
    3. Delete the User row — cascades to sessions, messages, embeddings,
       user_profiles, and any other FK-linked rows via ``ondelete=CASCADE``.

    Returns a summary dict for logging.
    """
    result = await db.execute(
        select(User).where(User.clerk_user_id == clerk_user_id)
    )
    user = result.scalar_one_or_none()

    if user is None:
        # Already deleted or never synced — idempotent success.
        logger.info("clerk webhook: user.deleted — no DB row for clerk_user_id=%s (already gone)", clerk_user_id)
        return {"status": "not_found", "clerk_user_id": clerk_user_id}

    user_uuid = str(user.id)

    # GCS purge first — if this partially fails we still delete the DB row
    # so the user isn't left with orphaned data under their internal UUID.
    bytes_freed = 0
    try:
        bytes_freed = await delete_all_user_media(clerk_user_id)
    except Exception as exc:
        logger.error(
            "clerk webhook: GCS purge failed for clerk_user_id=%s: %s",
            clerk_user_id,
            exc,
        )

    # Delete the User row — FK cascades handle sessions → messages → embeddings.
    await db.delete(user)
    await db.commit()

    logger.info(
        "clerk webhook: deleted user clerk_user_id=%s internal_id=%s gcs_bytes_freed=%d",
        clerk_user_id,
        user_uuid,
        bytes_freed,
    )
    return {
        "status": "deleted",
        "clerk_user_id": clerk_user_id,
        "internal_id": user_uuid,
        "gcs_bytes_freed": bytes_freed,
    }


@router.post("/clerk")
async def handle_clerk_webhook(
    request: Request,
    settings: SettingsDep,
    db: AsyncSession = Depends(get_db),
) -> dict:
    payload = await request.body()

    # Verify signature when a secret is configured.
    if settings.clerk_webhook_secret:
        msg_id = request.headers.get("svix-id", "")
        msg_timestamp = request.headers.get("svix-timestamp", "")
        msg_signature = request.headers.get("svix-signature", "")
        if not msg_id or not msg_timestamp or not msg_signature:
            raise HTTPException(status_code=400, detail="Missing Svix signature headers")
        _verify_svix_signature(
            payload, msg_id, msg_timestamp, msg_signature, settings.clerk_webhook_secret
        )

    try:
        import json
        event = json.loads(payload)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    event_type: str = event.get("type", "")

    if event_type == "user.deleted":
        clerk_user_id: str | None = event.get("data", {}).get("id")
        if not clerk_user_id:
            raise HTTPException(status_code=400, detail="Missing user id in event data")
        await delete_user_data(clerk_user_id, db)

    else:
        logger.debug("clerk webhook: unhandled event type %s — ignoring", event_type)

    return {"received": True}
