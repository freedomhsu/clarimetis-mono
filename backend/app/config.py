# backend/app/config.py
from functools import lru_cache
from typing import Annotated

from fastapi import Depends
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    database_url: str

    # Google Cloud
    gcp_project_id: str
    gcp_location: str = "us-central1"
    gcs_bucket_name: str
    # Optional: base64-encoded (or raw JSON string) service account key.
    # When set, credentials are built in-process — no key file needed.
    # Leave unset to use gcloud ADC or GOOGLE_APPLICATION_CREDENTIALS file.
    google_application_credentials_json: str = ""

    # Clerk
    clerk_secret_key: str
    clerk_jwt_issuer: str

    # Stripe
    stripe_secret_key: str
    stripe_webhook_secret: str
    stripe_pro_monthly_price_id: str
    stripe_pro_annual_price_id: str

    # Langfuse (optional — leave empty to disable tracing)
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_base_url: str = "https://cloud.langfuse.com"

    # App
    cors_origins: str = "http://localhost:3000"
    frontend_url: str = "http://localhost:3000"

    # Gemini model names — override via env to switch models without code changes
    gemini_flash_model: str = "gemini-2.0-flash"
    gemini_pro_model: str = "gemini-2.5-pro"

    # Feature limits — override via env to tune without code changes
    # How long (seconds) analytics results are cached in-memory per user
    analytics_cache_ttl: int = 3600
    # Maximum number of users tracked by the analytics in-memory TTL cache
    analytics_cache_maxsize: int = 1_000
    # Maximum daily messages for free-tier users
    free_daily_message_limit: int = 5
    # Maximum upload size in bytes (default 50 MB)
    max_upload_bytes: int = 50 * 1024 * 1024
    # Safety banner prepended to streamed responses when a crisis is detected
    # (markdown; override to localise or update the crisis line number)
    crisis_banner_text: str = (
        "I want to make sure you're safe right now. "
        "If you're in crisis, please reach out to the **988 Suicide & Crisis Lifeline** "
        "by calling or texting **988** (US), or chat at https://988lifeline.org. "
        "I'm here with you.\n\n"
    )

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]


@lru_cache
def get_settings() -> "Settings":
    """Return the cached Settings singleton.

    Use ``Depends(get_settings)`` in route handlers.  Override in tests via
    ``app.dependency_overrides[get_settings] = lambda: Settings(...)``.
    """
    return Settings()


# Convenience type alias for FastAPI route handler signatures:
#   async def my_route(settings: SettingsDep) -> ...:
SettingsDep = Annotated[Settings, Depends(get_settings)]
