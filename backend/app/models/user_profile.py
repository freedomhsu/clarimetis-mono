import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class UserProfile(Base):
    """Tier-2 longitudinal identity layer.

    Extracted and refreshed as a background task after each session.
    Stores the user's inferred core values, long-term goals, and
    recurring behavioural patterns so they can be injected into the
    system prompt as persistent context.
    """

    __tablename__ = "user_profiles"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )
    # Free-text summaries extracted by Gemini
    core_values: Mapped[str | None] = mapped_column(Text)
    long_term_goals: Mapped[str | None] = mapped_column(Text)
    recurring_patterns: Mapped[str | None] = mapped_column(Text)

    # Telemetry scores — updated incrementally after each message
    # Shape: {"stress": float, "sentiment_history": [float, ...]}
    telemetry: Mapped[dict] = mapped_column(JSONB, default=dict)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User"] = relationship("User", back_populates="profile")
