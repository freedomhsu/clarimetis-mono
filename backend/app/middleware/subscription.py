"""Subscription tier enforcement.

Free-tier limits:
  - N messages per day (configurable via settings.free_daily_message_limit)
  - Wellness Coach agent only (no Cognitive Debugger, Strategist, Architect)
  - No voice input
  - No media upload
  - No insights dashboard

Exported FastAPI dependencies:
  require_pro        — raises 402 if user is not on pro tier
  check_message_quota — raises 429 if free-tier user has hit their daily cap
"""

from datetime import timezone
from datetime import datetime as dt

from fastapi import Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.middleware.auth import get_current_user_id
from app.models.message import Message
from app.models.session import ChatSession
from app.models.user import User

_402 = HTTPException(
    status_code=status.HTTP_402_PAYMENT_REQUIRED,
    detail={
        "code": "subscription_required",
        "message": "This feature requires a Pro subscription.",
        "upgrade_path": "/users/subscribe",
    },
)


async def get_current_user(
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Shared dependency — resolves the authenticated Clerk user to a DB User."""
    result = await db.execute(select(User).where(User.clerk_user_id == clerk_user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found. Call POST /users/sync first.",
        )
    return user


# Keep the private alias for backwards compatibility within this module.
_get_user = get_current_user


async def require_pro(user: User = Depends(get_current_user)) -> User:
    """Dependency — raises 402 if the user is not on the pro tier."""
    if user.subscription_tier != "pro":
        raise _402
    return user


async def check_message_quota(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Dependency — raises 429 for free users who have hit their daily message cap.

    Pro users pass through immediately with no DB query.
    """
    if user.subscription_tier == "pro":
        return user

    today_start = dt.now(tz=timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    count = await db.scalar(
        select(func.count())
        .select_from(Message)
        .join(ChatSession, Message.session_id == ChatSession.id)
        .where(
            ChatSession.user_id == user.id,
            Message.role == "user",
            Message.created_at >= today_start,
        )
    )

    if (count or 0) >= settings.free_daily_message_limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "daily_limit_reached",
                "message": f"Free accounts are limited to {settings.free_daily_message_limit} messages per day.",
                "limit": settings.free_daily_message_limit,
                "upgrade_path": "/users/subscribe",
            },
        )

    return user
