"""Document AI integration for accurate text extraction from PDFs and images.

Uses Google Cloud Document AI OCR to extract text from uploaded documents
before they are sent to Gemini.  This eliminates number misreading and
hallucination that occurs when Gemini parses documents natively (e.g. blood
work values, dosages on a lab report photographed with a phone).

Supported inputs:
  - PDFs  (application/pdf)
  - Images of printed text: JPEG, PNG, WEBP, GIF, TIFF  (image/*)

Usage:
  text = await extract_document_text(
      "gs://my-bucket/uploads/user_id/uuid_report.pdf", "application/pdf"
  )

Requires:
  - DOCUMENT_AI_PROCESSOR_NAME env var set to the fully-qualified processor
    resource name:  projects/{project}/locations/{location}/processors/{id}
  - The Document AI API enabled in the GCP project.
  - The service account / ADC credentials must have the
    roles/documentai.apiUser role.

When DOCUMENT_AI_PROCESSOR_NAME is empty this module is a no-op and returns
None, so the caller can fall back to native Gemini handling.

For images, OCR results with fewer than MIN_IMAGE_TEXT_CHARS characters are
considered non-document photos (e.g. selfies, food) and None is returned so
Gemini continues to see the raw image rather than a sparse label string.
"""

import asyncio
import logging

from app.config import get_settings
from app.services.gcp_credentials import get_gcp_credentials

logger = logging.getLogger(__name__)

# Images that return fewer characters than this are likely non-document photos.
# Gemini handles those better directly than via sparse OCR text.
MIN_IMAGE_TEXT_CHARS = 100

# MIME types the Document AI OCR processor accepts.
_SUPPORTED_MIME_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/tiff",
    "image/bmp",
}


async def extract_document_text(gcs_uri: str, mime_type: str) -> str | None:
    """Return extracted plain text for a GCS URI, or None if unavailable.

    For image MIME types, returns None when the extracted text is shorter than
    MIN_IMAGE_TEXT_CHARS — indicating a photo rather than a document image.

    Args:
        gcs_uri:   Full GCS URI, e.g. "gs://bucket/uploads/uid/uuid_file.pdf".
        mime_type: Actual MIME type of the file (e.g. "application/pdf",
                   "image/jpeg").

    Returns:
        Extracted text, or None if Document AI is not configured, the MIME
        type is unsupported, or extraction fails.
    """
    if mime_type not in _SUPPORTED_MIME_TYPES:
        return None

    processor_name = get_settings().document_ai_processor_name
    if not processor_name:
        return None

    try:
        text = await asyncio.to_thread(_extract_sync, gcs_uri, mime_type, processor_name)
    except Exception as exc:
        logger.warning("Document AI extraction failed for %s: %s", gcs_uri, exc)
        return None

    if not text:
        return None

    # For images, discard sparse results that are unlikely to be document text.
    is_image = mime_type.startswith("image/")
    if is_image and len(text.strip()) < MIN_IMAGE_TEXT_CHARS:
        logger.debug(
            "Document AI returned %d chars for image %s — too short, skipping sidecar",
            len(text.strip()), gcs_uri,
        )
        return None

    return text


# Backward-compatible alias used by existing callers.
async def extract_pdf_text(gcs_uri: str) -> str | None:
    return await extract_document_text(gcs_uri, "application/pdf")


def _extract_sync(gcs_uri: str, mime_type: str, processor_name: str) -> str:
    """Blocking Document AI call — run inside asyncio.to_thread."""
    from google.api_core.client_options import ClientOptions
    from google.cloud import documentai

    # Derive location from processor name:
    # "projects/.../locations/<location>/processors/..."
    parts = processor_name.split("/")
    location = parts[3] if len(parts) > 3 else "us"

    opts = ClientOptions(api_endpoint=f"{location}-documentai.googleapis.com")
    credentials = get_gcp_credentials()
    client = documentai.DocumentProcessorServiceClient(
        client_options=opts, credentials=credentials
    )

    gcs_document = documentai.GcsDocument(
        gcs_uri=gcs_uri,
        mime_type=mime_type,
    )

    # enable_native_pdf_parsing speeds up text-layer PDFs; not applicable to images.
    ocr_config = documentai.OcrConfig(
        enable_native_pdf_parsing=(mime_type == "application/pdf"),
    )
    request = documentai.ProcessRequest(
        name=processor_name,
        gcs_document=gcs_document,
        process_options=documentai.ProcessOptions(ocr_config=ocr_config),
    )

    result = client.process_document(request=request)
    return result.document.text

