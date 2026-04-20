import asyncio

import stripe

from app.config import settings

stripe.api_key = settings.stripe_secret_key


async def create_customer(email: str, name: str | None = None) -> str:
    customer = await asyncio.to_thread(
        stripe.Customer.create, email=email, name=name
    )
    return customer.id


async def create_checkout_session(
    customer_id: str, success_url: str, cancel_url: str, price_id: str | None = None
) -> str:
    resolved_price_id = price_id or settings.stripe_pro_monthly_price_id
    session = await asyncio.to_thread(
        stripe.checkout.Session.create,
        customer=customer_id,
        payment_method_types=["card"],
        line_items=[{"price": resolved_price_id, "quantity": 1}],
        mode="subscription",
        success_url=success_url,
        cancel_url=cancel_url,
    )
    return session.url


async def create_portal_session(customer_id: str, return_url: str) -> str:
    session = await asyncio.to_thread(
        stripe.billing_portal.Session.create,
        customer=customer_id,
        return_url=return_url,
    )
    return session.url
