import uuid
from datetime import datetime

from pydantic import AnyHttpUrl, BaseModel, Field


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
    content: str = Field(min_length=1, max_length=10_000)
    media_urls: list[AnyHttpUrl] | None = Field(default=None, max_length=10)


class VoiceTranscribeResponse(BaseModel):
    transcript: str
