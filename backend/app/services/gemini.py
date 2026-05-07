import asyncio
import json
import logging
import re
import threading
from collections.abc import AsyncGenerator

from tenacity import AsyncRetrying, before_sleep_log, retry_if_exception, stop_after_attempt, wait_exponential
from vertexai.generative_models import Content, GenerationConfig, GenerativeModel, Part

from app.config import get_settings
from app.services.gateway import SYSTEM_PROMPTS, INTENT_WELLNESS_COACH
from app.services.gcp_credentials import init_vertexai
from app.services.llm_utils import gemini_generate
from app.services.utils import strip_markdown_json

logger = logging.getLogger(__name__)

# Sentinel used by the streaming queue — module-level so it is not recreated
# on every stream_chat_response call.
_SENTINEL = object()


def _is_transient_gemini_error(exc: BaseException) -> bool:
    """Return True for errors worth retrying (503, 429, transient gRPC failures)."""
    if isinstance(exc, asyncio.TimeoutError):
        return False
    name = type(exc).__name__
    msg = str(exc).lower()
    return (
        name in {"ServiceUnavailable", "ResourceExhausted", "DeadlineExceeded", "InternalServerError"}
        or "503" in msg
        or "429" in msg
        or "temporarily unavailable" in msg
        or "quota exceeded" in msg
    )


_GEMINI_RETRY: dict = dict(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception(_is_transient_gemini_error),
    before_sleep=before_sleep_log(logger, logging.WARNING),
    reraise=True,
)

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

# Trusted GCS hostname — used to convert legacy signed HTTPS URLs to gs:// URIs.
_GCS_HTTPS_RE = re.compile(
    r"https://storage\.googleapis\.com/(?P<bucket>[^/?]+)/(?P<blob>[^?]+)"
)


