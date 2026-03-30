"""
User management and authentication endpoints.
Handles registration, login, and admin user/organization management.
"""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from loguru import logger
from pydantic import BaseModel

from api.auth import create_access_token, get_admin_user, get_current_user, verify_password
from api.audit_service import AuditAction, ResourceType, write_audit_log
from api.user_service import (
    PUBLIC_ORG_NAME,
    add_user_to_org,
    count_users,
    create_user,
    delete_user,
    get_admin_org_ids,
    get_org_members,
    get_public_org_id,
    get_user_by_email,
    get_user_by_id,
    get_user_memberships,
    get_organization,
    list_organizations,
    list_users,
    remove_user_from_org,
    update_membership_role,
    update_user_org,
    update_user_role,
    update_user_status,
    create_organization,
)

router = APIRouter()


# ────────────────────────────────────────────────────────────
#  Schemas
# ────────────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str
    org_id: Optional[str] = None
    org_name: Optional[str] = None


class LoginRequest(BaseModel):
    email: str
    password: str


class MembershipInfo(BaseModel):
    org_id: str
    org_name: str
    role: str  # "member" | "org_admin"


class UserResponse(BaseModel):
    id: str
    username: str
    email: str
    role: str
    status: str
    org_id: Optional[str] = None
    org_name: Optional[str] = None
    memberships: List[MembershipInfo] = []
    created: Optional[str] = None
    updated: Optional[str] = None


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class UpdateStatusRequest(BaseModel):
    status: str  # "active" | "pending" | "suspended"


class UpdateRoleRequest(BaseModel):
    role: str  # "admin" | "user"


class UpdateOrgRequest(BaseModel):
    org_id: Optional[str] = None


class AdminCreateUserRequest(BaseModel):
    username: str
    email: str
    password: str
    role: str = "user"
    org_id: Optional[str] = None


class AddMembershipRequest(BaseModel):
    org_id: str
    role: str = "member"  # "member" | "org_admin"


class UpdateMembershipRoleRequest(BaseModel):
    role: str  # "member" | "org_admin"


class RemoveMembershipRequest(BaseModel):
    org_id: str


async def _build_user_response(user) -> UserResponse:
    """Build a UserResponse with resolved org_name and memberships."""
    org_name = None
    if user.org_id:
        org = await get_organization(str(user.org_id))
        if org:
            org_name = org.name
    memberships_raw = await get_user_memberships(str(user.id))
    memberships = [
        MembershipInfo(
            org_id=m["org_id"],
            org_name=m["org_name"],
            role=m["role"],
        )
        for m in memberships_raw
    ]
    return UserResponse(
        id=str(user.id),
        username=user.username,
        email=user.email,
        role=user.role,
        status=user.status,
        org_id=str(user.org_id) if user.org_id else None,
        org_name=org_name,
        memberships=memberships,
        created=str(user.created) if user.created else None,
        updated=str(user.updated) if user.updated else None,
    )


async def _get_current_user_role_context(current_user: dict) -> Dict[str, Any]:
    """Determine if current user is super_admin or org_admin, and which orgs they admin."""
    user_id = current_user.get("sub")
    global_role = current_user.get("role", "user")
    is_super_admin = global_role == "admin"
    admin_org_ids: List[str] = []
    if not is_super_admin and user_id and user_id != "legacy":
        admin_org_ids = await get_admin_org_ids(user_id)
    return {
        "user_id": user_id,
        "is_super_admin": is_super_admin,
        "admin_org_ids": admin_org_ids,
        "has_any_admin": is_super_admin or bool(admin_org_ids),
    }


