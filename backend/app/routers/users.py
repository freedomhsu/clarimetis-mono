import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings, SettingsDep
from app.database import get_db
from app.middleware.auth import get_current_user_id
from app.models.user import User
from app.services import stripe_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["users"])


class UserSync(BaseModel):
    email: str
    full_name: str | None = None


# Supported language codes — kept in sync with the frontend selector
SUPPORTED_LANGUAGES = {"en", "es", "pt", "fr", "zh-TW", "ja", "ko", "it"}


class UserOut(BaseModel):
    id: uuid.UUID
    clerk_user_id: str
    email: str
    full_name: str | None
    subscription_tier: str
    storage_used_bytes: int = 0
    preferred_language: str = "en"

    model_config = {"from_attributes": True}


class LanguageUpdate(BaseModel):
    language: str


class BillingUrlResponse(BaseModel):
    url: str


class SubscribeRequest(BaseModel):
    plan: str = "monthly"  # "monthly" | "annual"


@router.post("/sync", response_model=UserOut)
async def sync_user(
    body: UserSync,
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Called after sign-in to upsert the user record and create a Stripe customer."""
    result = await db.execute(select(User).where(User.clerk_user_id == clerk_user_id))
    user = result.scalar_one_or_none()

    if user is None:
        try:
            stripe_customer_id: str | None = await stripe_service.create_customer(
                body.email, body.full_name
            )
        except Exception as exc:
            logger.error("sync_user: failed to create Stripe customer for %s — %s", body.email, exc)
            stripe_customer_id = None
        user = User(
            clerk_user_id=clerk_user_id,
            email=body.email,
            full_name=body.full_name,
            stripe_customer_id=stripe_customer_id,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    else:
        user.email = body.email
        user.full_name = body.full_name
        await db.commit()
        await db.refresh(user)

    return user


@router.get("/me", response_model=UserOut)
async def get_me(
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> User:
    result = await db.execute(select(User).where(User.clerk_user_id == clerk_user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


@router.get("/language")
async def get_language(
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return the user's preferred language code."""
    result = await db.execute(select(User).where(User.clerk_user_id == clerk_user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return {"preferred_language": user.preferred_language}


@router.patch("/language")
async def set_language(
    body: LanguageUpdate,
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Update the user's preferred language."""
    if body.language not in SUPPORTED_LANGUAGES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported language '{body.language}'. Supported: {sorted(SUPPORTED_LANGUAGES)}",
        )
    result = await db.execute(select(User).where(User.clerk_user_id == clerk_user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    user.preferred_language = body.language
    await db.commit()
    return {"preferred_language": user.preferred_language}


@router.post("/subscribe", response_model=BillingUrlResponse)
async def subscribe(
    settings: SettingsDep,
    body: SubscribeRequest = SubscribeRequest(),
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(select(User).where(User.clerk_user_id == clerk_user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    # If Stripe customer creation failed during sync, retry it now
    if not user.stripe_customer_id:
        try:
            user.stripe_customer_id = await stripe_service.create_customer(user.email, user.full_name)
            await db.commit()
        except Exception as exc:
            logger.error("subscribe: Stripe customer creation failed for user %s — %s", user.id, exc)
            raise HTTPException(status_code=503, detail="Billing setup failed. Please try again later.") from exc

    price_id = (
        settings.stripe_pro_annual_price_id
        if body.plan == "annual"
        else settings.stripe_pro_monthly_price_id
    )
    url = await stripe_service.create_checkout_session(
        customer_id=user.stripe_customer_id,
        success_url=f"{settings.frontend_url}/dashboard?upgrade=success&plan={body.plan}",
        cancel_url=f"{settings.frontend_url}/dashboard",
        price_id=price_id,
    )
    return {"url": url}


@router.post("/billing-portal", response_model=BillingUrlResponse)
async def billing_portal(
    settings: SettingsDep,
    clerk_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(select(User).where(User.clerk_user_id == clerk_user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.stripe_customer_id:
        raise HTTPException(status_code=400, detail="No billing account found. Please contact support.")

    url = await stripe_service.create_portal_session(
        customer_id=user.stripe_customer_id,
        return_url=f"{settings.frontend_url}/dashboard",
    )
    return {"url": url}
