from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from loguru import logger

from api.auth import get_optional_user
from api.models import (
    NotebookCreate,
    NotebookDeletePreview,
    NotebookDeleteResponse,
    NotebookResponse,
    NotebookUpdate,
    OrgInfo,
)
from api.user_service import get_public_org_id
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.notebook import Notebook, Source
from open_notebook.exceptions import InvalidInputError

router = APIRouter()


def _get_user_id(current_user: Optional[Dict[str, Any]]) -> Optional[str]:
    if not current_user:
        return None
    sub = current_user.get("sub")
    return sub if sub and sub != "legacy" else None


def _is_admin(current_user: Optional[Dict[str, Any]]) -> bool:
    if not current_user:
        return False
    return current_user.get("role") == "admin"


async def _get_user_org_ids(current_user: Optional[Dict[str, Any]]) -> List[str]:
    """Get all org IDs the user belongs to via memberships."""
    user_id = _get_user_id(current_user)
    if not user_id:
        return []
    result = await repo_query(
        "SELECT VALUE out FROM member_of WHERE in = $uid",
        {"uid": ensure_record_id(user_id)},
    )
    return [str(r) for r in result] if result else []


async def _build_org_map() -> Dict[str, str]:
    """Build a map of org_id -> org_name for all organizations."""
    from api.user_service import list_organizations
    orgs = await list_organizations()
    return {str(o.id): o.name for o in orgs}


def _extract_org_ids(nb: Dict[str, Any]) -> List[str]:
    """Extract org IDs from a notebook record, handling both org_id and org_ids."""
    org_ids_raw = nb.get("org_ids")
    if org_ids_raw and isinstance(org_ids_raw, list):
        return [str(oid) for oid in org_ids_raw if oid]
    old_org_id = nb.get("org_id")
    if old_org_id:
        return [str(old_org_id)]
    return []


def _build_org_infos(nb: Dict[str, Any], org_map: Dict[str, str]) -> List[OrgInfo]:
    """Build OrgInfo list for a notebook."""
    return [
        OrgInfo(id=oid, name=org_map.get(oid, oid))
        for oid in _extract_org_ids(nb)
    ]


def _nb_to_response(
    nb: Dict[str, Any],
    user_map: Dict[str, str],
    org_map: Dict[str, str],
) -> NotebookResponse:
    return NotebookResponse(
        id=str(nb.get("id", "")),
        name=nb.get("name", ""),
        description=nb.get("description", ""),
        archived=nb.get("archived", False),
        created=str(nb.get("created", "")),
        updated=str(nb.get("updated", "")),
        source_count=nb.get("source_count", 0),
        note_count=nb.get("note_count", 0),
        creator_name=user_map.get(str(nb.get("user_id"))) if nb.get("user_id") else None,
        orgs=_build_org_infos(nb, org_map),
    )


