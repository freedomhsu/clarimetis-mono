"""Shared fixtures for the backend test suite.

All tests run without a real database or external services.
The SQLAlchemy AsyncSession and all GCP/Stripe/Clerk calls are mocked.
"""

import sys
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

# ── Stub heavy GCP/cloud modules before any app code is imported ───────────
# These modules call vertexai.init() and connect to GCP at import time.
# Stubbing them here lets us import the FastAPI app without credentials.
_STUB_MODULES = [
    "google",
    "google.auth",
    "google.oauth2",
    "google.oauth2.service_account",
    "google.cloud",
    "google.cloud.aiplatform",
    "google.cloud.speech",
    "google.cloud.storage",
    "google.cloud.texttospeech",
    "vertexai",
    "vertexai.generative_models",
    "vertexai.language_models",
    "langfuse",
    "langfuse.decorators",
]
for _mod in _STUB_MODULES:
    sys.modules.setdefault(_mod, MagicMock())

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.database import get_db
from app.main import app as _app
from app.middleware.auth import get_current_user_id
from app.models.message import Message
from app.models.session import ChatSession
from app.models.user import User


# ── Model factories ────────────────────────────────────────────────────────

def make_user(
    *,
    clerk_user_id: str = "user_test",
    email: str = "test@example.com",
    subscription_tier: str = "free",
    stripe_customer_id: str | None = "cus_test",
    stripe_subscription_id: str | None = None,
) -> User:
    now = datetime.now(timezone.utc)
    return User(
        id=uuid.uuid4(),
        clerk_user_id=clerk_user_id,
        email=email,
        full_name="Test User",
        subscription_tier=subscription_tier,
        stripe_customer_id=stripe_customer_id,
        stripe_subscription_id=stripe_subscription_id,
        created_at=now,
        updated_at=now,
    )


def make_session(user: User, *, title: str = "Test Session") -> ChatSession:
    now = datetime.now(timezone.utc)
    return ChatSession(
        id=uuid.uuid4(),
        user_id=user.id,
        title=title,
        created_at=now,
        updated_at=now,
    )


def make_message(
    session: ChatSession,
    *,
    role: str = "user",
    content: str = "Hello",
    crisis_flagged: bool = False,
) -> Message:
    return Message(
        id=uuid.uuid4(),
        session_id=session.id,
        role=role,
        content=content,
        media_urls=[],
        crisis_flagged=crisis_flagged,
    )


# ── DB session mock helpers ────────────────────────────────────────────────

def db_returning(value) -> AsyncMock:
    """Return an AsyncMock session whose .execute() yields a result with scalar_one_or_none = value."""
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    result.scalars.return_value.all.return_value = [] if value is None else [value]
    mock = AsyncMock()
    mock.execute.return_value = result
    mock.scalar.return_value = None
    mock.commit = AsyncMock()
    mock.refresh = AsyncMock()
    mock.delete = AsyncMock()
    mock.add = MagicMock()
    return mock


# ── HTTP test client fixture ───────────────────────────────────────────────

@pytest_asyncio.fixture
async def client(mock_db):
    """AsyncClient wired to the FastAPI app with auth and DB overridden."""
    _app.dependency_overrides[get_current_user_id] = lambda: "user_test"
    _app.dependency_overrides[get_db] = lambda: mock_db
    async with AsyncClient(
        transport=ASGITransport(app=_app), base_url="http://test"
    ) as c:
        yield c
    _app.dependency_overrides.clear()


@pytest.fixture
def mock_db():
    """Default mock DB — callers should configure .execute.return_value as needed."""
    db = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.delete = AsyncMock()
    db.add = MagicMock()
    db.rollback = AsyncMock()
    return db
