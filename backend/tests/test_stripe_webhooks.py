"""Tests for app/routers/stripe_webhooks.py

Covers:
  - Invalid webhook signature → 400
  - customer.subscription.created (active) → tier set to "pro"
  - customer.subscription.created (non-active) → tier set to "free"
  - customer.subscription.updated (active) → tier set to "pro"
  - customer.subscription.updated (cancelled) → tier set to "free"
  - customer.subscription.deleted → tier set to "free", subscription_id cleared
  - Unknown customer → logs warning, still returns {"received": True}
  - Unhandled event type → returns {"received": True} without error
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient

from app.database import get_db
from app.main import app
from app.middleware.auth import get_current_user_id
from tests.conftest import make_user


def _make_stripe_event(event_type: str, obj: dict) -> dict:
    return {"type": event_type, "data": {"object": obj}}


def _sub_obj(
    *,
    customer_id: str = "cus_test",
    sub_id: str = "sub_test",
    status: str = "active",
) -> dict:
    return {"id": sub_id, "customer": customer_id, "status": status}


@pytest.fixture
def mock_db_with_user():
    """DB mock that returns a real User object on execute()."""
    user = make_user(stripe_customer_id="cus_test", subscription_tier="free")
    result = MagicMock()
    result.scalar_one_or_none.return_value = user
    db = AsyncMock()
    db.execute.return_value = result
    db.commit = AsyncMock()
    return db, user


@pytest.fixture
def mock_db_no_user():
    """DB mock that returns None (unknown customer)."""
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    db = AsyncMock()
    db.execute.return_value = result
    db.commit = AsyncMock()
    return db


@pytest.fixture
def webhook_client(mock_db_with_user):
    """AsyncClient with DB overridden to the user-returning mock."""
    db, user = mock_db_with_user
    app.dependency_overrides[get_db] = lambda: db
    return db, user


# ── Signature verification ─────────────────────────────────────────────────

async def test_invalid_signature_returns_400():
    app.dependency_overrides.clear()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("stripe.Webhook.construct_event", side_effect=ValueError("bad sig")):
            resp = await client.post(
                "/api/v1/webhooks/stripe",
                content=b"payload",
                headers={"stripe-signature": "bad"},
            )
    assert resp.status_code == 400
    assert "signature" in resp.json()["detail"].lower()


# ── subscription.created ───────────────────────────────────────────────────

async def test_subscription_created_active_sets_pro(mock_db_with_user):
    db, user = mock_db_with_user
    event = _make_stripe_event("customer.subscription.created", _sub_obj(status="active"))

    app.dependency_overrides[get_db] = lambda: db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            with patch("stripe.Webhook.construct_event", return_value=event):
                resp = await client.post(
                    "/api/v1/webhooks/stripe",
                    content=b"payload",
                    headers={"stripe-signature": "sig"},
                )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    assert resp.json() == {"received": True}
    assert user.subscription_tier == "pro"
    assert user.stripe_subscription_id == "sub_test"
    db.commit.assert_awaited_once()


async def test_subscription_created_inactive_sets_free(mock_db_with_user):
    db, user = mock_db_with_user
    user.subscription_tier = "pro"  # was pro, now going back to free
    event = _make_stripe_event("customer.subscription.created", _sub_obj(status="past_due"))

    app.dependency_overrides[get_db] = lambda: db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            with patch("stripe.Webhook.construct_event", return_value=event):
                resp = await client.post(
                    "/api/v1/webhooks/stripe",
                    content=b"payload",
                    headers={"stripe-signature": "sig"},
                )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    assert user.subscription_tier == "free"


# ── subscription.updated ───────────────────────────────────────────────────

async def test_subscription_updated_active_sets_pro(mock_db_with_user):
    db, user = mock_db_with_user
    event = _make_stripe_event("customer.subscription.updated", _sub_obj(status="active"))

    app.dependency_overrides[get_db] = lambda: db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            with patch("stripe.Webhook.construct_event", return_value=event):
                resp = await client.post(
                    "/api/v1/webhooks/stripe",
                    content=b"payload",
                    headers={"stripe-signature": "sig"},
                )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    assert user.subscription_tier == "pro"
    db.commit.assert_awaited_once()


async def test_subscription_updated_cancelled_sets_free(mock_db_with_user):
    db, user = mock_db_with_user
    user.subscription_tier = "pro"
    event = _make_stripe_event("customer.subscription.updated", _sub_obj(status="canceled"))

    app.dependency_overrides[get_db] = lambda: db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            with patch("stripe.Webhook.construct_event", return_value=event):
                resp = await client.post(
                    "/api/v1/webhooks/stripe",
                    content=b"payload",
                    headers={"stripe-signature": "sig"},
                )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    assert user.subscription_tier == "free"


# ── subscription.deleted ───────────────────────────────────────────────────

async def test_subscription_deleted_sets_free_and_clears_sub_id(mock_db_with_user):
    db, user = mock_db_with_user
    user.subscription_tier = "pro"
    user.stripe_subscription_id = "sub_old"
    event = _make_stripe_event("customer.subscription.deleted", _sub_obj())

    app.dependency_overrides[get_db] = lambda: db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            with patch("stripe.Webhook.construct_event", return_value=event):
                resp = await client.post(
                    "/api/v1/webhooks/stripe",
                    content=b"payload",
                    headers={"stripe-signature": "sig"},
                )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    assert user.subscription_tier == "free"
    assert user.stripe_subscription_id is None
    db.commit.assert_awaited_once()


# ── Unknown customer ───────────────────────────────────────────────────────

async def test_unknown_customer_returns_200_without_error(mock_db_no_user):
    db = mock_db_no_user
    event = _make_stripe_event("customer.subscription.updated", _sub_obj(customer_id="cus_unknown"))

    app.dependency_overrides[get_db] = lambda: db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            with patch("stripe.Webhook.construct_event", return_value=event):
                resp = await client.post(
                    "/api/v1/webhooks/stripe",
                    content=b"payload",
                    headers={"stripe-signature": "sig"},
                )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    assert resp.json() == {"received": True}
    db.commit.assert_not_awaited()


# ── Unhandled event type ───────────────────────────────────────────────────

async def test_unhandled_event_type_returns_200():
    db = AsyncMock()
    event = _make_stripe_event("payment_intent.succeeded", {"id": "pi_test"})

    app.dependency_overrides[get_db] = lambda: db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            with patch("stripe.Webhook.construct_event", return_value=event):
                resp = await client.post(
                    "/api/v1/webhooks/stripe",
                    content=b"payload",
                    headers={"stripe-signature": "sig"},
                )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    assert resp.json() == {"received": True}


# ── checkout.session.completed ─────────────────────────────────────────────

def _checkout_obj(
    *,
    customer_id: str = "cus_test",
    subscription_id: str = "sub_new",
    mode: str = "subscription",
    payment_status: str = "paid",
) -> dict:
    return {
        "customer": customer_id,
        "subscription": subscription_id,
        "mode": mode,
        "payment_status": payment_status,
    }


async def test_checkout_session_completed_sets_pro_and_subscription_id(mock_db_with_user):
    """checkout.session.completed with mode=subscription and payment_status=paid
    must immediately set tier='pro' and store the subscription ID."""
    db, user = mock_db_with_user
    event = _make_stripe_event("checkout.session.completed", _checkout_obj())

    app.dependency_overrides[get_db] = lambda: db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            with patch("stripe.Webhook.construct_event", return_value=event):
                resp = await client.post(
                    "/api/v1/webhooks/stripe",
                    content=b"payload",
                    headers={"stripe-signature": "sig"},
                )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    assert resp.json() == {"received": True}
    assert user.subscription_tier == "pro"
    assert user.stripe_subscription_id == "sub_new"
    db.commit.assert_awaited_once()


async def test_checkout_session_completed_non_subscription_mode_ignored(mock_db_with_user):
    """checkout.session.completed with mode='payment' (one-time) must NOT upgrade the tier."""
    db, user = mock_db_with_user
    event = _make_stripe_event(
        "checkout.session.completed",
        _checkout_obj(mode="payment", payment_status="paid"),
    )

    app.dependency_overrides[get_db] = lambda: db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            with patch("stripe.Webhook.construct_event", return_value=event):
                resp = await client.post(
                    "/api/v1/webhooks/stripe",
                    content=b"payload",
                    headers={"stripe-signature": "sig"},
                )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    # Non-subscription checkout must leave the tier unchanged
    assert user.subscription_tier == "free"
    db.commit.assert_not_awaited()


# ── trialing status ────────────────────────────────────────────────────────

async def test_subscription_created_trialing_sets_pro(mock_db_with_user):
    """subscription.created with status='trialing' must set tier='pro' (trial = full access)."""
    db, user = mock_db_with_user
    event = _make_stripe_event("customer.subscription.created", _sub_obj(status="trialing"))

    app.dependency_overrides[get_db] = lambda: db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            with patch("stripe.Webhook.construct_event", return_value=event):
                resp = await client.post(
                    "/api/v1/webhooks/stripe",
                    content=b"payload",
                    headers={"stripe-signature": "sig"},
                )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    assert user.subscription_tier == "pro"
    db.commit.assert_awaited_once()