@observe(name="stream_chat_response")
async def stream_chat_response(
    user_message: str,
    conversation_history: list[dict],
    rag_context: list[str],
    tier1_context: list[str] | None = None,
    media_urls: list[str] | None = None,
    system_prompt: str | None = None,
    profile_context: str | None = None,
    model_name: str | None = None,
) -> AsyncGenerator[str, None]:
    init_vertexai()
    logger.info("[Langfuse] trace: stream_chat_response started")
    effective_prompt = system_prompt or _DEFAULT_SYSTEM_PROMPT
    resolved_model = model_name or get_settings().gemini_pro_model
    model = GenerativeModel(resolved_model, system_instruction=effective_prompt)

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

    # Attach media — use Document AI sidecar text for PDFs (accurate OCR),
    # gs:// URI for other blob paths, or inline bytes for legacy HTTPS URLs.
    if media_urls:
        bucket = get_settings().gcs_bucket_name
        for url in media_urls:
            # Strip query string for extension detection (signed URLs have long params)
            lower = url.lower().split("?")[0]
            if lower.endswith(".pdf"):
                mime = "application/pdf"
            elif lower.endswith(".png"):
                mime = "image/png"
            elif lower.endswith(".gif"):
                mime = "image/gif"
            elif lower.endswith(".webp"):
                mime = "image/webp"
            elif lower.endswith(".mp4"):
                mime = "video/mp4"
            elif lower.endswith(".webm"):
                mime = "video/webm"
            elif lower.endswith((".mov", ".qt")):
                mime = "video/quicktime"
            else:
                mime = "image/jpeg"

            try:
                if url.startswith("uploads/"):
                    # Blob path — check for a Document AI sidecar first.
                    # Sidecar exists for PDFs and for images that contained
                    # enough printed text (e.g. a photo of a lab report).
                    # When present, the extracted text is more accurate than
                    # Gemini's native parsing for numbers and medical values.
                    from app.services.storage import download_text_sidecar
                    sidecar_text = await download_text_sidecar(url)
                    if sidecar_text:
                        parts.append(Part.from_text(
                            f"[Extracted document text — use this as the authoritative "
                            f"source for all numbers, values, and facts in the document]\n\n"
                            f"{sidecar_text}"
                        ))
                        logger.debug("Using Document AI sidecar for %s", url)
                    else:
                        # No sidecar — pass directly to Gemini (images, videos,
                        # and PDFs without a processor configured).
                        parts.append(Part.from_uri(uri=f"gs://{bucket}/{url}", mime_type=mime))
                else:
                    # Legacy signed HTTPS URL.
                    # Convert trusted GCS URLs to gs:// so Vertex accesses the
                    # file directly — avoids fetching arbitrary bytes into memory
                    # (SSRF mitigation).  Non-GCS HTTPS URLs are rejected.
                    m = _GCS_HTTPS_RE.match(url.split("?")[0])
                    if m:
                        parts.append(
                            Part.from_uri(
                                uri=f"gs://{m.group('bucket')}/{m.group('blob')}",
                                mime_type=mime,
                            )
                        )
                    else:
                        logger.warning(
                            "Skipping non-GCS HTTPS media URL (SSRF prevention): %.100s", url
                        )
            except Exception as exc:
                logger.warning("Failed to attach media %s: %s", url, exc)

    # Limit history to last 20 turns to manage context window
    gemini_history = []
    for msg in conversation_history[-20:]:
        role = "user" if msg["role"] == "user" else "model"
        gemini_history.append(Content(role=role, parts=[Part.from_text(msg["content"])]))

    chat = model.start_chat(history=gemini_history, response_validation=False)

    try:
        settings = get_settings()
        gen_config = GenerationConfig(temperature=settings.gemini_temperature, max_output_tokens=settings.gemini_max_output_tokens)

        # Stream chunks to the caller in real-time via a queue so the client
        # starts receiving bytes immediately instead of waiting for the full
        # response.  The blocking SDK iterator runs in a thread; each chunk is
        # put onto the queue and yielded by the async side as it arrives.
        # _SENTINEL (module-level) signals end-of-stream.

        async def _stream_via_queue() -> AsyncGenerator[str, None]:
            queue: asyncio.Queue = asyncio.Queue()
            loop = asyncio.get_running_loop()

            def _producer() -> None:
                try:
                    for chunk in chat.send_message(
                        parts, generation_config=gen_config, stream=True
                    ):
                        if chunk.text:
                            loop.call_soon_threadsafe(queue.put_nowait, chunk.text)
                except Exception as exc:
                    try:
                        loop.call_soon_threadsafe(queue.put_nowait, exc)
                    except RuntimeError:
                        pass
                finally:
                    try:
                        loop.call_soon_threadsafe(queue.put_nowait, _SENTINEL)
                    except RuntimeError:
                        pass

            threading.Thread(target=_producer, daemon=True, name="gemini-stream").start()
            while True:
                item = await asyncio.wait_for(queue.get(), timeout=get_settings().gemini_stream_timeout)
                if item is _SENTINEL:
                    break
                if isinstance(item, Exception):
                    raise item
                yield item

        async for attempt in AsyncRetrying(**_GEMINI_RETRY):
            with attempt:
                async for chunk in _stream_via_queue():
                    yield chunk
        logger.info("[Langfuse] trace: stream_chat_response completed")
    except asyncio.TimeoutError:
        logger.error("stream_chat_response: Gemini call timed out after %ss", get_settings().gemini_stream_timeout)
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
    logger.info("[Langfuse] trace: generate_session_title started")
    prompt = (
        "Generate a concise 4-6 word title for a wellness coaching session that begins with "
        f"this message. Return only the title, no quotes or punctuation:\n\n{first_message[:500]}"
    )
    try:
        title = ""
        async for attempt in AsyncRetrying(**_GEMINI_RETRY):
            with attempt:
                title = await gemini_generate(prompt, timeout=get_settings().gemini_title_timeout)
        result = title.strip()[:100]
        logger.info("[Langfuse] trace: generate_session_title completed -> %r", result)
        return result
    except Exception as exc:
        logger.warning("[Langfuse] trace: generate_session_title failed (%s: %s), using fallback", type(exc).__name__, exc)
        words = first_message.split()
        return " ".join(words[:6])[:100] if words else "New Session"


