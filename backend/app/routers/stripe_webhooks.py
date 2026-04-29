import logging

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings, SettingsDep
from app.database import get_db
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.post("/stripe")
async def handle_stripe_webhook(
    settings: SettingsDep,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict:
    stripe.api_key = settings.stripe_secret_key
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.stripe_webhook_secret
        )
    except (ValueError, stripe.error.SignatureVerificationError) as exc:
        raise HTTPException(status_code=400, detail="Invalid webhook signature") from exc

    event_type: str = event["type"]
    obj = event["data"]["object"]

    try:
        if event_type == "checkout.session.completed":
            # Immediately mark the user as Pro when checkout succeeds.
            # This fires before customer.subscription.created and avoids
            # the frontend polling window being too narrow.
            if obj.get("mode") == "subscription" and obj.get("payment_status") == "paid":
                customer_id = obj.get("customer")
                if customer_id:
                    result = await db.execute(
                        select(User).where(User.stripe_customer_id == customer_id)
                    )
                    user = result.scalar_one_or_none()
                    if user:
                        user.subscription_tier = "pro"
                        if obj.get("subscription"):
                            user.stripe_subscription_id = obj["subscription"]
                        await db.commit()
                    else:
                        logger.warning(
                            "stripe webhook: checkout.session.completed — no user found for customer_id=%s",
                            customer_id,
                        )

        elif event_type in ("customer.subscription.created", "customer.subscription.updated"):
            customer_id: str = obj["customer"]
            sub_status: str = obj["status"]
            tier = "pro" if sub_status == "active" else "free"
            result = await db.execute(
                select(User).where(User.stripe_customer_id == customer_id)
            )
            user = result.scalar_one_or_none()
            if user:
                user.subscription_tier = tier
                user.stripe_subscription_id = obj["id"]
                await db.commit()
            else:
                logger.warning(
                    "stripe webhook: %s — no user found for customer_id=%s",
                    event_type,
                    customer_id,
                )

        elif event_type == "customer.subscription.deleted":
            customer_id = obj["customer"]
            result = await db.execute(
                select(User).where(User.stripe_customer_id == customer_id)
            )
            user = result.scalar_one_or_none()
            if user:
                user.subscription_tier = "free"
                user.stripe_subscription_id = None
                await db.commit()
            else:
                logger.warning(
                    "stripe webhook: customer.subscription.deleted — no user found for customer_id=%s",
                    customer_id,
                )

    except Exception as exc:
        # Log but always return 200 so Stripe does not retry — the event has been received.
        # Persistent failures should be investigated via logs / Stripe dashboard.
        logger.error("stripe webhook: error processing event %s — %s", event_type, exc)

    return {"received": True}
