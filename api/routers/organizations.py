"""
Organization management endpoints.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.audit_service import AuditAction, ResourceType, write_audit_log
from api.auth import get_current_user, get_optional_user
from api.user_service import (
    create_organization,
    delete_organization,
    get_admin_org_ids,
    get_organization,
    get_org_members,
    list_organizations,
    update_organization,
)

router = APIRouter()


class OrganizationResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    member_count: Optional[int] = None
    created: Optional[str] = None
    updated: Optional[str] = None


class OrganizationCreate(BaseModel):
    name: str
    description: Optional[str] = None


class OrganizationUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


def _to_response(org, member_count: Optional[int] = None) -> OrganizationResponse:
    return OrganizationResponse(
        id=str(org.id),
        name=org.name,
        description=org.description,
        member_count=member_count,
        created=str(org.created) if org.created else None,
        updated=str(org.updated) if org.updated else None,
    )


@router.get("/organizations", response_model=List[OrganizationResponse])
async def get_organizations(_user=Depends(get_optional_user)):
    """List all organizations (public endpoint, used during registration)."""
    return [_to_response(o) for o in await list_organizations()]


@router.post("/organizations", response_model=OrganizationResponse, status_code=201)
async def create_org(req: OrganizationCreate, current_user: dict = Depends(get_current_user)):
    """Create a new organization (admin only)."""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only super admins can create organizations")
    org = await create_organization(req.name, req.description)
    operator_name = current_user.get("username") or current_user.get("email") or "admin"
    await write_audit_log(
        operator_id=current_user.get("sub"),
        operator_name=operator_name,
        action=AuditAction.ORG_CREATE,
        resource_type=ResourceType.ORGANIZATION,
        resource_id=str(org.id),
        resource_name=org.name,
        detail=f"创建组织: {org.name}",
    )
    return _to_response(org)


@router.put("/organizations/{org_id}", response_model=OrganizationResponse)
async def update_org(
    org_id: str,
    req: OrganizationUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Update an organization (super admin or org admin)."""
    is_super = current_user.get("role") == "admin"
    if not is_super:
        user_id = current_user.get("sub")
        admin_orgs = await get_admin_org_ids(user_id) if user_id else []
        if org_id not in admin_orgs:
            raise HTTPException(status_code=403, detail="No permission for this organization")

    try:
        org = await update_organization(org_id, req.name, req.description)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    operator_name = current_user.get("username") or current_user.get("email") or "admin"
    await write_audit_log(
        operator_id=current_user.get("sub"),
        operator_name=operator_name,
        action=AuditAction.ORG_UPDATE,
        resource_type=ResourceType.ORGANIZATION,
        resource_id=org_id,
        resource_name=org.name,
        detail=f"更新组织信息: {org.name}",
    )
    return _to_response(org)


@router.delete("/organizations/{org_id}")
async def delete_org(org_id: str, current_user: dict = Depends(get_current_user)):
    """Delete an organization (super admin only)."""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only super admins can delete organizations")
    try:
        org = await get_organization(org_id)
        if not await delete_organization(org_id):
            raise HTTPException(status_code=404, detail="Organization not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    operator_name = current_user.get("username") or current_user.get("email") or "admin"
    await write_audit_log(
        operator_id=current_user.get("sub"),
        operator_name=operator_name,
        action=AuditAction.ORG_DELETE,
        resource_type=ResourceType.ORGANIZATION,
        resource_id=org_id,
        resource_name=org.name if org else org_id,
        detail=f"删除组织: {org.name if org else org_id}",
    )
    return {"message": "Organization deleted successfully"}


@router.get("/organizations/{org_id}/members")
async def get_org_members_endpoint(
    org_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get members of an organization (super admin or org admin)."""
    is_super = current_user.get("role") == "admin"
    if not is_super:
        user_id = current_user.get("sub")
        admin_orgs = await get_admin_org_ids(user_id) if user_id else []
        if org_id not in admin_orgs:
            raise HTTPException(status_code=403, detail="No permission for this organization")

    members = await get_org_members(org_id)
    return members
