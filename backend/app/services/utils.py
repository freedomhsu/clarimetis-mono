"""Shared utility functions for backend services."""


def strip_markdown_json(raw: str) -> str:
    """Strip optional ```json ... ``` fencing returned by Gemini.

    Gemini sometimes wraps its JSON output in a markdown code block despite
    being instructed not to. This normalises the response so callers can
    always pass the result directly to json.loads().
    """
    if not raw.startswith("```"):
        return raw
    parts = raw.split("```")
    if len(parts) < 2:
        return raw
    inner = parts[1].strip()
    # Strip optional "json" language tag (case-insensitive)
    if inner.lower().startswith("json"):
        inner = inner[4:].strip()
    return inner
