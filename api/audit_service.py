"""
Audit log service — records admin operations to the audit_log table.
"""
from typing import Any, Dict, List, Optional

from loguru import logger

from open_notebook.database.repository import ensure_record_id, repo_create, repo_query

# ── Action constants ─────────────────────────────────────────────────────────
class AuditAction:
    # User actions
    USER_CREATE   = "user.create"
    USER_DELETE   = "user.delete"
    USER_ACTIVATE = "user.activate"
    USER_SUSPEND  = "user.suspend"
    USER_ROLE_CHANGE = "user.role_change"
    # Membership actions
    MEMBER_ADD    = "member.add"
    MEMBER_REMOVE = "member.remove"
    MEMBER_ROLE   = "member.role_change"
    # Organization actions
    ORG_CREATE    = "org.create"
    ORG_UPDATE    = "org.update"
    ORG_DELETE    = "org.delete"
    # Login
    LOGIN_SUCCESS = "auth.login"
    LOGIN_FAIL    = "auth.login_fail"


# ── Resource type constants ───────────────────────────────────────────────────
class ResourceType:
    USER         = "用户"
    ORGANIZATION = "组织"
    MEMBERSHIP   = "组织成员"
    AUTH         = "认证"


async def write_audit_log(
    *,
    operator_id: Optional[str],
    operator_name: str,
    action: str,
    resource_type: str,
    resource_id: Optional[str] = None,
    resource_name: Optional[str] = None,
    detail: Optional[str] = None,
    ip: Optional[str] = None,
) -> None:
    """Write a single audit log entry. Errors are swallowed to avoid blocking business logic."""
    try:
        data: Dict[str, Any] = {
            "operator_name": operator_name,
            "action": action,
            "resource_type": resource_type,
        }
        if operator_id and operator_id != "legacy":
            data["operator_id"] = ensure_record_id(operator_id)
        if resource_id:
            data["resource_id"] = resource_id
        if resource_name:
            data["resource_name"] = resource_name
        if detail:
            data["detail"] = detail
        if ip:
            data["ip"] = ip
        await repo_create("audit_log", data)
    except Exception as e:
        logger.warning(f"Failed to write audit log: {e}")


async def query_audit_logs(
    *,
    action: Optional[str] = None,
    resource_type: Optional[str] = None,
    operator_id: Optional[str] = None,
    keyword: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    """Query audit logs with optional filters."""
    conditions: List[str] = []
    params: Dict[str, Any] = {"limit": limit, "offset": offset}

    if action:
        conditions.append("action = $action")
        params["action"] = action

    if resource_type:
        conditions.append("resource_type = $resource_type")
        params["resource_type"] = resource_type

    if operator_id and operator_id != "legacy":
        conditions.append("operator_id = $operator_id")
        params["operator_id"] = ensure_record_id(operator_id)

    if keyword:
        conditions.append(
            "(string::contains(operator_name, $kw) "
            "OR string::contains(resource_name, $kw) "
            "OR string::contains(detail, $kw))"
        )
        params["kw"] = keyword

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    query = f"""
        SELECT id, operator_id, operator_name, action, resource_type,
               resource_id, resource_name, detail, ip, created
        FROM audit_log
        {where_clause}
        ORDER BY created DESC
        LIMIT $limit START $offset
    """
    try:
        return await repo_query(query, params)
    except Exception as e:
        logger.error(f"Failed to query audit logs: {e}")
        return []


async def count_audit_logs(
    *,
    action: Optional[str] = None,
    resource_type: Optional[str] = None,
    operator_id: Optional[str] = None,
    keyword: Optional[str] = None,
) -> int:
    """Return total count matching the same filters."""
    conditions: List[str] = []
    params: Dict[str, Any] = {}

    if action:
        conditions.append("action = $action")
        params["action"] = action
    if resource_type:
        conditions.append("resource_type = $resource_type")
        params["resource_type"] = resource_type
    if operator_id and operator_id != "legacy":
        conditions.append("operator_id = $operator_id")
        params["operator_id"] = ensure_record_id(operator_id)
    if keyword:
        conditions.append(
            "(string::contains(operator_name, $kw) "
            "OR string::contains(resource_name, $kw) "
            "OR string::contains(detail, $kw))"
        )
        params["kw"] = keyword

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    query = f"SELECT count() AS cnt FROM audit_log {where_clause} GROUP ALL"
    try:
        result = await repo_query(query, params)
        return result[0]["cnt"] if result else 0
    except Exception as e:
        logger.error(f"Failed to count audit logs: {e}")
        return 0