@router.get("/notebooks", response_model=List[NotebookResponse])
async def get_notebooks(
    archived: Optional[bool] = Query(None, description="Filter by archived status"),
    order_by: str = Query("updated desc", description="Order by field and direction"),
    current_user: Optional[Dict[str, Any]] = Depends(get_optional_user),
):
    """Get all notebooks. Admins see everything; regular users see own + org + public."""
    try:
        user_id = _get_user_id(current_user)
        admin = _is_admin(current_user)
        user_org_ids = await _get_user_org_ids(current_user)
        public_org_id = await get_public_org_id()
        public_org_rid = ensure_record_id(public_org_id) if public_org_id else None

        if admin:
            query = f"""
                SELECT *,
                count(<-reference.in) as source_count,
                count(<-artifact.in) as note_count
                FROM notebook
                ORDER BY {order_by}
            """
            result = await repo_query(query)
        elif user_org_ids and user_id:
            org_rids = [ensure_record_id(oid) for oid in user_org_ids]
            public_sql = " OR (org_ids IS NOT NONE AND org_ids IS NOT NULL AND array::len(org_ids) > 0 AND $public_org_rid IN org_ids)" if public_org_rid else ""
            query = f"""
                SELECT *,
                count(<-reference.in) as source_count,
                count(<-artifact.in) as note_count
                FROM notebook
                WHERE org_id IN $org_ids
                   OR (org_ids IS NOT NONE AND org_ids IS NOT NULL AND array::len(array::intersect(org_ids, $org_ids)) > 0)
                   OR user_id = $user_id
                   OR (user_id IS NONE AND org_id IS NONE AND (org_ids IS NONE OR org_ids IS NULL OR array::len(org_ids) = 0))
                   OR (user_id IS NULL AND org_id IS NULL AND (org_ids IS NONE OR org_ids IS NULL OR array::len(org_ids) = 0)){public_sql}
                ORDER BY {order_by}
            """
            params = {"org_ids": org_rids, "user_id": ensure_record_id(user_id)}
            if public_org_rid:
                params["public_org_rid"] = public_org_rid
            result = await repo_query(query, params)
        elif user_id:
            public_sql = " OR (org_ids IS NOT NONE AND org_ids IS NOT NULL AND array::len(org_ids) > 0 AND $public_org_rid IN org_ids)" if public_org_rid else ""
            query = f"""
                SELECT *,
                count(<-reference.in) as source_count,
                count(<-artifact.in) as note_count
                FROM notebook
                WHERE ((user_id = $user_id OR user_id IS NONE OR user_id IS NULL)
                    AND (org_id IS NONE OR org_id IS NULL)
                    AND (org_ids IS NONE OR array::len(org_ids) = 0 OR org_ids IS NULL)){public_sql}
                ORDER BY {order_by}
            """
            params = {"user_id": ensure_record_id(user_id)}
            if public_org_rid:
                params["public_org_rid"] = public_org_rid
            result = await repo_query(query, params)
        else:
            query = f"""
                SELECT *,
                count(<-reference.in) as source_count,
                count(<-artifact.in) as note_count
                FROM notebook
                ORDER BY {order_by}
            """
            result = await repo_query(query)

        if archived is not None:
            result = [nb for nb in result if nb.get("archived") == archived]

        user_ids = {str(nb.get("user_id")) for nb in result if nb.get("user_id")}
        user_map: Dict[str, str] = {}
        if user_ids:
            users = await repo_query(
                "SELECT id, username FROM app_user WHERE id IN $ids",
                {"ids": [ensure_record_id(uid) for uid in user_ids]},
            )
            user_map = {str(u["id"]): u["username"] for u in users}

        org_map = await _build_org_map()

        return [_nb_to_response(nb, user_map, org_map) for nb in result]
    except Exception as e:
        logger.error(f"Error fetching notebooks: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching notebooks: {str(e)}"
        )


@router.post("/notebooks", response_model=NotebookResponse)
async def create_notebook(
    notebook: NotebookCreate,
    current_user: Optional[Dict[str, Any]] = Depends(get_optional_user),
):
    """Create a new notebook with optional multi-org association."""
    try:
        user_id = _get_user_id(current_user)
        org_ids = notebook.org_ids or ([notebook.org_id] if notebook.org_id else None)
        org_ids = [oid for oid in (org_ids or []) if oid]

        new_notebook = Notebook(
            name=notebook.name,
            description=notebook.description,
            org_ids=org_ids if org_ids else None,
            user_id=user_id,
        )
        await new_notebook.save()

        org_map: Dict[str, str] = {}
        if org_ids:
            org_map = await _build_org_map()

        return NotebookResponse(
            id=new_notebook.id or "",
            name=new_notebook.name,
            description=new_notebook.description,
            archived=new_notebook.archived or False,
            created=str(new_notebook.created),
            updated=str(new_notebook.updated),
            source_count=0,
            note_count=0,
            orgs=[OrgInfo(id=oid, name=org_map.get(oid, oid)) for oid in org_ids],
        )
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating notebook: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error creating notebook: {str(e)}"
        )


