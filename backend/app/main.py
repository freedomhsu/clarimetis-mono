import logging
import pathlib
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address
from sqlalchemy import text

from app.config import get_settings
from app.database import engine
from app.routers import analytics, chat, media, sessions, stripe_webhooks, users, voice

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s:     %(name)s - %(message)s",
)

logger = logging.getLogger(__name__)

# ── Rate limiter ──────────────────────────────────────────────────────────────
# Limits are per-IP for unauthenticated endpoints and per-IP for all others.
# Individual routers can tighten limits further with @limiter.limit("…").
limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])


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

    async with engine.begin() as conn:
        for sql_path in sql_files:
            sql = sql_path.read_text()
            # Strip line comments and split on semicolons
            lines = [ln for ln in sql.splitlines() if not ln.strip().startswith("--")]
            statements = [s.strip() for s in "\n".join(lines).split(";") if s.strip()]
            for stmt in statements:
                try:
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


app = FastAPI(title="Wellness Coach API", version="0.1.0", lifespan=lifespan)

# Expose the limiter on app.state so @limiter.limit decorators can find it
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
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
        logger.error("Health check failed: %s", exc)
        return JSONResponse(status_code=503, content={"status": "error", "db": "unreachable"})
