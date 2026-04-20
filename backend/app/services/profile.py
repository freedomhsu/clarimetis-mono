"""User profile extraction service.

Analyses the user's recent message history and extracts / refreshes the
Tier-2 identity fields:
  - core_values       — inferred values and principles
  - long_term_goals   — stated or implied aspirations
  - recurring_patterns — habitual emotional or behavioural loops
  - identity_facts    — concrete biographical facts (stored in telemetry JSONB)

Also updates the telemetry.sentiment_history rolling window and
recomputes the current stress score.

This runs entirely as a background task — never on the hot path.
A 30-minute cooldown prevents an expensive Gemini call on every message.
"""

import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone

import vertexai
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from vertexai.generative_models import GenerativeModel

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.message import Message
from app.models.session import ChatSession
from app.models.user_profile import UserProfile
from app.services.gcp_credentials import get_gcp_credentials
from app.services.utils import strip_markdown_json

vertexai.init(project=settings.gcp_project_id, location=settings.gcp_location, credentials=get_gcp_credentials())

_PROFILE_PROMPT = """You are a pattern-recognition engine for a wellness coaching app.
Analyse the user messages below and extract four things.

Respond with ONLY a JSON object — no markdown, no extra text:
{
  "core_values": "<2-4 sentence summary of the values this person demonstrates or mentions>",
  "long_term_goals": "<2-4 sentence summary of goals they have stated or implied>",
  "recurring_patterns": "<2-4 sentence summary of recurring emotional or behavioural patterns>",
  "identity_facts": ["<concrete fact 1>", "<concrete fact 2>", ...]
}

identity_facts must be short, specific, biographical facts you can state with confidence.
Examples: "practices jiu-jitsu", "works in software engineering", "has two young children",
"learning to play violin", "recently changed jobs", "training for a marathon".
Include only facts that are clearly stated, not inferred. Return an empty array [] if unsure.

If there is not enough data to infer a text field, set it to null."""

# Maximum number of recent user messages to analyse
_PROFILE_SAMPLE_SIZE = 30

# Maximum length of sentiment history kept in telemetry
_SENTIMENT_WINDOW = 50


async def _extract_profile_fields(messages: list[str]) -> dict:
    """Call Gemini to extract identity fields from a list of user messages."""
    if not messages:
        return {
            "core_values": None,
            "long_term_goals": None,
            "recurring_patterns": None,
            "identity_facts": [],
        }

    model = GenerativeModel("gemini-2.0-flash")
    combined = "\n---\n".join(messages[:_PROFILE_SAMPLE_SIZE])
    prompt = f"{_PROFILE_PROMPT}\n\nUser messages:\n{combined[:12000]}"

    try:
        response = await asyncio.wait_for(
            asyncio.to_thread(model.generate_content, prompt),
            timeout=30.0,
        )
        raw = strip_markdown_json(response.text.strip())
        data = json.loads(raw)
        data.setdefault("identity_facts", [])
        return data
    except Exception:
        return {
            "core_values": None,
            "long_term_goals": None,
            "recurring_patterns": None,
            "identity_facts": [],
        }


async def refresh_user_profile(user_id: uuid.UUID) -> None:
    """Background task: extract / update the UserProfile for a given user.

    Skips the expensive Gemini extraction if the profile was refreshed within
    the last 30 minutes — sentiment history is always updated regardless.
    """
    async with AsyncSessionLocal() as db:
        # Fetch recent user messages across all sessions
        rows = await db.execute(
            select(Message.content, Message.sentiment_score)
            .join(ChatSession, Message.session_id == ChatSession.id)
            .where(ChatSession.user_id == user_id, Message.role == "user")
            .order_by(Message.created_at.desc())
            .limit(_PROFILE_SAMPLE_SIZE)
        )
        rows_list = rows.fetchall()
        if not rows_list:
            return

        messages = [r.content for r in rows_list]
        sentiment_scores = [r.sentiment_score for r in rows_list if r.sentiment_score is not None]

        # Load or create the profile row
        result = await db.execute(
            select(UserProfile).where(UserProfile.user_id == user_id)
        )
        profile = result.scalar_one_or_none()
        if profile is None:
            profile = UserProfile(user_id=user_id)
            db.add(profile)

        # --- 30-minute throttle on the Gemini extraction call ---
        _COOLDOWN = timedelta(minutes=30)
        run_extraction = True
        if profile.updated_at is not None:
            updated_at = profile.updated_at
            if updated_at.tzinfo is None:
                updated_at = updated_at.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) - updated_at < _COOLDOWN:
                run_extraction = False

        if run_extraction:
            fields = await _extract_profile_fields(messages)

            # Overwrite only when the new extraction returns a non-null value
            profile.core_values = fields.get("core_values") or profile.core_values
            profile.long_term_goals = fields.get("long_term_goals") or profile.long_term_goals
            profile.recurring_patterns = fields.get("recurring_patterns") or profile.recurring_patterns

            # Merge identity_facts — deduplicated, lowercase, preserving order
            new_facts: list[str] = [f.strip().lower() for f in (fields.get("identity_facts") or []) if f.strip()]
            telemetry = profile.telemetry or {}
            existing_facts: list[str] = telemetry.get("identity_facts", [])
            merged_facts = existing_facts + [f for f in new_facts if f not in existing_facts]
            # Cap at 50 facts to avoid unbounded growth
            profile.telemetry = {**(profile.telemetry or {}), "identity_facts": merged_facts[:50]}

        # --- Always update rolling sentiment history ---
        telemetry = profile.telemetry or {}
        history: list[float] = telemetry.get("sentiment_history", [])
        history = (sentiment_scores + history)[:_SENTIMENT_WINDOW]
        avg_sentiment = sum(history) / len(history) if history else 0.0
        # Stress proxy: invert normalised average sentiment into [0, 100]
        stress_score = round((1.0 - (avg_sentiment + 1.0) / 2.0) * 100, 1)
        profile.telemetry = {
            **profile.telemetry,
            "sentiment_history": history,
            "avg_sentiment": round(avg_sentiment, 3),
            "stress_score": stress_score,
        }

        await db.commit()
