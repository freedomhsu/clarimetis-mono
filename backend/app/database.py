from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

# Pool sizing: Cloud Run defaults to 1 CPU / 512 MB and handles requests
# concurrently via async. A pool of 5 with max_overflow=5 gives 10 total
# connections per instance. With up to 10 instances that is 100 connections —
# within Cloud SQL's default limit of 100 for Postgres.
engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=5,
    pool_timeout=30,
    pool_recycle=1800,  # recycle connections after 30 min to avoid stale sockets
)

AsyncSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
