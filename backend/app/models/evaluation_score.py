import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class EvaluationScore(Base):
    """One row per assistant message — stores evaluation agent rubric scores
    for dashboarding and quality monitoring."""

    __tablename__ = "evaluation_scores"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("chat_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    trace_id: Mapped[str | None] = mapped_column(Text)
    empathy: Mapped[float | None] = mapped_column(Float)
    coaching_quality: Mapped[float | None] = mapped_column(Float)
    safety: Mapped[float | None] = mapped_column(Float)
    actionability: Mapped[float | None] = mapped_column(Float)
    boundary_adherence: Mapped[float | None] = mapped_column(Float)
    overall: Mapped[float | None] = mapped_column(Float)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
