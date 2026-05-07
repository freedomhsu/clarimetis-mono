import asyncio

from vertexai.language_models import TextEmbeddingModel

from app.config import get_settings
from app.services.gcp_credentials import init_vertexai


async def embed_text(text: str) -> list[float]:
    # Re-init on every call so the SDK re-establishes its gRPC transport if the
    # connection went stale (same fix applied to gemini.py and crisis_detection.py).
    # TextEmbeddingModel.from_pretrained() is cheap — it does not open a connection.
    init_vertexai()
    model = TextEmbeddingModel.from_pretrained(get_settings().embedding_model)
    # TextEmbeddingModel.get_embeddings is synchronous; run in threadpool for async compat
    embeddings = await asyncio.to_thread(model.get_embeddings, [text[:8000]])
    return embeddings[0].values
