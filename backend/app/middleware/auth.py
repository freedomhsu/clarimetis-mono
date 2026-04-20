import asyncio
import json
import time

import httpx
import jwt
from jwt.algorithms import RSAAlgorithm
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings

bearer_scheme = HTTPBearer()

_jwks_cache: dict | None = None
_jwks_fetched_at: float = 0.0
_jwks_lock = asyncio.Lock()
# Refresh JWKS every 6 hours regardless of whether a kid mismatch occurs.
_JWKS_TTL = 6 * 3600


async def _get_jwks(*, force_refresh: bool = False) -> dict:
    global _jwks_cache, _jwks_fetched_at
    now = time.monotonic()
    cache_stale = (now - _jwks_fetched_at) >= _JWKS_TTL
    if _jwks_cache is not None and not force_refresh and not cache_stale:
        return _jwks_cache
    async with _jwks_lock:
        # Double-check inside the lock
        now = time.monotonic()
        cache_stale = (now - _jwks_fetched_at) >= _JWKS_TTL
        if _jwks_cache is not None and not force_refresh and not cache_stale:
            return _jwks_cache
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{settings.clerk_jwt_issuer}/.well-known/jwks.json", timeout=10
            )
            resp.raise_for_status()
            _jwks_cache = resp.json()
            _jwks_fetched_at = time.monotonic()
    return _jwks_cache


async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> str:
    token = credentials.credentials
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
            issuer=settings.clerk_jwt_issuer,
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
