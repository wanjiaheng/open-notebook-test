"""
User and organization management service for Open Notebook API.
"""
from typing import Any, Dict, List, Optional

from loguru import logger

from api.auth import hash_password
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.user import AppUser, Organization


# ────────────────────────────────────────────────────────────
#  User helpers
# ────────────────────────────────────────────────────────────
async def count_users() -> int:
    result = await repo_query("SELECT count() AS cnt FROM app_user GROUP ALL")
    return result[0]["cnt"] if result else 0


async def get_user_by_email(email: str) -> Optional[AppUser]:
    result = await repo_query(
        "SELECT * FROM app_user WHERE email = $email LIMIT 1",
        {"email": email},
    )
    return AppUser(**result[0]) if result else None


async def get_user_by_id(user_id: str) -> Optional[AppUser]:
    try:
        result = await repo_query("SELECT * FROM $id", {"id": ensure_record_id(user_id)})
        return AppUser(**result[0]) if result else None
    except Exception as e:
        logger.error(f"Error fetching user {user_id}: {e}")
        return None


async def list_users(org_id: Optional[str] = None) -> List[AppUser]:
    if org_id:
        result = await repo_query(
            "SELECT * FROM app_user WHERE id IN (SELECT VALUE in FROM member_of WHERE out = $org_id) ORDER BY created ASC",
            {"org_id": ensure_record_id(org_id)},
        )
    else:
        result = await repo_query("SELECT * FROM app_user ORDER BY created ASC")
    return [AppUser(**u) for u in result]


async def create_user(
    username: str,
    email: str,
    password: str,
    org_id: Optional[str] = None,
    role: str = "user",
    status: str = "pending",
) -> AppUser:
    user = AppUser(
        username=username,
        email=email,
        password_hash=hash_password(password),
        role=role,
        status=status,
        org_id=org_id,
    )
    await user.save()
    if org_id:
        await add_user_to_org(str(user.id), org_id, "member")
    # Auto-associate active users with the public org
    if status == "active":
        public_org_id = await get_public_org_id()
        if public_org_id:
            await add_user_to_org(str(user.id), public_org_id, "member")
    return user


async def update_user_status(user_id: str, status: str) -> Optional[AppUser]:
    user = await get_user_by_id(user_id)
    if not user:
        return None
    user.status = status
    await user.save()
    return user


async def update_user_role(user_id: str, role: str) -> Optional[AppUser]:
    user = await get_user_by_id(user_id)
    if not user:
        return None
    user.role = role
    await user.save()
    return user


async def update_user_org(user_id: str, org_id: Optional[str]) -> Optional[AppUser]:
    user = await get_user_by_id(user_id)
    if not user:
        return None
    user.org_id = org_id
    await user.save()
    return user


async def delete_user(user_id: str) -> bool:
    user = await get_user_by_id(user_id)
    if not user:
        return False
    await repo_query(
        "DELETE member_of WHERE in = $uid",
        {"uid": ensure_record_id(user_id)},
    )
    await user.delete()
    return True


# ────────────────────────────────────────────────────────────
#  Organization helpers
# ────────────────────────────────────────────────────────────
PUBLIC_ORG_NAME = "公开"


async def get_public_org_id() -> Optional[str]:
    """Return the public organization ID if it exists. Creates it if missing.
    Also handles renaming legacy '公开组' to '公开' transparently."""
    # Rename legacy name on-the-fly if present
    await repo_query(
        "UPDATE organization SET name = $new WHERE name = $old",
        {"new": PUBLIC_ORG_NAME, "old": "公开组"},
    )
    result = await repo_query(
        "SELECT id FROM organization WHERE name = $name LIMIT 1",
        {"name": PUBLIC_ORG_NAME},
    )
    if result:
        return str(result[0]["id"])
    try:
        await repo_query(
            "CREATE organization CONTENT { name: $name, description: $desc }",
            {"name": PUBLIC_ORG_NAME, "desc": "系统默认公开组，所有用户均可见，不可删除"},
        )
        result = await repo_query(
            "SELECT id FROM organization WHERE name = $name LIMIT 1",
            {"name": PUBLIC_ORG_NAME},
        )
        return str(result[0]["id"]) if result else None
    except Exception as e:
        logger.warning(f"Could not create public org: {e}")
        return None


async def list_organizations() -> List[Organization]:
    result = await repo_query("SELECT * FROM organization ORDER BY name ASC")
    return [Organization(**o) for o in result]


async def get_organization(org_id: str) -> Optional[Organization]:
    try:
        result = await repo_query("SELECT * FROM $id", {"id": ensure_record_id(org_id)})
        return Organization(**result[0]) if result else None
    except Exception as e:
        logger.error(f"Error fetching org {org_id}: {e}")
        return None


async def create_organization(name: str, description: Optional[str] = None) -> Organization:
    org = Organization(name=name, description=description)
    await org.save()
    return org


