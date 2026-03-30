"""
Authentication module for Open Notebook API.

Provides JWT-based authentication with fallback to legacy password auth.
Includes middleware, dependencies, and token utilities.
"""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from loguru import logger
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from open_notebook.utils.encryption import get_secret_from_env

# ────────────────────────────────────────────────────────────
#  Constants
# ────────────────────────────────────────────────────────────
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 7

PUBLIC_PATHS = frozenset(
    {
        "/",
        "/health",
        "/docs",
        "/openapi.json",
        "/redoc",
        "/api/auth/status",
        "/api/auth/login",
        "/api/auth/register",
        "/api/config",
        "/api/organizations",  # Needed so new users can see orgs during registration
    }
)


# ────────────────────────────────────────────────────────────
#  Helpers
# ────────────────────────────────────────────────────────────
def get_jwt_secret() -> str:
    secret = (
        get_secret_from_env("JWT_SECRET")
        or get_secret_from_env("OPEN_NOTEBOOK_ENCRYPTION_KEY")
    )
    if not secret:
        return "open-notebook-default-secret-change-in-production"
    return secret


def hash_password(password: str) -> str:
    """Hash a password using PBKDF2-HMAC-SHA256 with a random salt."""
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
    return f"{salt}:{dk.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    """Verify a plaintext password against a stored hash."""
    try:
        salt, dk_hex = password_hash.split(":", 1)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
        return hmac.compare_digest(dk.hex(), dk_hex)
    except Exception:
        return False


def create_access_token(user_data: Dict[str, Any]) -> str:
    """Create a signed JWT access token from user_data payload."""
    payload = {
        **user_data,
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """Decode and validate a JWT token.  Returns None on failure."""
    try:
        return jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


# ────────────────────────────────────────────────────────────
#  Middleware
# ────────────────────────────────────────────────────────────
class JWTAuthMiddleware(BaseHTTPMiddleware):
    """
    JWT-based authentication middleware.

    • Validates JWT Bearer tokens for all protected paths.
    • Falls back to legacy OPEN_NOTEBOOK_PASSWORD if set (backward compat).
    • Skips auth when no password and no users are configured (open mode).
    """

    def __init__(self, app, excluded_paths: Optional[list] = None):
        super().__init__(app)
        self.excluded_paths = set(excluded_paths or []) | PUBLIC_PATHS
        self.legacy_password = get_secret_from_env("OPEN_NOTEBOOK_PASSWORD")

    async def dispatch(self, request: Request, call_next):
        # Always allow public paths & CORS pre-flight
        if request.url.path in self.excluded_paths or request.method == "OPTIONS":
            return await call_next(request)

        auth_header = request.headers.get("Authorization")
        if not auth_header:
            return JSONResponse(
                status_code=401,
                content={"detail": "Missing authorization header"},
                headers={"WWW-Authenticate": "Bearer"},
            )

        try:
            scheme, credentials = auth_header.split(" ", 1)
            if scheme.lower() != "bearer":
                raise ValueError("Bad scheme")
        except ValueError:
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid authorization header format"},
                headers={"WWW-Authenticate": "Bearer"},
            )

        # --- Try JWT first ---
        user_data = decode_access_token(credentials)
        if user_data:
            request.state.user = user_data
            return await call_next(request)

        # --- Legacy password fallback ---
        if self.legacy_password and credentials == self.legacy_password:
            request.state.user = {
                "sub": "legacy",
                "role": "admin",
                "org_id": None,
                "username": "admin",
            }
            return await call_next(request)

        return JSONResponse(
            status_code=401,
            content={"detail": "Invalid or expired token"},
            headers={"WWW-Authenticate": "Bearer"},
        )


# Backward-compat alias
PasswordAuthMiddleware = JWTAuthMiddleware


# ────────────────────────────────────────────────────────────
#  FastAPI dependencies
# ────────────────────────────────────────────────────────────
security = HTTPBearer(auto_error=False)


def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Dict[str, Any]:
    """Dependency: returns the authenticated user dict or raises 401."""
    # Middleware already set this on happy path
    if hasattr(request.state, "user") and request.state.user:
        return request.state.user

    # Direct validation (e.g. tests or if middleware was skipped)
    if credentials:
        user_data = decode_access_token(credentials.credentials)
        if user_data:
            return user_data

        legacy = get_secret_from_env("OPEN_NOTEBOOK_PASSWORD")
        if legacy and credentials.credentials == legacy:
            return {"sub": "legacy", "role": "admin", "org_id": None, "username": "admin"}

    raise HTTPException(
        status_code=401,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_optional_user(request: Request) -> Optional[Dict[str, Any]]:
    """Dependency: returns the user dict or None (no error on missing auth)."""
    return getattr(request.state, "user", None)


def get_admin_user(
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    """Dependency: requires the current user to have role='admin' (super admin)."""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Administrator access required")
    return current_user


def get_any_admin_user(
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    """Dependency: requires super_admin or org_admin (checked at endpoint level)."""
    if current_user.get("role") == "admin":
        return current_user
    admin_org_ids = current_user.get("admin_org_ids", [])
    if admin_org_ids:
        return current_user
    raise HTTPException(status_code=403, detail="Administrator access required")


def check_api_password(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> bool:
    """Legacy compatibility stub – always returns True when middleware passes."""
    return True
