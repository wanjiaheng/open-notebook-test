"""
Audit log query endpoints — super admin only.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from api.audit_service import count_audit_logs, query_audit_logs
from api.auth import get_current_user

router = APIRouter()


class AuditLogItem(BaseModel):
    id: str
    operator_id: Optional[str] = None
    operator_name: str
    action: str
    resource_type: str
    resource_id: Optional[str] = None
    resource_name: Optional[str] = None
    detail: Optional[str] = None
    ip: Optional[str] = None
    created: Optional[str] = None


class AuditLogListResponse(BaseModel):
    total: int
    items: List[AuditLogItem]


@router.get("/audit-logs", response_model=AuditLogListResponse)
async def list_audit_logs(
    action: Optional[str] = Query(None),
    resource_type: Optional[str] = Query(None),
    operator_id: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    """Query audit logs. Super admin only."""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only super admins can view audit logs")

    offset = (page - 1) * page_size
    filter_kwargs = dict(
        action=action or None,
        resource_type=resource_type or None,
        operator_id=operator_id or None,
        keyword=keyword or None,
    )

    total, rows = await _fetch(offset, page_size, filter_kwargs)

    items = [
        AuditLogItem(
            id=str(r.get("id", "")),
            operator_id=str(r["operator_id"]) if r.get("operator_id") else None,
            operator_name=r.get("operator_name", ""),
            action=r.get("action", ""),
            resource_type=r.get("resource_type", ""),
            resource_id=r.get("resource_id"),
            resource_name=r.get("resource_name"),
            detail=r.get("detail"),
            ip=r.get("ip"),
            created=str(r["created"]) if r.get("created") else None,
        )
        for r in rows
    ]
    return AuditLogListResponse(total=total, items=items)


async def _fetch(offset: int, limit: int, kw: dict):
    total = await count_audit_logs(**kw)
    rows = await query_audit_logs(offset=offset, limit=limit, **kw)
    return total, rows
