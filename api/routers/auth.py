"""
Authentication router for Open Notebook API.
Provides endpoints to check authentication status.
"""

from fastapi import APIRouter

from open_notebook.utils.encryption import get_secret_from_env
from api.user_service import count_users

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/status")
async def get_auth_status():
    """
    Check if authentication is enabled and which mode is active.
    Returns:
      - auth_enabled: whether a credential is required
      - auth_mode: "jwt" (user accounts) | "password" (legacy) | "none"
      - has_users: whether any app_user records exist
    """
    try:
        user_count = await count_users()
        has_users = user_count > 0
    except Exception:
        has_users = False

    legacy_password = bool(get_secret_from_env("OPEN_NOTEBOOK_PASSWORD"))

    if has_users:
        return {
            "auth_enabled": True,
            "auth_mode": "jwt",
            "has_users": True,
            "message": "JWT authentication is active",
        }
    elif legacy_password:
        return {
            "auth_enabled": True,
            "auth_mode": "password",
            "has_users": False,
            "message": "Legacy password authentication is active",
        }
    else:
        return {
            "auth_enabled": False,
            "auth_mode": "none",
            "has_users": False,
            "message": "Authentication is disabled",
        }