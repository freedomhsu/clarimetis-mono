"""
Guardrail layer — runs before and after the LLM to enforce scope and safety boundaries.

Input guardrail  : blocks or redirects requests outside the coaching scope.
Output guardrail : runs as a background task to flag problematic AI responses for review.
"""

import json
import logging

from app.services.llm_utils import gemini_generate
from app.services.utils import strip_markdown_json

logger = logging.getLogger(__name__)

# ── Prompts ────────────────────────────────────────────────────────────────────

_INPUT_GUARDRAIL_PROMPT = """You are a scope and safety classifier for an AI life coaching app.
The app helps users with emotional support, personal growth, self-reflection, goal setting,
and navigating life challenges. It is NOT a medical, legal, or financial service.

Classify the user message into one of these categories:

1. "safe" — within coaching scope; proceed normally.
2. "medical_advice" — asking for diagnosis, treatment plans, medication dosage, or clinical
   interpretation of symptoms. Redirect to a healthcare professional.
3. "legal_advice" — asking for legal guidance, contracts, or specific legal strategy.
   Redirect to a lawyer.
4. "financial_advice" — asking for specific investment, tax, or financial planning guidance.
   Redirect to a financial advisor.
5. "harm_to_others" — expressing a SPECIFIC, CREDIBLE, CURRENT intent to physically harm
   another person (e.g. "I have a weapon and I'm going to hurt X tonight").
   Figurative frustration such as "I could kill him", "I want to strangle my boss",
   or "she makes me so angry" MUST be classified as "safe" — these are normal
   emotional expressions, not threats.

Respond with ONLY a JSON object — no markdown, no extra text:
{
  "category": "safe|medical_advice|legal_advice|financial_advice|harm_to_others",
  "confidence": 0.0-1.0,
  "reason": "brief explanation"
}

Be conservative: if the message is ambiguous or could be a normal emotional expression,
classify it as "safe". Only block/redirect when the intent is clearly out of scope."""

_REDIRECT_MESSAGES: dict[str, str] = {
    "medical_advice": (
        "I hear that you're dealing with something health-related, and I want to support you. "
        "As an AI life coach I'm not able to provide medical diagnoses or treatment advice — "
        "that's the domain of a qualified healthcare professional who can properly evaluate you. "
        "What I *can* help with is how you're feeling emotionally about this situation, "
        "or thinking through how to navigate the healthcare system. What would be most helpful right now?"
    ),
    "legal_advice": (
        "It sounds like you're navigating something with legal dimensions. "
        "As an AI life coach I can't give legal advice — for that you'd want to consult a lawyer. "
        "But I can help you think through how you're feeling about the situation, "
        "or what values and priorities matter most to you as you make decisions. "
        "Would that be useful?"
    ),
    "financial_advice": (
        "I can hear there's a financial dimension to what you're working through. "
        "As an AI life coach I'm not the right source for specific investment or financial planning advice — "
        "a certified financial advisor would serve you much better there. "
        "What I can help with is the emotional and decision-making side of this. "
        "What's weighing on you most?"
    ),
    "harm_to_others": (
        "I'm not able to help with that. If you're in a situation where you feel unsafe "
        "or are struggling with difficult emotions, please reach out to a crisis line — "
        "call or text **988** (US Suicide & Crisis Lifeline) or contact local emergency services."
    ),
}

_OUTPUT_GUARDRAIL_PROMPT = """You are a quality and safety reviewer for an AI life coaching app.
Review the AI assistant's response and flag any of the following issues:

1. "clinical_diagnosis" — the response diagnoses the user with a mental health condition
   (e.g. "you have depression", "this sounds like ADHD").
2. "medication_advice" — the response recommends specific medications or dosages.
3. "professional_impersonation" — the response presents itself as a licensed therapist,
   doctor, lawyer, or financial advisor.
4. "harmful_content" — the response contains content that could cause direct harm.

Respond with ONLY a JSON object — no markdown, no extra text:
{
  "flags": ["clinical_diagnosis", ...],
  "safe": true|false,
  "reason": "brief explanation"
}

If no issues are found, return: {"flags": [], "safe": true, "reason": "no issues"}"""


# ── Input guardrail ────────────────────────────────────────────────────────────

async def check_input(message: str) -> dict:
    """
    Check a user message before it reaches the main LLM.

    Returns:
        {
            "safe": bool,
            "category": str,       # "safe" | "medical_advice" | etc.
            "redirect": str | None  # pre-written response to send instead of calling the model
        }
    On any error, fails open (returns safe=True) so coaching is never silently blocked.
    """
    try:
        prompt = f"{_INPUT_GUARDRAIL_PROMPT}\n\nUser message: {message[:2000]}"
        raw = strip_markdown_json(await gemini_generate(prompt, timeout=15.0))
        result = json.loads(raw)

        category = result.get("category", "safe")
        confidence = float(result.get("confidence", 1.0))

        if category == "safe":
            return {"safe": True, "category": "safe", "redirect": None}

        # Confidence thresholds — prevent false positives on ambiguous messages.
        # harm_to_others requires very high confidence (figurative language is common);
        # redirect categories (medical/legal/financial) use a lower threshold.
        min_confidence = 0.90 if category == "harm_to_others" else 0.75
        if confidence < min_confidence:
            logger.info(
                "guardrails.input: low-confidence classification ignored category=%s confidence=%.2f msg=%.80r",
                category, confidence, message,
            )
            return {"safe": True, "category": "safe", "redirect": None}

        redirect = _REDIRECT_MESSAGES.get(category)
        logger.info(
            "guardrails.input: blocked category=%s confidence=%.2f msg=%.80r",
            category, confidence, message,
        )
        return {"safe": False, "category": category, "redirect": redirect}

    except Exception as exc:
        # Fail open: don't block users when the guardrail itself errors.
        # Log the type name explicitly — asyncio.TimeoutError.__str__() is "" so
        # the message alone would be empty and the cause invisible in logs.
        logger.warning(
            "guardrails.input: classifier error — failing open: %s: %s",
            type(exc).__name__, exc,
        )
        return {"safe": True, "category": "safe", "redirect": None}


# ── Output guardrail ───────────────────────────────────────────────────────────

async def check_output(response: str, session_id: str, message_id: str | None = None) -> dict:
    """
    Review an AI response for safety issues. Intended to run as a background task.
    Logs issues for human review — does not modify the already-sent response.

    Returns:
        {"safe": bool, "flags": list[str], "reason": str}
    """
    try:
        prompt = f"{_OUTPUT_GUARDRAIL_PROMPT}\n\nAI response: {response[:4000]}"
        raw = strip_markdown_json(await gemini_generate(prompt, timeout=10.0))
        result = json.loads(raw)

        if not result.get("safe", True):
            logger.warning(
                "guardrails.output: unsafe response detected session_id=%s message_id=%s flags=%s reason=%s",
                session_id,
                message_id,
                result.get("flags"),
                result.get("reason"),
            )
            from app.services.alerting import send_guardrail_alert
            await send_guardrail_alert(
                flags=result.get("flags", []),
                reason=result.get("reason", ""),
                session_id=session_id,
                response_snippet=response,
            )

        return result

    except Exception as exc:
        logger.warning("guardrails.output: reviewer error — skipping: %s", exc)
        return {"safe": True, "flags": [], "reason": "reviewer_error"}
