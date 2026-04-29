"""GCP credential resolution.

Priority order:
1. GOOGLE_APPLICATION_CREDENTIALS_JSON env var — base64-encoded service account JSON.
   Suitable for CI/CD and production (no file on disk).
2. GOOGLE_APPLICATION_CREDENTIALS env var (file path) — set automatically by
   docker-compose when a host path is mounted, or by gcloud ADC.
3. gcloud Application Default Credentials — picked up automatically when the
   developer has run `gcloud auth application-default login`.

Callers should pass the returned credentials object to vertexai.init().
Passing None falls back to google-auth's own discovery chain (ADC / metadata server).
"""

import base64
import json
import logging
import os

logger = logging.getLogger(__name__)

_cached_credentials = None
_resolved = False


def get_gcp_credentials():
    """Return google.oauth2 credentials, or None to let google-auth use ADC."""
    global _cached_credentials, _resolved
    if _resolved:
        return _cached_credentials

    _resolved = True
    raw_json = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON", "").strip()

    if raw_json:
        try:
            from google.oauth2 import service_account  # type: ignore

            # Accept plain JSON string or base64-encoded JSON
            try:
                info = json.loads(raw_json)
            except json.JSONDecodeError:
                info = json.loads(base64.b64decode(raw_json).decode())

            _cached_credentials = service_account.Credentials.from_service_account_info(
                info,
                scopes=["https://www.googleapis.com/auth/cloud-platform"],
            )
            return _cached_credentials
        except Exception as exc:
            logger.warning(
                "Failed to load credentials from GOOGLE_APPLICATION_CREDENTIALS_JSON: %s", exc
            )

    # Fall back to ADC / file path — return None so vertexai.init() uses its default chain
    _cached_credentials = None
    return None


def init_vertexai() -> None:
    """Initialize the VertexAI SDK.

    Called at the start of every Vertex AI request so the SDK re-establishes
    its gRPC transport if the connection went stale (common in Cloud Run when
    an instance idles but is not scaled to zero).  vertexai.init() is
    idempotent and very fast — it just sets config and does not open
    connections — so the cost of calling it on each request is negligible.
    """
    import vertexai  # local import to avoid pulling vertexai into every module

    from app.config import get_settings

    cfg = get_settings()
    vertexai.init(
        project=cfg.gcp_project_id,
        location=cfg.gcp_location,
        credentials=get_gcp_credentials(),
    )
