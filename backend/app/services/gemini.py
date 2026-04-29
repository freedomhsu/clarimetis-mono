import asyncio
import json
import logging
from collections.abc import AsyncGenerator

import vertexai

logger = logging.getLogger(__name__)
from vertexai.generative_models import Content, GenerationConfig, GenerativeModel, Part

from app.config import get_settings
from app.services.gateway import SYSTEM_PROMPTS, INTENT_WELLNESS_COACH
from app.services.gcp_credentials import init_vertexai
from app.services.utils import strip_markdown_json

# Langfuse tracing — only active when keys are configured.
# The @observe decorator must be defined at module level (before function definitions),
# so we set up Langfuse here but defer vertexai.init() to first actual use.
if get_settings().langfuse_public_key and get_settings().langfuse_secret_key:
    import os
    # Must set env vars BEFORE importing langfuse — its client initialises at import time
    os.environ["LANGFUSE_PUBLIC_KEY"] = get_settings().langfuse_public_key
    os.environ["LANGFUSE_SECRET_KEY"] = get_settings().langfuse_secret_key
    os.environ["LANGFUSE_HOST"] = get_settings().langfuse_base_url
    from langfuse.decorators import langfuse_context, observe
    langfuse_context.configure(
        public_key=get_settings().langfuse_public_key,
        secret_key=get_settings().langfuse_secret_key,
        host=get_settings().langfuse_base_url,
        flush_at=1,
    )
    _tracing_enabled = True
else:
    def observe(name=None, **_kwargs):  # type: ignore[misc]
        def decorator(fn):
            return fn
        return decorator
    _tracing_enabled = False

# Keep the original default prompt accessible as a fallback constant
_DEFAULT_SYSTEM_PROMPT = SYSTEM_PROMPTS[INTENT_WELLNESS_COACH]


@observe(name="stream_chat_response")
async def stream_chat_response(
    user_message: str,
    conversation_history: list[dict],
    rag_context: list[str],
    tier1_context: list[str] | None = None,
    media_urls: list[str] | None = None,
    system_prompt: str | None = None,
    profile_context: str | None = None,
) -> AsyncGenerator[str, None]:
    init_vertexai()
    logger.info("[Langfuse] trace: stream_chat_response started")
    effective_prompt = system_prompt or _DEFAULT_SYSTEM_PROMPT
    model = GenerativeModel(get_settings().gemini_pro_model, system_instruction=effective_prompt)

    prefix_parts: list[str] = []
    if profile_context:
        prefix_parts.append(profile_context)
    if tier1_context:
        prefix_parts.append(
            "[Wellness frameworks & reference — draw on these when relevant, never cite them directly]\n"
            + "\n\n".join(tier1_context)
        )
    if rag_context:
        prefix_parts.append("[Relevant past context]\n" + "\n".join(rag_context))
    context_prefix = "\n\n".join(prefix_parts) + "\n\n" if prefix_parts else ""

    parts = [Part.from_text(context_prefix + user_message)]

    # Limit history to last 20 turns to manage context window
    gemini_history = []
    for msg in conversation_history[-20:]:
        role = "user" if msg["role"] == "user" else "model"
        gemini_history.append(Content(role=role, parts=[Part.from_text(msg["content"])]))

    chat = model.start_chat(history=gemini_history, response_validation=False)

    try:
        # Run the full streaming call + iteration inside a thread so it never
        # blocks the event loop. A 120-second hard timeout covers hung responses.
        settings = get_settings()
        gen_config = GenerationConfig(temperature=settings.gemini_temperature, max_output_tokens=settings.gemini_max_output_tokens)

        def _collect_stream() -> list[str]:
            chunks: list[str] = []
            for chunk in chat.send_message(parts, generation_config=gen_config, stream=True):
                if chunk.text:
                    chunks.append(chunk.text)
            return chunks

        chunks = await asyncio.wait_for(
            asyncio.to_thread(_collect_stream),
            timeout=120.0,
        )
        for chunk in chunks:
            yield chunk
        logger.info("[Langfuse] trace: stream_chat_response completed")
    except asyncio.TimeoutError:
        logger.error("stream_chat_response: Gemini call timed out after 120s")
        yield "I'm sorry, the response took too long. Please try again."
    except Exception as exc:
        logger.error("stream_chat_response: Gemini call failed: %s", exc, exc_info=True)
        yield (
            "I'm sorry, the AI service is not available right now. "
            "Please configure valid GCP credentials to enable responses. "
            f"(Error: {type(exc).__name__})"
        )