@router.get(
    "/notebooks/{notebook_id}/delete-preview", response_model=NotebookDeletePreview
)
async def get_notebook_delete_preview(notebook_id: str):
    """Get a preview of what will be deleted when this notebook is deleted."""
    try:
        notebook = await Notebook.get(notebook_id)
        if not notebook:
            raise HTTPException(status_code=404, detail="Notebook not found")

        preview = await notebook.get_delete_preview()

        return NotebookDeletePreview(
            notebook_id=str(notebook.id),
            notebook_name=notebook.name,
            note_count=preview["note_count"],
            exclusive_source_count=preview["exclusive_source_count"],
            shared_source_count=preview["shared_source_count"],
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting delete preview for notebook {notebook_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Error fetching notebook deletion preview: {str(e)}",
        )


@router.get("/notebooks/{notebook_id}", response_model=NotebookResponse)
async def get_notebook(notebook_id: str):
    """Get a specific notebook by ID."""
    try:
        query = """
            SELECT *,
            count(<-reference.in) as source_count,
            count(<-artifact.in) as note_count
            FROM $notebook_id
        """
        result = await repo_query(query, {"notebook_id": ensure_record_id(notebook_id)})

        if not result:
            raise HTTPException(status_code=404, detail="Notebook not found")

        nb = result[0]
        org_map = await _build_org_map()

        return NotebookResponse(
            id=str(nb.get("id", "")),
            name=nb.get("name", ""),
            description=nb.get("description", ""),
            archived=nb.get("archived", False),
            created=str(nb.get("created", "")),
            updated=str(nb.get("updated", "")),
            source_count=nb.get("source_count", 0),
            note_count=nb.get("note_count", 0),
            orgs=_build_org_infos(nb, org_map),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching notebook {notebook_id}: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching notebook: {str(e)}"
        )


@router.put("/notebooks/{notebook_id}", response_model=NotebookResponse)
async def update_notebook(notebook_id: str, notebook_update: NotebookUpdate):
    """Update a notebook."""
    try:
        notebook = await Notebook.get(notebook_id)
        if not notebook:
            raise HTTPException(status_code=404, detail="Notebook not found")

        if notebook_update.name is not None:
            notebook.name = notebook_update.name
        if notebook_update.description is not None:
            notebook.description = notebook_update.description
        if notebook_update.archived is not None:
            notebook.archived = notebook_update.archived
        if notebook_update.org_ids is not None:
            notebook.org_ids = notebook_update.org_ids if notebook_update.org_ids else None

        await notebook.save()

        query = """
            SELECT *,
            count(<-reference.in) as source_count,
            count(<-artifact.in) as note_count
            FROM $notebook_id
        """
        result = await repo_query(query, {"notebook_id": ensure_record_id(notebook_id)})
        org_map = await _build_org_map()

        if result:
            nb = result[0]
            return _nb_to_response(nb, {}, org_map)

        return NotebookResponse(
            id=notebook.id or "",
            name=notebook.name,
            description=notebook.description,
            archived=notebook.archived or False,
            created=str(notebook.created),
            updated=str(notebook.updated),
            source_count=0,
            note_count=0,
        )
    except HTTPException:
        raise
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating notebook {notebook_id}: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error updating notebook: {str(e)}"
        )


@router.post("/notebooks/{notebook_id}/sources/{source_id}")
async def add_source_to_notebook(notebook_id: str, source_id: str):
    """Add an existing source to a notebook (create the reference)."""
    try:
        notebook = await Notebook.get(notebook_id)
        if not notebook:
            raise HTTPException(status_code=404, detail="Notebook not found")

        source = await Source.get(source_id)
        if not source:
            raise HTTPException(status_code=404, detail="Source not found")

        existing_ref = await repo_query(
            "SELECT * FROM reference WHERE out = $source_id AND in = $notebook_id",
            {
                "notebook_id": ensure_record_id(notebook_id),
                "source_id": ensure_record_id(source_id),
            },
        )

        if not existing_ref:
            await repo_query(
                "RELATE $source_id->reference->$notebook_id",
                {
                    "notebook_id": ensure_record_id(notebook_id),
                    "source_id": ensure_record_id(source_id),
                },
            )

        return {"message": "Source linked to notebook successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Error linking source {source_id} to notebook {notebook_id}: {str(e)}"
        )
        raise HTTPException(
            status_code=500, detail=f"Error linking source to notebook: {str(e)}"
        )


@router.delete("/notebooks/{notebook_id}/sources/{source_id}")
async def remove_source_from_notebook(notebook_id: str, source_id: str):
    """Remove a source from a notebook (delete the reference)."""
    try:
        notebook = await Notebook.get(notebook_id)
        if not notebook:
            raise HTTPException(status_code=404, detail="Notebook not found")

        await repo_query(
            "DELETE FROM reference WHERE out = $notebook_id AND in = $source_id",
            {
                "notebook_id": ensure_record_id(notebook_id),
                "source_id": ensure_record_id(source_id),
            },
        )

        return {"message": "Source removed from notebook successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Error removing source {source_id} from notebook {notebook_id}: {str(e)}"
        )
        raise HTTPException(
            status_code=500, detail=f"Error removing source from notebook: {str(e)}"
        )


@router.delete("/notebooks/{notebook_id}", response_model=NotebookDeleteResponse)
async def delete_notebook(
    notebook_id: str,
    delete_exclusive_sources: bool = Query(
        False,
        description="Whether to delete sources that belong only to this notebook",
    ),
):
    """Delete a notebook with cascade deletion."""
    try:
        notebook = await Notebook.get(notebook_id)
        if not notebook:
            raise HTTPException(status_code=404, detail="Notebook not found")

        result = await notebook.delete(delete_exclusive_sources=delete_exclusive_sources)

        return NotebookDeleteResponse(
            message="Notebook deleted successfully",
            deleted_notes=result["deleted_notes"],
            deleted_sources=result["deleted_sources"],
            unlinked_sources=result["unlinked_sources"],
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting notebook {notebook_id}: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error deleting notebook: {str(e)}"
        )
