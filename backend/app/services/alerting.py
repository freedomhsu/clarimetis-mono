"""Email alerting via Resend.

Sends a plain-text + HTML email when the output guardrail flags a potentially
unsafe AI response.  All calls are fire-and-forget (background task safe).

Alerting is disabled when RESEND_API_KEY or ALERT_EMAIL_TO is not configured —
no error is raised, a debug log is emitted instead.
"""

import asyncio
import logging

logger = logging.getLogger(__name__)


def _build_html(flags: list[str], reason: str, session_id: str, snippet: str) -> str:
    flag_items = "".join(f"<li><code>{f}</code></li>" for f in flags)
    safe_snippet = snippet.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return f"""
<html><body style="font-family:sans-serif;color:#1a1a1a;max-width:640px">
  <h2 style="color:#dc2626">⚠️ Unsafe AI output detected</h2>
  <table style="border-collapse:collapse;width:100%">
    <tr><td style="padding:6px 12px;background:#f3f4f6;font-weight:600;width:140px">Session ID</td>
        <td style="padding:6px 12px">{session_id}</td></tr>
    <tr><td style="padding:6px 12px;background:#f3f4f6;font-weight:600">Flags</td>
        <td style="padding:6px 12px"><ul style="margin:0;padding-left:18px">{flag_items}</ul></td></tr>
    <tr><td style="padding:6px 12px;background:#f3f4f6;font-weight:600">Reason</td>
        <td style="padding:6px 12px">{reason}</td></tr>
  </table>
  <h3 style="margin-top:24px">Response snippet</h3>
  <pre style="background:#f9fafb;border:1px solid #e5e7eb;padding:12px;border-radius:6px;
              white-space:pre-wrap;word-break:break-word;font-size:13px">{safe_snippet}</pre>
  <p style="color:#6b7280;font-size:12px;margin-top:24px">
    Sent by ClariMetis output guardrail · review and take action as needed.
  </p>
</body></html>
"""


async def send_guardrail_alert(
    *,
    flags: list[str],
    reason: str,
    session_id: str,
    response_snippet: str,
) -> None:
    """Send an email alert via Resend.  Silently skipped when not configured."""
    from app.config import get_settings

    cfg = get_settings()
    if not cfg.resend_api_key or not cfg.alert_email_to:
        logger.debug("alerting: resend not configured — skipping guardrail alert")
        return

    try:
        import resend  # type: ignore

        resend.api_key = cfg.resend_api_key

        subject = f"[ClariMetis] Unsafe AI output — {', '.join(flags)}"
        snippet = response_snippet[:1200]  # keep email size reasonable
        html = _build_html(flags, reason, session_id, snippet)
        text = (
            f"Unsafe AI output detected\n\n"
            f"Session : {session_id}\n"
            f"Flags   : {', '.join(flags)}\n"
            f"Reason  : {reason}\n\n"
            f"--- Response snippet ---\n{snippet}\n"
        )

        params: resend.Emails.SendParams = {
            "from": cfg.alert_email_from,
            "to": [cfg.alert_email_to],
            "subject": subject,
            "html": html,
            "text": text,
        }

        # resend.Emails.send() is synchronous — run in a thread to stay async-safe
        await asyncio.to_thread(resend.Emails.send, params)
        logger.info("alerting: guardrail alert sent to %s (flags=%s)", cfg.alert_email_to, flags)

    except Exception as exc:
        # Never let alerting errors bubble up and affect the request lifecycle
        logger.error("alerting: failed to send guardrail alert: %s", exc)
