import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ScoreSnapshot(Base):
    """One row per analytics generation — stores the four psychological scores
    so we can render a time-series chart on the frontend."""

    __tablename__ = "score_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), index=True, nullable=False
    )
    confidence_score: Mapped[int | None] = mapped_column(Integer)
    anxiety_score: Mapped[int | None] = mapped_column(Integer)
    self_esteem_score: Mapped[int | None] = mapped_column(Integer)
    stress_load: Mapped[int | None] = mapped_column(Integer)
    social_gratitude_index: Mapped[int | None] = mapped_column(Integer)
    ego_score: Mapped[int | None] = mapped_column(Integer)
    emotion_control_score: Mapped[int | None] = mapped_column(Integer)
    self_awareness_score: Mapped[int | None] = mapped_column(Integer)
    motivation_score: Mapped[int | None] = mapped_column(Integer)
    data_reliability: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