@observe(name="generate_session_title")
async def generate_session_title(first_message: str) -> str:
    init_vertexai()
    logger.info("[Langfuse] trace: generate_session_title started")
    try:
        model = GenerativeModel(get_settings().gemini_flash_model)
        prompt = (
            "Generate a concise 4-6 word title for a wellness coaching session that begins with "
            f"this message. Return only the title, no quotes or punctuation:\n\n{first_message[:500]}"
        )
        response = await asyncio.wait_for(
            asyncio.to_thread(model.generate_content, prompt),
            timeout=30.0,
        )
        title = response.text.strip()[:100]
        logger.info("[Langfuse] trace: generate_session_title completed -> %r", title)
        return title
    except Exception as exc:
        logger.warning("[Langfuse] trace: generate_session_title failed (%s: %s), using fallback", type(exc).__name__, exc)
        # Fallback: use first few words of the message
        words = first_message.split()
        return " ".join(words[:6])[:100] if words else "New Session"


@observe(name="generate_session_summary")
async def generate_session_summary(messages: list[dict]) -> str:
    """Produce a 1-2 sentence summary of a session for storage and future RAG context."""
    init_vertexai()
    try:
        model = GenerativeModel(get_settings().gemini_flash_model)
        history_text = "\n".join(
            f"{m['role'].upper()}: {m['content'][:300]}"
            for m in messages[-20:]
        )
        prompt = (
            "Summarize this wellness coaching conversation in 1-2 concise sentences. "
            "Focus on the main topic discussed and any key insight or breakthrough. "
            "Return only the summary, no preamble:\n\n" + history_text
        )
        response = await asyncio.wait_for(
            asyncio.to_thread(model.generate_content, prompt),
            timeout=20.0,
        )
        return response.text.strip()[:500]
    except Exception as exc:
        logger.warning("generate_session_summary failed (%s)", type(exc).__name__)
        return ""


