import asyncio
import json
import time

import httpx
import jwt
from jwt.algorithms import RSAAlgorithm
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import get_settings

bearer_scheme = HTTPBearer(auto_error=False)

_jwks_cache: dict | None = None
_jwks_fetched_at: float = 0.0
_jwks_lock = asyncio.Lock()


async def _get_jwks(*, force_refresh: bool = False) -> dict:
    global _jwks_cache, _jwks_fetched_at
    now = time.monotonic()
    cache_stale = (now - _jwks_fetched_at) >= get_settings().jwks_cache_ttl_seconds
    if _jwks_cache is not None and not force_refresh and not cache_stale:
        return _jwks_cache
    async with _jwks_lock:
        # Double-check inside the lock
        now = time.monotonic()
        cache_stale = (now - _jwks_fetched_at) >= get_settings().jwks_cache_ttl_seconds
        if _jwks_cache is not None and not force_refresh and not cache_stale:
            return _jwks_cache
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{get_settings().clerk_jwt_issuer}/.well-known/jwks.json",
                    timeout=get_settings().clerk_jwks_fetch_timeout,
                )
                resp.raise_for_status()
                _jwks_cache = resp.json()
                _jwks_fetched_at = time.monotonic()
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Authentication service temporarily unavailable — please retry",
            ) from exc
    return _jwks_cache


async def get_current_user_id(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    # When requests arrive through the Next.js proxy, the proxy puts the GCP
    # identity token in Authorization (for Cloud Run IAM) and moves the Clerk
    # JWT to X-Forwarded-Authorization. Fall back to Authorization for direct
    # calls (local dev / health checks).
    forwarded = request.headers.get("x-forwarded-authorization", "")
    if forwarded.lower().startswith("bearer "):
        token = forwarded[7:]
    elif credentials:
        token = credentials.credentials
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")

        jwks = await _get_jwks()
        key_data = next((k for k in jwks["keys"] if k["kid"] == kid), None)

        # If key not found, try one forced refresh in case Clerk rotated keys
        if key_data is None:
            jwks = await _get_jwks(force_refresh=True)
            key_data = next((k for k in jwks["keys"] if k["kid"] == kid), None)

        if key_data is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown token key"
            )

        public_key = RSAAlgorithm.from_jwk(json.dumps(key_data))
        payload = jwt.decode(
            token,
            public_key,  # type: ignore[arg-type]
            algorithms=["RS256"],
            issuer=get_settings().clerk_jwt_issuer,
            # 30s leeway absorbs JWKS fetch latency on cold pod starts and minor
            # clock skew between the token issuer (Clerk) and this server.
            leeway=30,
        )
        user_id: str | None = payload.get("sub")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload"
            )
        return user_id
    except HTTPException:
        raise
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token"
        ) from exc
