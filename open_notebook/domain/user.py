"""
User and organization domain models for Open Notebook.
"""
from typing import Any, ClassVar, Dict, Optional

from open_notebook.database.repository import ensure_record_id
from open_notebook.domain.base import ObjectModel


class Organization(ObjectModel):
    """Represents a tenant organization. Data within an org is shared among its members."""

    table_name: ClassVar[str] = "organization"
    name: str
    description: Optional[str] = None


class AppUser(ObjectModel):
    """
    Application user record.

    status: 'pending' (awaiting admin approval) | 'active' | 'suspended'
    role:   'user' | 'admin'
    """

    table_name: ClassVar[str] = "app_user"
    username: str
    email: str
    password_hash: str
    role: str = "user"
    status: str = "pending"
    org_id: Optional[str] = None

    def _prepare_save_data(self) -> Dict[str, Any]:
        data = super()._prepare_save_data()
        val = data.get("org_id")
        if val is not None and isinstance(val, str) and val:
            data["org_id"] = ensure_record_id(val)
        return data

    def to_public(self) -> Dict[str, Any]:
        """Return a safe public representation (no password hash)."""
        return {
            "id": self.id,
            "username": self.username,
            "email": self.email,
            "role": self.role,
            "status": self.status,
            "org_id": str(self.org_id) if self.org_id else None,
            "created": str(self.created) if self.created else None,
            "updated": str(self.updated) if self.updated else None,
        }
