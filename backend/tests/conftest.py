"""Shared fixtures for the backend test suite.

All tests run without a real database or external services.
The SQLAlchemy AsyncSession and all GCP/Stripe/Clerk calls are mocked.
"""

import os
import sys
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

# ── Override DATABASE_URL to SQLite before any app code is imported ────────
# app/database.py creates the SQLAlchemy engine at import time using the URL
# from settings (which reads .env).  Using a real PostgreSQL URL causes asyncpg
# to open a connection pool whose cleanup races with the test event loop.
# Pointing to SQLite in-memory avoids any real network connections in tests.
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")

# ── Stub heavy GCP/cloud modules before any app code is imported ───────────
# These modules call vertexai.init() and connect to GCP at import time.
# Stubbing them here lets us import the FastAPI app without credentials.
_STUB_MODULES = [
    "google",
    "google.auth",
    "google.auth.credentials",
    "google.auth.transport",
    "google.auth.transport.requests",
    "google.oauth2",
    "google.oauth2.service_account",
    "google.cloud",
    "google.cloud.aiplatform",
    "google.cloud.documentai",
    "google.cloud.speech",
    "google.cloud.storage",
    "google.cloud.texttospeech",
    "vertexai",
    "vertexai.generative_models",
    "vertexai.language_models",
    "langfuse",
]
for _mod in _STUB_MODULES:
    sys.modules.setdefault(_mod, MagicMock())

# langfuse.decorators needs observe to be a pass-through so that decorated
# functions (e.g. stream_chat_response) remain callable async generators in tests.
_langfuse_decorators_stub = MagicMock()


def _passthrough_observe(name=None, **kwargs):
    def decorator(fn):
        return fn
    return decorator


_langfuse_decorators_stub.observe = _passthrough_observe
sys.modules.setdefault("langfuse.decorators", _langfuse_decorators_stub)

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from unittest.mock import patch

from app.database import get_db
from app.main import app as _app
from app.middleware.auth import get_current_user_id
from app.models.message import Message
from app.models.session import ChatSession


# ── Patch AsyncSessionLocal globally so background tasks don't hit real DB ──
# Background tasks (e.g. _save_assistant_message) create their own DB sessions
# via AsyncSessionLocal instead of using the injected `get_db`.  Without this
# patch they would connect to the real PostgreSQL during tests.

def _make_async_session_mock():
    """Return a fresh async context-manager mock for AsyncSessionLocal."""
    session = AsyncMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    session.delete = AsyncMock()
    session.rollback = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    result.scalars.return_value.all.return_value = []
    session.execute = AsyncMock(return_value=result)

    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=session)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


_async_session_patcher = patch(
    "app.routers.chat.AsyncSessionLocal",
    side_effect=_make_async_session_mock,
)
_async_session_patcher.start()

_profile_session_patcher = patch(
    "app.services.profile.AsyncSessionLocal",
    side_effect=_make_async_session_mock,
)
_profile_session_patcher.start()

_evaluation_session_patcher = patch(
    "app.services.evaluation.AsyncSessionLocal",
    side_effect=_make_async_session_mock,
)
_evaluation_session_patcher.start()

from app.models.user import User


# ── Model factories ────────────────────────────────────────────────────────

def make_user(
    *,
    clerk_user_id: str = "user_test",
    email: str = "test@example.com",
    subscription_tier: str = "free",
    stripe_customer_id: str | None = "cus_test",
    stripe_subscription_id: str | None = None,
    storage_used_bytes: int = 0,
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
        storage_used_bytes=storage_used_bytes,
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
        created_at=datetime.now(timezone.utc),
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


# ── Ensure pytest exits cleanly after the test session ────────────────────
# Background threads (asyncio default executor, aiosqlite, SQLAlchemy pool)
# can keep the Python process alive after all tests finish.  os._exit() forces
# an immediate exit with the correct code so CI steps don't hang indefinitely.
# ── Ensure pytest exits cleanly after the test session ────────────────────
# Background threads (asyncio default executor, aiosqlite, SQLAlchemy pool)
# can keep the Python process alive after all tests finish.
# Monkey-patching Thread.__init__ to default daemon=True makes every thread
# spawned during the test run a daemon thread, so Python does not wait for
# them when the main thread exits.  This is safe in a test-only process.
import threading as _threading
_orig_thread_init = _threading.Thread.__init__


def _daemon_thread_init(self, *args, **kwargs):
    kwargs.setdefault("daemon", True)
    _orig_thread_init(self, *args, **kwargs)


_threading.Thread.__init__ = _daemon_thread_init  # type: ignore[method-assign]
