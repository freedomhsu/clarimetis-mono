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

    # Feature limits — override via env to tune without code changes
    # How long (seconds) analytics results are cached in-memory per user
    analytics_cache_ttl: int = 3600
    # Maximum daily messages for free-tier users
    free_daily_message_limit: int = 5
    # Maximum upload size in bytes (default 50 MB)
    max_upload_bytes: int = 50 * 1024 * 1024

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]


settings = Settings()