@observe(name="generate_session_summary")
async def generate_session_summary(messages: list[dict]) -> str:
    """Produce a 1-2 sentence summary of a session for storage and future RAG context."""
    history_text = "\n".join(
        f"{m['role'].upper()}: {m['content'][:300]}"
        for m in messages[-get_settings().gemini_summary_context_limit:]
    )
    prompt = (
        "Summarize this wellness coaching conversation in 1-2 concise sentences. "
        "Focus on the main topic discussed and any key insight or breakthrough. "
        "Return only the summary, no preamble:\n\n" + history_text
    )
    try:
        summary = ""
        async for attempt in AsyncRetrying(**_GEMINI_RETRY):
            with attempt:
                summary = await gemini_generate(prompt, timeout=get_settings().gemini_summary_timeout)
        return summary.strip()[:500]
    except Exception as exc:
        logger.warning("generate_session_summary failed (%s)", type(exc).__name__)
        return ""


@observe(name="generate_analytics")
async def generate_analytics(conversation_snippets: list[str], language: str = "en") -> dict:
    init_vertexai()
    logger.info("[Langfuse] trace: generate_analytics started (snippets=%d)", len(conversation_snippets))
    model = GenerativeModel(get_settings().gemini_pro_model)
    # The caller already applies .limit(settings.analytics_snippet_limit) to
    # the DB query, so conversation_snippets is already capped.  Do NOT add a
    # second hardcoded slice here — it would silently override the config value.
    content = "\n---\n".join(conversation_snippets)

    # Language-specific response instruction injected at the top of the prompt.
    # JSON keys must stay in English for Pydantic parsing; only human-readable
    # text values should be in the user's language.
    _LANGUAGE_NAMES: dict[str, str] = {
        "en": "English",
        "es": "Spanish (Español)",
        "pt": "Portuguese (Português)",
        "fr": "French (Français)",
        "it": "Italian (Italiano)",
        "zh-TW": "Traditional Chinese (繁體中文)",
        "ja": "Japanese (日本語)",
        "ko": "Korean (한국어)",
    }
    language_name = _LANGUAGE_NAMES.get(language, "English")
    language_instruction = (
        ""
        if language == "en"
        else (
            f"LANGUAGE INSTRUCTION: Write ALL human-readable text values in {language_name}. "
            "This includes: observation, title, description, why, reason, action, evidence, "
            "suggested_action, fix_type, focus_areas items, and the 'reason' field in priority_stack. "
            "JSON keys must remain exactly as shown in English.\n\n"
        )
    )

    prompt = f"""{language_instruction}You are ClariMetis, a systems-thinking intelligence engine performing a deep diagnostic on a user's psychological operating system based on their coaching session messages.

User messages (most recent first):
{content}

Return ONLY a valid JSON object with this exact structure (no markdown, no code fences):
{{
  "data_reliability": "<insufficient|low|moderate|high — use 'insufficient' if fewer than 5 messages or topics are too narrow to assess; 'low' for 5-15 messages; 'moderate' for 15-30; 'high' for 30+>",
  "confidence_score": <integer 0-100 OR null if data_reliability is 'insufficient'. Score based on: self-efficacy language, approach vs avoidance patterns, decisiveness. 50 = neutral.>,
  "anxiety_score": <integer 0-100 OR null if data_reliability is 'insufficient'. Score based on: worry language, catastrophising, avoidance, physical stress signals. 0 = no anxiety.>,
  "self_esteem_score": <integer 0-100 OR null if data_reliability is 'insufficient'. Score based on: self-worth language, how user describes themselves, internal vs external validation seeking. 50 = neutral.>,
  "stress_load": <integer 0-100 OR null if data_reliability is 'insufficient'. Overall cognitive/emotional load.>,
  "ego_score": <integer 0-100 OR null if data_reliability is 'insufficient'. Score based on: identity stability, defensiveness, grandiosity vs humility, reaction to criticism. 50 = neutral. High (70+) = rigid/defensive/grandiose; Low (30-) = identity-fluid, secure, ego-humble.>,
  "emotion_control_score": <integer 0-100 OR null if data_reliability is 'insufficient'. Score based on: emotional regulation language, impulse control, reactivity vs composure. High (70+) = excellent regulation, calm under pressure; Low (30-) = emotionally reactive, easily overwhelmed.>,
  "self_awareness_score": <integer 0-100 OR null if data_reliability is 'insufficient'. Score based on: metacognitive language ("I notice I tend to...", "I realise that..."), ability to name emotions accurately, recognition of own patterns and triggers, openness to feedback. High (70+) = strong self-insight; Low (30-) = blind spots, externalising, pattern repetition without awareness.>,
  "motivation_score": <integer 0-100 OR null if data_reliability is 'insufficient'. Score based on: goal-setting language, intrinsic drive indicators ("I want to", "I'm excited about"), action-taking vs stagnation, sense of purpose and progress. High (70+) = driven, energised, purposeful; Low (30-) = stuck, unmotivated, passive.>,
  "cognitive_noise": "<low|moderate|high> or null if data_reliability is 'insufficient'",
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
- ego_score: high (bad) = defensiveness, "I'm always right", inability to accept criticism, grandiosity; low (good) = openness, humility, secure identity not dependent on being right
- emotion_control_score: high (good) = composure, "I chose to respond calmly", reflecting before reacting; low (bad) = "I snapped", "I couldn't help it", emotional outbursts, rumination
- self_awareness_score: high (good) = "I notice I...", recognising own patterns, naming emotions precisely, welcoming feedback; low (bad) = blaming externals, repeating patterns without recognition, difficulty naming feelings
- motivation_score: high (good) = clear goals, "I want to", "I decided to start", forward momentum; low (bad) = "I don't know what I want", persistent stagnation, passive language, loss of purpose
- priority_stack: Regulation ranks above Growth when stress_load > 70
- Aim for 3-5 insights, 3-5 recommendations, 2-4 priority items
- Tone: direct, diagnostic, systems-aware — not therapeutic or clinical"""

    try:
        async for attempt in AsyncRetrying(**_GEMINI_RETRY):
            with attempt:
                response = await asyncio.wait_for(
                    asyncio.to_thread(model.generate_content, prompt),
                    timeout=get_settings().gemini_analytics_timeout,
                )
        raw = strip_markdown_json(response.text.strip())
        data = json.loads(raw)
        # Ensure all fields have defaults if model omitted them
        data.setdefault("data_reliability", "low")
        data.setdefault("confidence_score", None)
        data.setdefault("anxiety_score", None)
        data.setdefault("self_esteem_score", None)
        data.setdefault("ego_score", None)
        data.setdefault("emotion_control_score", None)
        data.setdefault("self_awareness_score", None)
        data.setdefault("motivation_score", None)
        data.setdefault("stress_load", None)
        data.setdefault("cognitive_noise", None)
        data.setdefault("logic_loops", [])
        # backward compat: if model returned old primary_loop field, migrate it
        if "primary_loop" in data and data["primary_loop"] and not data["logic_loops"]:
            data["logic_loops"] = [data["primary_loop"]]
        data.pop("primary_loop", None)
        # These three are required fields in AnalyticsSummary. The model
        # occasionally omits them when data_reliability is low — guard here so
        # Pydantic serialisation never raises ValidationError.
        data.setdefault("insights", [])
        data.setdefault("recommendations", [])
        data.setdefault("focus_areas", [])
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
            "ego_score": None, "emotion_control_score": None,
            "self_awareness_score": None, "motivation_score": None,
            "stress_load": None, "cognitive_noise": None, "logic_loops": [],
            "relational_observations": [], "social_gratitude_index": None, "priority_stack": [],
        }
