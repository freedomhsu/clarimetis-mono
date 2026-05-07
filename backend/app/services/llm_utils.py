"""Shared low-level Gemini helper.

Centralises the repeated pattern used across guardrails, gateway,
crisis_detection, sentiment, evaluation, and gemini services:

    init_vertexai()
    model = GenerativeModel(model_name)
    response = await asyncio.wait_for(
        asyncio.to_thread(model.generate_content, prompt), timeout=N
    )
    return response.text.strip()

Using this helper means each service only needs to own its prompt and
error-handling logic — not the Vertex AI plumbing.
"""

import asyncio

from vertexai.generative_models import GenerativeModel

from app.config import get_settings
from app.services.gcp_credentials import init_vertexai


async def gemini_generate(
    prompt: str,
    *,
    model_name: str | None = None,
    timeout: float = 15.0,
) -> str:
    """Run a single non-streaming Gemini prompt and return the raw response text.

    Args:
        prompt:     Full prompt string to send.
        model_name: Model to use. Defaults to ``gemini_flash_model`` from settings.
        timeout:    Hard timeout in seconds. Raises ``asyncio.TimeoutError`` on expiry.

    The sync SDK call is offloaded to a thread via ``asyncio.to_thread`` so it
    never blocks the event loop.
    """
    init_vertexai()
    model = GenerativeModel(model_name or get_settings().gemini_flash_model)
    response = await asyncio.wait_for(
        asyncio.to_thread(model.generate_content, prompt),
        timeout=timeout,
    )
    return response.text.strip()