@observe(name="generate_analytics")
async def generate_analytics(conversation_snippets: list[str]) -> dict:
    init_vertexai()
    logger.info("[Langfuse] trace: generate_analytics started (snippets=%d)", len(conversation_snippets))
    model = GenerativeModel(get_settings().gemini_pro_model)
    content = "\n---\n".join(conversation_snippets[:50])

    prompt = f"""You are ClariMetis, a systems-thinking intelligence engine performing a deep diagnostic on a user's psychological operating system based on their coaching session messages.

User messages (most recent first):
{content}

Return ONLY a valid JSON object with this exact structure (no markdown, no code fences):
{{
  "data_reliability": "<insufficient|low|moderate|high — use 'insufficient' if fewer than 5 messages or topics are too narrow to assess; 'low' for 5-15 messages; 'moderate' for 15-30; 'high' for 30+>",
  "confidence_score": <integer 0-100 OR null if data_reliability is 'insufficient'. Score based on: self-efficacy language, approach vs avoidance patterns, decisiveness. 50 = neutral.>,
  "anxiety_score": <integer 0-100 OR null if data_reliability is 'insufficient'. Score based on: worry language, catastrophising, avoidance, physical stress signals. 0 = no anxiety.>,
  "self_esteem_score": <integer 0-100 OR null if data_reliability is 'insufficient'. Score based on: self-worth language, how user describes themselves, internal vs external validation seeking. 50 = neutral.>,
  "stress_load": <integer 0-100 OR null if data_reliability is 'insufficient'. Overall cognitive/emotional load.>,
  "cognitive_noise": "<low|moderate|high>" OR null if data_reliability is 'insufficient'>,
  "logic_loops": [
    {{
      "topic": "<recurring theme, e.g. 'Scarcity/Dating' or 'Career Stagnation'>",
      "frequency": <integer: how many times this theme appears>,
      "efficiency": <integer 0-100: cognitive efficiency on this loop. 100 = resolved/clear, 0 = fully stuck>,
      "fix_type": "<concise intervention, e.g. 'Perspective Shift' or 'Boundary Setting (Relational)'>"
    }}
  ],
  "insights": [
    {{
      "category": "<Stress|Relationships|Growth|Health|Career|Mindset>",
      "observation": "<specific diagnostic finding — reference what the user actually said>",
      "trend": "<stable|improving|declining>"
    }}
  ],
  "recommendations": [
    {{
      "type": "<book|practice|course|strategy>",
      "title": "<concise title>",
      "description": "<1-2 sentence description>",
      "why": "<why this is relevant to this user's specific detected loops>"
    }}
  ],
  "focus_areas": ["<tag>"],
  "relational_observations": [
    {{
      "person": "<relationship type e.g. 'mother', 'manager', 'best friend'>",
      "quality": "<positive quality detected>",
      "evidence": "<brief paraphrase of what the user said>",
      "suggested_action": "<concrete action to leverage or acknowledge this>",
      "relationship_score": <integer 0-100 OR null if insufficient evidence. Score based on warmth, conflict, frequency, reciprocity. 50 = neutral.>
    }}
  ],
  "social_gratitude_index": <integer 0-100 OR null if data_reliability is 'insufficient'>,
  "priority_stack": [
    {{
      "rank": <1-based integer>,
      "category": "<Regulation|Relational|Growth|Career|Health>",
      "action": "<specific actionable item>",
      "reasoning": "<why this is ranked here — reference specific loops or load>",
      "urgency": "<critical|high|medium|low>"
    }}
  ]
}}

Strict rules:
- Set individual scores to null when data_reliability is 'insufficient' — never fabricate scores
- logic_loops: include ALL recurring themes you detect (can be 1-5); empty array [] if none found
- relational_observations: only include when a real named/described person is mentioned; include relationship_score null if only 1-2 mentions
- confidence_score: high = "I can", "I decided", "I did"; low = "I can't", "I don't know how", "I'm afraid to"
- anxiety_score: high = "what if", "I'm worried", "I can't stop thinking"; low = calm, accepting language
- self_esteem_score: high = internal validation, self-acceptance; low = "I'm not good enough", seeking approval
- priority_stack: Regulation ranks above Growth when stress_load > 70
- Aim for 3-5 insights, 3-5 recommendations, 2-4 priority items
- Tone: direct, diagnostic, systems-aware — not therapeutic or clinical"""

    try:
        response = await asyncio.wait_for(
            asyncio.to_thread(model.generate_content, prompt),
            timeout=60.0,
        )
        raw = strip_markdown_json(response.text.strip())
        data = json.loads(raw)
        # Ensure all fields have defaults if model omitted them
        data.setdefault("data_reliability", "low")
        data.setdefault("confidence_score", None)
        data.setdefault("anxiety_score", None)
        data.setdefault("self_esteem_score", None)
        data.setdefault("stress_load", None)
        data.setdefault("cognitive_noise", None)
        data.setdefault("logic_loops", [])
        # backward compat: if model returned old primary_loop field, migrate it
        if "primary_loop" in data and data["primary_loop"] and not data["logic_loops"]:
            data["logic_loops"] = [data["primary_loop"]]
        data.pop("primary_loop", None)
        data.setdefault("relational_observations", [])
        data.setdefault("social_gratitude_index", None)
        data.setdefault("priority_stack", [])
        logger.info("[Langfuse] trace: generate_analytics completed")
        return data
    except Exception as exc:
        logger.warning("[Langfuse] trace: generate_analytics failed (%s: %s)", type(exc).__name__, exc)
        return {
            "insights": [], "recommendations": [], "focus_areas": [],
            "data_reliability": "insufficient",
            "confidence_score": None, "anxiety_score": None, "self_esteem_score": None,
            "stress_load": None, "cognitive_noise": None, "logic_loops": [],
            "relational_observations": [], "social_gratitude_index": None, "priority_stack": [],
        }
