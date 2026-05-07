import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field, field_validator, model_validator


class SessionCreate(BaseModel):
    title: str = Field(default="New Session", max_length=200)


class SessionRename(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class SessionOut(BaseModel):
    id: uuid.UUID
    title: str
    summary: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MessageOut(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    role: str
    content: str
    media_urls: list[str] | None
    crisis_flagged: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatRequest(BaseModel):
    # content is optional when media_urls are provided (e.g. "analyse this image").
    # The model_validator below enforces that at least one of the two is non-empty.
    content: str = Field(default="", max_length=10_000)
    # Accepts either GCS blob paths ("uploads/...") or HTTPS URLs.
    # Previously validated as AnyHttpUrl, which rejected blob paths after we
    # switched the frontend to send blob paths instead of signed URLs.
    media_urls: list[str] | None = Field(default=None, max_length=10)

    @model_validator(mode="after")
    def require_content_or_media(self) -> "ChatRequest":
        if not self.content.strip() and not self.media_urls:
            raise ValueError("Either content or media_urls must be provided")
        return self

    @field_validator("media_urls", mode="before")
    @classmethod
    def validate_media_urls(cls, v: list | None) -> list[str] | None:
        if v is None:
            return None
        validated: list[str] = []
        for item in v:
            if not isinstance(item, str):
                raise ValueError(f"media_urls entries must be strings, got {type(item)}")
            s = item.strip()
            if not s:
                raise ValueError("media_urls entries must not be empty")
            # Accept GCS blob paths or HTTPS URLs — reject everything else
            # to prevent open-redirect / SSRF via attacker-controlled URLs.
            if not (s.startswith("uploads/") or s.startswith("https://")):
                raise ValueError(
                    f"media_urls entries must be GCS blob paths (uploads/...) "
                    f"or HTTPS URLs, got: {s[:80]!r}"
                )
            validated.append(s)
        return validated or None


class VoiceTranscribeResponse(BaseModel):
    transcript: str


class VoiceConversationResponse(BaseModel):
    """Returned by POST /voice/conversation — one full spoken turn."""
    user_transcript: str    # what the user said
    assistant_text: str     # what the AI replied (text)
    # audio_data is a data URI "data:audio/mpeg;base64,..." the browser can play directly
    audio_data: str
    crisis_flagged: bool = False  # true when crisis keywords were detected in the user's message
