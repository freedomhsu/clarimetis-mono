import asyncio

import vertexai
from vertexai.language_models import TextEmbeddingModel

from app.services.gcp_credentials import init_vertexai

_model: TextEmbeddingModel | None = None


def _get_model() -> TextEmbeddingModel:
    global _model
    if _model is None:
        init_vertexai()
        _model = TextEmbeddingModel.from_pretrained("text-embedding-004")
    return _model


async def embed_text(text: str) -> list[float]:
    model = _get_model()
    # TextEmbeddingModel.get_embeddings is synchronous; run in threadpool for async compat
    embeddings = await asyncio.to_thread(model.get_embeddings, [text[:8000]])
    return embeddings[0].values