# ────────────────────────────────────────────────────────────
#  Auth endpoints
# ────────────────────────────────────────────────────────────
@router.post("/auth/register", status_code=201)
async def register(req: RegisterRequest):
    try:
        existing = await get_user_by_email(req.email)
        if existing:
            raise HTTPException(status_code=400, detail="Email already registered")

        total = await count_users()
        is_first = total == 0

        org_id = req.org_id
        if req.org_name and not org_id:
            org_id = None

        user = await create_user(
            username=req.username,
            email=req.email,
            password=req.password,
            org_id=org_id,
            role="admin" if is_first else "user",
            status="active" if is_first else "pending",
        )

        msg = (
            "Registration successful. You are the first user and have been granted admin access."
            if is_first
            else "Registration successful. Please wait for an administrator to approve your account."
        )
        return {
            "message": msg,
            "user": user.to_public(),
            "requires_approval": not is_first,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Registration error: {e}")
        raise HTTPException(status_code=500, detail=f"Registration failed: {str(e)}")


@router.post("/auth/login", response_model=LoginResponse)
async def login(req: LoginRequest):
    user = await get_user_by_email(req.email)
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if user.status == "pending":
        raise HTTPException(
            status_code=403,
            detail="Your account is pending approval. Please wait for an administrator.",
        )
    if user.status == "suspended":
        raise HTTPException(status_code=403, detail="Your account has been suspended.")

    memberships = await get_user_memberships(str(user.id))
    admin_org_ids = [m["org_id"] for m in memberships if m["role"] == "org_admin"]

    token = create_access_token(
        {
            "sub": str(user.id),
            "username": user.username,
            "email": user.email,
            "role": user.role,
            "org_id": str(user.org_id) if user.org_id else None,
            "admin_org_ids": admin_org_ids,
        }
    )
    # 记录登录审计日志
    await write_audit_log(
        operator_id=str(user.id),
        operator_name=user.username,
        action=AuditAction.LOGIN_SUCCESS,
        resource_type=ResourceType.AUTH,
        detail=f"用户 {user.email} 登录成功",
    )
    return LoginResponse(
        access_token=token,
        user=await _build_user_response(user),
    )


@router.get("/auth/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("sub")
    if not user_id or user_id == "legacy":
        return UserResponse(
            id="legacy",
            username="admin",
            email="admin@local",
            role="admin",
            status="active",
        )
    user = await get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return await _build_user_response(user)


# ────────────────────────────────────────────────────────────
#  Admin – user management endpoints
# ────────────────────────────────────────────────────────────
async def _require_admin_access(current_user: dict) -> Dict[str, Any]:
    """Require super_admin or org_admin access. Returns role context."""
    ctx = await _get_current_user_role_context(current_user)
    if not ctx["has_any_admin"]:
        raise HTTPException(status_code=403, detail="Admin access required")
    return ctx


@router.get("/users", response_model=List[UserResponse])
async def get_users(current_user: dict = Depends(get_current_user)):
    """List users. Super admins see all; org admins see members of their orgs."""
    ctx = await _require_admin_access(current_user)

    if ctx["is_super_admin"]:
        users = await list_users()
    else:
        from open_notebook.database.repository import ensure_record_id as _erid, repo_query as _rq
        org_rids = [_erid(oid) for oid in ctx["admin_org_ids"]]
        if not org_rids:
            return []
        # Use the same sub-query pattern as list_users() — reliable across SurrealDB versions
        raw = await _rq(
            "SELECT * FROM app_user WHERE id IN (SELECT VALUE in FROM member_of WHERE out IN $oids) ORDER BY created ASC",
            {"oids": org_rids},
        )
        from open_notebook.domain.user import AppUser as _AppUser
        users = [_AppUser(**u) for u in (raw or [])]

    orgs = await list_organizations()
    org_map = {str(o.id): o.name for o in orgs}

    result = []
    for u in users:
        memberships_raw = await get_user_memberships(str(u.id))
        memberships = [
            MembershipInfo(org_id=m["org_id"], org_name=m["org_name"], role=m["role"])
            for m in memberships_raw
        ]
        result.append(
            UserResponse(
                id=str(u.id),
                username=u.username,
                email=u.email,
                role=u.role,
                status=u.status,
                org_id=str(u.org_id) if u.org_id else None,
                org_name=org_map.get(str(u.org_id)) if u.org_id else None,
                memberships=memberships,
                created=str(u.created) if u.created else None,
                updated=str(u.updated) if u.updated else None,
            )
        )
    return result


@router.post("/users", status_code=201)
async def admin_create_user(
    req: AdminCreateUserRequest,
    current_user: dict = Depends(get_current_user),
):
    ctx = await _require_admin_access(current_user)

    existing = await get_user_by_email(req.email)
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    if req.role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="Invalid role value")

    if not ctx["is_super_admin"] and req.role == "admin":
        raise HTTPException(status_code=403, detail="Only super admins can create admin users")

    user = await create_user(
        username=req.username,
        email=req.email,
        password=req.password,
        org_id=req.org_id,
        role=req.role,
        status="active",
    )
    # Org-admins: ensure the new user is also a member of ALL orgs the creator administers
    # so the creator can always see this user in their user-management view.
    if not ctx["is_super_admin"] and ctx["admin_org_ids"]:
        public_org_id = await get_public_org_id()
        for oid in ctx["admin_org_ids"]:
            if oid != public_org_id:
                await add_user_to_org(str(user.id), oid, "member")

    # 记录创建用户审计日志
    operator_name = current_user.get("username") or current_user.get("email") or "admin"
    await write_audit_log(
        operator_id=ctx["user_id"],
        operator_name=operator_name,
        action=AuditAction.USER_CREATE,
        resource_type=ResourceType.USER,
        resource_id=str(user.id),
        resource_name=user.username,
        detail=f"创建用户 {user.email}，角色: {req.role}",
    )
    return {
        "message": "User created successfully",
        "user": await _build_user_response(user),
    }


@router.put("/users/{user_id}/status")
async def update_status(
    user_id: str,
    req: UpdateStatusRequest,
    current_user: dict = Depends(get_current_user),
):
    ctx = await _require_admin_access(current_user)
    if req.status not in ("active", "pending", "suspended"):
        raise HTTPException(status_code=400, detail="Invalid status value")

    if not ctx["is_super_admin"]:
        memberships = await get_user_memberships(user_id)
        user_org_ids = {m["org_id"] for m in memberships}
        if not user_org_ids.intersection(ctx["admin_org_ids"]):
            raise HTTPException(status_code=403, detail="No permission to manage this user")

    user = await update_user_status(user_id, req.status)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if req.status == "active":
        # Auto-associate with the public org
        public_org_id = await get_public_org_id()
        if public_org_id:
            await add_user_to_org(str(user.id), public_org_id, "member")
        # If the approver is an org-admin, also add the user to all orgs the approver manages
        if not ctx["is_super_admin"] and ctx["admin_org_ids"]:
            for oid in ctx["admin_org_ids"]:
                if public_org_id and oid != public_org_id:
                    await add_user_to_org(str(user.id), oid, "member")
    # 记录状态变更审计日志
    operator_name = current_user.get("username") or current_user.get("email") or "admin"
    status_labels = {"active": "激活", "suspended": "封禁", "pending": "待审核"}
    action_map = {
        "active": AuditAction.USER_ACTIVATE,
        "suspended": AuditAction.USER_SUSPEND,
        "pending": AuditAction.USER_ACTIVATE,
    }
    await write_audit_log(
        operator_id=ctx["user_id"],
        operator_name=operator_name,
        action=action_map.get(req.status, AuditAction.USER_ACTIVATE),
        resource_type=ResourceType.USER,
        resource_id=str(user.id),
        resource_name=user.username,
        detail=f"将用户状态更改为: {status_labels.get(req.status, req.status)}",
    )
    return {"message": f"User status updated to {req.status}", "user": user.to_public()}


@router.put("/users/{user_id}/role")
async def update_role(
    user_id: str,
    req: UpdateRoleRequest,
    current_user: dict = Depends(get_current_user),
):
    ctx = await _require_admin_access(current_user)

    if req.role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="Invalid role value")

    if not ctx["is_super_admin"]:
        raise HTTPException(status_code=403, detail="Only super admins can change global roles")

    user = await update_user_role(user_id, req.role)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    operator_name = current_user.get("username") or current_user.get("email") or "admin"
    role_labels = {"admin": "管理员", "user": "普通用户"}
    await write_audit_log(
        operator_id=ctx["user_id"],
        operator_name=operator_name,
        action=AuditAction.USER_ROLE_CHANGE,
        resource_type=ResourceType.USER,
        resource_id=str(user.id),
        resource_name=user.username,
        detail=f"将全局角色更改为: {role_labels.get(req.role, req.role)}",
    )
    return {"message": f"User role updated to {req.role}", "user": user.to_public()}


