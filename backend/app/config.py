# backend/app/config.py
from functools import lru_cache
from typing import Annotated

from fastapi import Depends
from pydantic_settings import BaseSettings, SettingsConfigDict

# Dimension of the text-embedding-004 model output.
# This is baked into the DB schema (Vector column + HNSW index) so changing it
# requires a migration. Centralised here so embeddings.py and message.py share
# a single source of truth.
EMBEDDING_DIM: int = 768


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
    # Required for signed URL generation when using user ADC credentials
    # (i.e. `gcloud auth application-default login` on a developer machine).
    # Set to the service account email that the developer can impersonate
    # (needs roles/iam.serviceAccountTokenCreator on that SA).
    # Not needed in production where a service account key is supplied via
    # GOOGLE_APPLICATION_CREDENTIALS_JSON.
    gcs_signing_sa_email: str = ""
    # Document AI processor resource name for PDF text extraction.
    # Format: projects/{project_id}/locations/{location}/processors/{processor_id}
    # Leave empty to skip Document AI and pass PDFs directly to Gemini.
    document_ai_processor_name: str = ""

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

    # Resend — email alerts for unsafe AI output (optional)
    # Leave resend_api_key empty to disable alerts.
    resend_api_key: str = ""
    alert_email_to: str = ""    # who receives the alert
    alert_email_from: str = "alerts@clarimetis.com"  # must be a verified Resend domain

    # App
    cors_origins: str = "http://localhost:3000"
    frontend_url: str = "http://localhost:3000"

    # Gemini model names — override via env to switch models without code changes
    gemini_flash_model: str = "gemini-2.5-flash"
    gemini_pro_model: str = "gemini-2.5-pro"
    # Gemini generation parameters — override via env to tune without code changes
    gemini_temperature: float = 0.7
    gemini_max_output_tokens: int = 8192

    # Feature limits — override via env to tune without code changes
    # How long (seconds) analytics results are cached in-memory per user
    analytics_cache_ttl: int = 3600
    # Maximum number of users tracked by the analytics in-memory TTL cache
    analytics_cache_maxsize: int = 1_000
    # Number of most-recent user messages sent to Gemini for analysis.
    # Raising this produces more accurate results at the cost of a larger prompt.
    analytics_snippet_limit: int = 50
    # Maximum number of score snapshots returned by GET /analytics/history.
    # 90 covers ~30 days even with multiple visits/day before the oldest entries
    # are pruned from the response.
    analytics_history_limit: int = 90
    # Maximum daily messages for free-tier users
    free_daily_message_limit: int = 5
    # Maximum upload size in bytes (default 30 MB).
    # Must not exceed the Next.js proxy serverBodySizeLimit (next.config.ts) so
    # the backend error message is the one the user actually sees.  Cloud Run's
    # own hard cap is 32 MB, so values above ~30 MB are silently truncated.
    max_upload_bytes: int = 30 * 1024 * 1024
    # Maximum total storage per Pro user in bytes (default 500 MB)
    max_pro_storage_bytes: int = 500 * 1024 * 1024

    # Voice settings — override via env to tune without code changes
    # Maximum audio upload size in bytes (default 10 MB — stricter than general uploads)
    max_voice_bytes: int = 10 * 1024 * 1024
    # Google Cloud TTS Neural2 voice name (see cloud.google.com/text-to-speech/docs/voices)
    tts_voice_name: str = "en-US-Neural2-F"
    # BCP-47 language tags for TTS and STT
    tts_language_code: str = "en-US"
    stt_language_code: str = "en-US"
    # TTS speaking rate (0.25 – 4.0; 1.0 = normal speed)
    tts_speaking_rate: float = 0.95
    # TTS pitch adjustment in semitones (−20.0 – 20.0; 0.0 = unchanged)
    tts_pitch: float = 0.0
    # Number of most-recent messages included in voice conversation context
    voice_history_limit: int = 30

    # Chat message history sent to LLM per turn — reduce to cut context-window costs
    chat_history_limit: int = 40

    # Gemini per-call timeouts in seconds
    # Stream timeout must be well under Cloud Run request timeout (300 s).
    gemini_stream_timeout: float = 120.0
    gemini_title_timeout: float = 30.0
    gemini_summary_timeout: float = 20.0
    gemini_analytics_timeout: float = 60.0
    # Number of recent messages included when generating a session summary
    gemini_summary_context_limit: int = 20

    # Crisis detection LLM timeout — fail-closed, so lower = faster safe fallback
    crisis_detection_timeout: float = 30.0

    # Vertex AI text-embedding model name
    embedding_model: str = "text-embedding-004"

    # RAG vector search result limits
    rag_context_limit: int = 5
    rag_tier1_limit: int = 3

    # Signed URL TTL for GCS media links (hours)
    signed_url_ttl_hours: int = 1

    # Clerk JWKS cache TTL (seconds) — refresh before this elapses
    jwks_cache_ttl_seconds: int = 21600   # 6 hours
    # Timeout for fetching Clerk JWKS endpoint (seconds)
    clerk_jwks_fetch_timeout: int = 10

    # DB migration DDL lock-wait timeout
    db_lock_timeout_seconds: int = 5

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
