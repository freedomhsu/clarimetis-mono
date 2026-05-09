import json
import logging
import pathlib
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.config import get_settings
from app.database import engine
from app.rate_limit import limiter
from app.routers import analytics, chat, clerk_webhooks, media, sessions, stripe_webhooks, users, voice
from sqlalchemy import text

class _JsonFormatter(logging.Formatter):
    """Formats log records as single-line JSON compatible with Cloud Logging severity."""

    _SEVERITY = {
        "DEBUG": "DEBUG",
        "INFO": "INFO",
        "WARNING": "WARNING",
        "ERROR": "ERROR",
        "CRITICAL": "CRITICAL",
    }

    def format(self, record: logging.LogRecord) -> str:
        payload: dict = {
            "severity": self._SEVERITY.get(record.levelname, record.levelname),
            "message": record.getMessage(),
            "logger": record.name,
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


_json_handler = logging.StreamHandler()
_json_handler.setFormatter(_JsonFormatter())
logging.root.setLevel(logging.INFO)
logging.root.handlers = [_json_handler]

logger = logging.getLogger(__name__)


async def _run_migrations() -> None:
    """Execute all *.sql migration files idempotently on every startup.

    Files are executed in lexicographic filename order (001_init.sql,
    002_user_profiles.sql, …) so that incremental schema changes are always
    applied correctly on a fresh database.
    """
    migrations_dir = pathlib.Path(__file__).parent.parent / "migrations"
    sql_files = sorted(migrations_dir.glob("*.sql"))
    if not sql_files:
        logger.warning("No *.sql migration files found in %s — skipping", migrations_dir)
        return

    # Each statement runs in its own transaction via engine.begin().
    # This isolates failures: a skipped/failed DDL statement (e.g. a trigger that
    # references a function not yet created) only rolls back that single statement
    # and does NOT abort the entire migration run — which was the root cause of
    # sentiment_score and user_profiles columns never being added in production.
    for sql_path in sql_files:
        sql = sql_path.read_text()
        # Strip line comments and split on semicolons
        lines = [ln for ln in sql.splitlines() if not ln.strip().startswith("--")]
        statements = [s.strip() for s in "\n".join(lines).split(";") if s.strip()]
        for stmt in statements:
            try:
                async with engine.begin() as conn:
                    # Fail fast if a DDL lock cannot be acquired (e.g. during a
                    # rolling deploy where the previous revision holds table locks).
                    await conn.execute(text(f"SET lock_timeout = '{get_settings().db_lock_timeout_seconds}s'"))
                    await conn.execute(text(stmt))
            except Exception as exc:
                logger.warning(
                    "Migration stmt skipped (%s) in %s: %.120s",
                    type(exc).__name__,
                    sql_path.name,
                    stmt[:120],
                )
        logger.info("Applied migration: %s", sql_path.name)

    logger.info("Database migrations complete (%d file(s))", len(sql_files))


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await _run_migrations()
    yield


app = FastAPI(title="Life Coach API", version="0.1.0", lifespan=lifespan)

# Expose the limiter on app.state so @limiter.limit decorators can find it
app.state.limiter = limiter


async def _rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """Return a structured 429 so the frontend can render an appropriate banner.

    Daily limits → code="daily_limit_reached" (free-tier message + upgrade CTA).
    Shorter windows (per-minute / per-hour) → code="rate_limit_exceeded" (slow
    down message, no upgrade prompt).
    """
    detail_str = str(exc.detail).lower() if exc.detail else ""
    is_daily = "day" in detail_str
    return JSONResponse(
        status_code=429,
        content={
            "detail": {
                "code": "daily_limit_reached" if is_daily else "rate_limit_exceeded",
                "message": (
                    "You've reached your daily limit. Upgrade to Pro for unlimited access."
                    if is_daily
                    else "You're sending too many requests. Please wait a moment and try again."
                ),
                "upgrade_path": "/pricing",
            }
        },
    )


app.add_exception_handler(RateLimitExceeded, _rate_limit_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users.router, prefix="/api/v1")
app.include_router(sessions.router, prefix="/api/v1")
app.include_router(chat.router, prefix="/api/v1")
app.include_router(media.router, prefix="/api/v1")
app.include_router(voice.router, prefix="/api/v1")
app.include_router(analytics.router, prefix="/api/v1")
app.include_router(stripe_webhooks.router, prefix="/api/v1")
app.include_router(clerk_webhooks.router, prefix="/api/v1")


@app.get("/health")
async def health() -> dict:
    """Liveness + readiness probe.

    Returns 200 only when the database is reachable.  Cloud Run health checks
    will mark the instance as unhealthy and restart it if the DB is down.
    """
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return {"status": "ok", "db": "ok"}
    except Exception as exc:
        logger.error("Health check failed: %s", exc, exc_info=True)
        return JSONResponse(status_code=503, content={"status": "error", "db": "unreachable"})