@router.put("/users/{user_id}/org")
async def update_org_membership(
    user_id: str,
    req: UpdateOrgRequest,
    current_user: dict = Depends(get_current_user),
):
    ctx = await _require_admin_access(current_user)

    if not ctx["is_super_admin"] and req.org_id and req.org_id not in ctx["admin_org_ids"]:
        raise HTTPException(status_code=403, detail="No permission to assign this organization")

    user = await update_user_org(user_id, req.org_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User organization updated", "user": user.to_public()}


# ────────────────────────────────────────────────────────────
#  Membership management endpoints
# ────────────────────────────────────────────────────────────
@router.get("/users/{user_id}/memberships", response_model=List[MembershipInfo])
async def get_memberships(
    user_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get all org memberships for a user."""
    ctx = await _require_admin_access(current_user)
    raw = await get_user_memberships(user_id)
    if not ctx["is_super_admin"]:
        raw = [m for m in raw if m["org_id"] in ctx["admin_org_ids"]]
    return [MembershipInfo(org_id=m["org_id"], org_name=m["org_name"], role=m["role"]) for m in raw]


@router.post("/users/{user_id}/memberships")
async def add_membership(
    user_id: str,
    req: AddMembershipRequest,
    current_user: dict = Depends(get_current_user),
):
    """Add user to an organization with a role."""
    ctx = await _require_admin_access(current_user)
    if req.role not in ("member", "org_admin"):
        raise HTTPException(status_code=400, detail="Role must be 'member' or 'org_admin'")
    if not ctx["is_super_admin"] and req.org_id not in ctx["admin_org_ids"]:
        raise HTTPException(status_code=403, detail="No permission for this organization")

    # Disallow manually adding the public org — it's auto-assigned
    public_org_id = await get_public_org_id()
    if public_org_id and req.org_id == public_org_id:
        raise HTTPException(status_code=400, detail=f'"{PUBLIC_ORG_NAME}" 为系统自动关联，无需手动添加')

    success = await add_user_to_org(user_id, req.org_id, req.role)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to add membership")
    operator_name = current_user.get("username") or current_user.get("email") or "admin"
    await write_audit_log(
        operator_id=ctx["user_id"],
        operator_name=operator_name,
        action=AuditAction.MEMBER_ADD,
        resource_type=ResourceType.MEMBERSHIP,
        resource_id=user_id,
        detail=f"将用户加入组织 {req.org_id}，角色: {req.role}",
    )
    return {"message": "Membership added"}


@router.put("/users/{user_id}/memberships/{org_id}/role")
async def update_mem_role(
    user_id: str,
    org_id: str,
    req: UpdateMembershipRoleRequest,
    current_user: dict = Depends(get_current_user),
):
    """Update a user's role in an organization."""
    ctx = await _require_admin_access(current_user)
    if req.role not in ("member", "org_admin"):
        raise HTTPException(status_code=400, detail="Role must be 'member' or 'org_admin'")
    if not ctx["is_super_admin"] and org_id not in ctx["admin_org_ids"]:
        raise HTTPException(status_code=403, detail="No permission for this organization")

    success = await update_membership_role(user_id, org_id, req.role)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to update membership role")
    operator_name = current_user.get("username") or current_user.get("email") or "admin"
    role_labels = {"org_admin": "组管理员", "member": "普通成员"}
    await write_audit_log(
        operator_id=ctx["user_id"],
        operator_name=operator_name,
        action=AuditAction.MEMBER_ROLE,
        resource_type=ResourceType.MEMBERSHIP,
        resource_id=user_id,
        detail=f"在组织 {org_id} 中将用户角色更改为: {role_labels.get(req.role, req.role)}",
    )
    return {"message": "Membership role updated"}


@router.delete("/users/{user_id}/memberships/{org_id}")
async def remove_membership(
    user_id: str,
    org_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Remove user from an organization."""
    ctx = await _require_admin_access(current_user)
    if not ctx["is_super_admin"] and org_id not in ctx["admin_org_ids"]:
        raise HTTPException(status_code=403, detail="No permission for this organization")

    # Disallow removing the public org membership
    public_org_id = await get_public_org_id()
    if public_org_id and org_id == public_org_id:
        raise HTTPException(status_code=400, detail=f'"{PUBLIC_ORG_NAME}" 为系统保留组织，不可移除关联')

    success = await remove_user_from_org(user_id, org_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to remove membership")
    operator_name = current_user.get("username") or current_user.get("email") or "admin"
    await write_audit_log(
        operator_id=ctx["user_id"],
        operator_name=operator_name,
        action=AuditAction.MEMBER_REMOVE,
        resource_type=ResourceType.MEMBERSHIP,
        resource_id=user_id,
        detail=f"将用户从组织 {org_id} 中移除",
    )
    return {"message": "Membership removed"}


@router.delete("/users/{user_id}")
async def delete_user_endpoint(
    user_id: str,
    current_user: dict = Depends(get_current_user),
):
    ctx = await _require_admin_access(current_user)
    if str(user_id) == str(ctx["user_id"]):
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    if not ctx["is_super_admin"]:
        memberships = await get_user_memberships(user_id)
        user_org_ids = {m["org_id"] for m in memberships}
        if not user_org_ids.intersection(ctx["admin_org_ids"]):
            raise HTTPException(status_code=403, detail="No permission to delete this user")

    target_user = await get_user_by_id(user_id)
    target_name = target_user.username if target_user else user_id
    success = await delete_user(user_id)
    if not success:
        raise HTTPException(status_code=404, detail="User not found")
    operator_name = current_user.get("username") or current_user.get("email") or "admin"
    await write_audit_log(
        operator_id=ctx["user_id"],
        operator_name=operator_name,
        action=AuditAction.USER_DELETE,
        resource_type=ResourceType.USER,
        resource_id=user_id,
        resource_name=target_name,
        detail=f"删除用户 {target_name}",
    )
    return {"message": "User deleted successfully"}
