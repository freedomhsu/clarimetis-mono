"""
Shared rate-limiter instance for the whole application.

Key strategy
────────────
Authenticated requests are bucketed by Clerk user ID (extracted from the JWT
payload without signature verification — auth enforcement is done separately by
the route dependencies).  Unauthenticated requests fall back to the remote IP.

Using the user ID means a single abusive account cannot dodge per-user limits
by cycling IPs or VPNs, while IP-based blocking still covers unauthenticated
abuse.
"""

import base64
import json
import logging

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

logger = logging.getLogger(__name__)


def _user_key(request: Request) -> str:
    """Return a rate-limit bucket key for the request.

    Priority:
    1. ``user:<sub>`` — Clerk user ID decoded from the bearer JWT (no sig
       verification; used only for bucketing, not authorization).
    2. Remote IP address as fallback for unauthenticated requests.
    """
    # The Next.js proxy moves the Clerk JWT to X-Forwarded-Authorization;
    # direct calls (local dev) carry it in Authorization.
    forwarded = request.headers.get("x-forwarded-authorization", "")
    if forwarded.lower().startswith("bearer "):
        raw_token = forwarded[7:]
    else:
        auth = request.headers.get("authorization", "")
        raw_token = auth[7:] if auth.lower().startswith("bearer ") else ""

    if raw_token:
        try:
            # JWT structure: <header>.<payload>.<signature>
            # We only need the payload to extract the `sub` claim.
            payload_b64 = raw_token.split(".")[1]
            # Re-pad to a multiple of 4 for base64 decoding
            padding = (4 - len(payload_b64) % 4) % 4
            payload = json.loads(base64.b64decode(payload_b64 + "=" * padding))
            sub = payload.get("sub")
            if sub:
                return f"user:{sub}"
        except Exception:
            # Malformed token — fall through to IP-based key
            pass

    return get_remote_address(request)


# Single limiter instance shared across all routers.
# The default 200/minute applies to every endpoint unless overridden with
# @limiter.limit("…") on the individual route.
limiter = Limiter(key_func=_user_key, default_limits=["200/minute"])
