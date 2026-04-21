from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

# Pool sizing: Cloud Run defaults to 1 CPU / 512 MB and handles requests
# concurrently via async. A pool of 5 with max_overflow=5 gives 10 total
# connections per instance. With up to 10 instances that is 100 connections —
# within Cloud SQL's default limit of 100 for Postgres.
# SQLite (used in tests) does not support pool_size / max_overflow.
_db_url = get_settings().database_url
_is_sqlite = _db_url.startswith("sqlite")
engine = create_async_engine(
    _db_url,
    echo=False,
    pool_pre_ping=not _is_sqlite,
    **({} if _is_sqlite else {
        "pool_size": 5,
        "max_overflow": 5,
        "pool_timeout": 30,
        "pool_recycle": 1800,
    }),
)

AsyncSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