async def update_organization(
    org_id: str,
    name: Optional[str] = None,
    description: Optional[str] = None,
) -> Optional[Organization]:
    org = await get_organization(org_id)
    if not org:
        return None
    if org.name == PUBLIC_ORG_NAME and name is not None and name != PUBLIC_ORG_NAME:
        raise ValueError(f'"{PUBLIC_ORG_NAME}" 是系统保留组织，名称不可修改')
    if name is not None:
        org.name = name
    if description is not None:
        org.description = description
    await org.save()
    return org


async def delete_organization(org_id: str) -> bool:
    org = await get_organization(org_id)
    if not org:
        return False
    if org.name == PUBLIC_ORG_NAME:
        raise ValueError(f'"{PUBLIC_ORG_NAME}" 是系统保留组织，不可删除')
    await repo_query(
        "DELETE member_of WHERE out = $oid",
        {"oid": ensure_record_id(org_id)},
    )
    await org.delete()
    return True


# ────────────────────────────────────────────────────────────
#  Membership (member_of) helpers
# ────────────────────────────────────────────────────────────
async def get_user_memberships(user_id: str) -> List[Dict[str, Any]]:
    """Return all org memberships for a user with org details."""
    result = await repo_query(
        """
        SELECT out as org_id, out.name as org_name, role
        FROM member_of
        WHERE in = $uid
        ORDER BY out.name ASC
        """,
        {"uid": ensure_record_id(user_id)},
    )
    return [
        {
            "org_id": str(r["org_id"]),
            "org_name": r.get("org_name", ""),
            "role": r.get("role", "member"),
        }
        for r in result
    ]


async def get_org_members(org_id: str) -> List[Dict[str, Any]]:
    """Return all members of an org with their membership role."""
    result = await repo_query(
        """
        SELECT in as user_id, in.username as username, in.email as email,
               in.role as user_role, in.status as status, role as org_role
        FROM member_of
        WHERE out = $oid
        ORDER BY in.username ASC
        """,
        {"oid": ensure_record_id(org_id)},
    )
    return [
        {
            "user_id": str(r["user_id"]),
            "username": r.get("username", ""),
            "email": r.get("email", ""),
            "user_role": r.get("user_role", "user"),
            "status": r.get("status", "pending"),
            "org_role": r.get("org_role", "member"),
        }
        for r in result
    ]


async def add_user_to_org(
    user_id: str, org_id: str, role: str = "member"
) -> bool:
    """Add user to org (idempotent). Returns True on success."""
    try:
        existing = await repo_query(
            "SELECT * FROM member_of WHERE in = $uid AND out = $oid LIMIT 1",
            {"uid": ensure_record_id(user_id), "oid": ensure_record_id(org_id)},
        )
        if existing:
            if existing[0].get("role") != role:
                await repo_query(
                    "UPDATE member_of SET role = $role WHERE in = $uid AND out = $oid",
                    {"uid": ensure_record_id(user_id), "oid": ensure_record_id(org_id), "role": role},
                )
            return True
        await repo_query(
            "CREATE member_of SET in = $uid, out = $oid, role = $role",
            {"uid": ensure_record_id(user_id), "oid": ensure_record_id(org_id), "role": role},
        )
        return True
    except Exception as e:
        logger.error(f"Error adding user {user_id} to org {org_id}: {e}")
        return False


async def remove_user_from_org(user_id: str, org_id: str) -> bool:
    """Remove user from org."""
    try:
        await repo_query(
            "DELETE member_of WHERE in = $uid AND out = $oid",
            {"uid": ensure_record_id(user_id), "oid": ensure_record_id(org_id)},
        )
        return True
    except Exception as e:
        logger.error(f"Error removing user {user_id} from org {org_id}: {e}")
        return False


async def update_membership_role(user_id: str, org_id: str, role: str) -> bool:
    """Update membership role (member / org_admin)."""
    try:
        await repo_query(
            "UPDATE member_of SET role = $role WHERE in = $uid AND out = $oid",
            {"uid": ensure_record_id(user_id), "oid": ensure_record_id(org_id), "role": role},
        )
        return True
    except Exception as e:
        logger.error(f"Error updating membership role: {e}")
        return False


async def get_admin_org_ids(user_id: str) -> List[str]:
    """Get org IDs where user is org_admin."""
    result = await repo_query(
        "SELECT VALUE out FROM member_of WHERE in = $uid AND role = 'org_admin'",
        {"uid": ensure_record_id(user_id)},
    )
    return [str(r) for r in result] if result else []


async def is_org_admin(user_id: str, org_id: str) -> bool:
    """Check if user is org_admin for a specific org."""
    result = await repo_query(
        "SELECT * FROM member_of WHERE in = $uid AND out = $oid AND role = 'org_admin' LIMIT 1",
        {"uid": ensure_record_id(user_id), "oid": ensure_record_id(org_id)},
    )
    return bool(result)
