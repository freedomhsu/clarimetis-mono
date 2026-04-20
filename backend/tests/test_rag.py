"""Tests for app/services/rag.py

Covers:
  - get_relevant_context: uses pre-computed embedding, skips embed_text call
  - get_relevant_context: calls embed_text when no embedding is provided
  - get_tier1_context: uses pre-computed embedding, skips embed_text call
  - get_tier1_context: calls embed_text when no embedding is provided
  - get_tier1_context: returns [] gracefully when knowledge_docs table is missing
"""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.rag import get_relevant_context, get_tier1_context


def _make_db(rows=None):
    """AsyncSession mock that returns `rows` from execute().fetchall()."""
    result = MagicMock()
    result.fetchall.return_value = rows or []
    db = AsyncMock()
    db.execute.return_value = result
    db.rollback = AsyncMock()
    return db


FAKE_EMBEDDING = [0.1] * 768


# ── get_relevant_context ───────────────────────────────────────────────────

async def test_get_relevant_context_uses_provided_embedding():
    """When an embedding is passed, embed_text must NOT be called."""
    db = _make_db()

    with patch("app.services.rag.embed_text", new_callable=AsyncMock) as mock_embed:
        await get_relevant_context(db, uuid.uuid4(), "query", embedding=FAKE_EMBEDDING)

    mock_embed.assert_not_called()
    db.execute.assert_awaited_once()


async def test_get_relevant_context_calls_embed_text_when_no_embedding_given():
    """When no embedding is provided, embed_text is called exactly once."""
    db = _make_db()

    with patch("app.services.rag.embed_text", new_callable=AsyncMock, return_value=FAKE_EMBEDDING) as mock_embed:
        await get_relevant_context(db, uuid.uuid4(), "query")

    mock_embed.assert_awaited_once_with("query")


async def test_get_relevant_context_formats_rows_correctly():
    """Returned strings should be 'role: content'."""
    row1 = MagicMock()
    row1.role = "user"
    row1.content = "I feel anxious"

    row2 = MagicMock()
    row2.role = "assistant"
    row2.content = "That's understandable."

    db = _make_db(rows=[row1, row2])

    with patch("app.services.rag.embed_text", new_callable=AsyncMock, return_value=FAKE_EMBEDDING):
        result = await get_relevant_context(db, uuid.uuid4(), "query")

    assert result == ["user: I feel anxious", "assistant: That's understandable."]


async def test_get_relevant_context_returns_empty_list_when_no_rows():
    db = _make_db(rows=[])

    with patch("app.services.rag.embed_text", new_callable=AsyncMock, return_value=FAKE_EMBEDDING):
        result = await get_relevant_context(db, uuid.uuid4(), "query")

    assert result == []


# ── get_tier1_context ──────────────────────────────────────────────────────

async def test_get_tier1_context_uses_provided_embedding():
    """When an embedding is passed, embed_text must NOT be called."""
    db = _make_db()

    with patch("app.services.rag.embed_text", new_callable=AsyncMock) as mock_embed:
        await get_tier1_context(db, "query", embedding=FAKE_EMBEDDING)

    mock_embed.assert_not_called()
    db.execute.assert_awaited_once()


async def test_get_tier1_context_calls_embed_text_when_no_embedding_given():
    db = _make_db()

    with patch("app.services.rag.embed_text", new_callable=AsyncMock, return_value=FAKE_EMBEDDING) as mock_embed:
        await get_tier1_context(db, "query")

    mock_embed.assert_awaited_once_with("query")


async def test_get_tier1_context_formats_rows_correctly():
    row = MagicMock()
    row.category = "cognitive_bias"
    row.title = "Confirmation Bias"
    row.content = "Tendency to search for information that confirms existing beliefs."

    db = _make_db(rows=[row])

    with patch("app.services.rag.embed_text", new_callable=AsyncMock, return_value=FAKE_EMBEDDING):
        result = await get_tier1_context(db, "query")

    assert len(result) == 1
    assert "[cognitive_bias] Confirmation Bias" in result[0]
    assert "Tendency to search" in result[0]


async def test_get_tier1_context_returns_empty_list_when_table_missing():
    """If knowledge_docs doesn't exist yet, swallow the error and return []."""
    db = AsyncMock()
    db.execute.side_effect = Exception("relation 'knowledge_docs' does not exist")
    db.rollback = AsyncMock()

    with patch("app.services.rag.embed_text", new_callable=AsyncMock, return_value=FAKE_EMBEDDING):
        result = await get_tier1_context(db, "query")

    assert result == []
    db.rollback.assert_awaited_once()
