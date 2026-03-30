import json
from typing import AsyncGenerator, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from loguru import logger

from api.auth import get_optional_user
from api.models import AskRequest, AskResponse, SearchRequest, SearchResponse
from open_notebook.ai.models import Model, model_manager
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.notebook import text_search, vector_search
from open_notebook.exceptions import DatabaseOperationError, InvalidInputError
from open_notebook.graphs.ask import graph as ask_graph

router = APIRouter()


def _get_user_id(current_user: Optional[Dict]) -> Optional[str]:
    if not current_user:
        return None
    sub = current_user.get("sub")
    return sub if sub and sub != "legacy" else None


async def _get_user_org_ids(current_user: Optional[Dict]) -> List[str]:
    user_id = _get_user_id(current_user)
    if not user_id:
        return []
    result = await repo_query(
        "SELECT VALUE out FROM member_of WHERE in = $uid",
        {"uid": ensure_record_id(user_id)},
    )
    return [str(r) for r in result] if result else []


async def _extract_scope(current_user: Optional[Dict]) -> tuple:
    """Return (org_ids, user_id) from the current user dict."""
    if not current_user:
        return [], None
    org_ids = await _get_user_org_ids(current_user)
    user_id = _get_user_id(current_user)
    return org_ids, user_id


@router.post("/search", response_model=SearchResponse)
async def search_knowledge_base(
    search_request: SearchRequest,
    current_user: Optional[Dict] = Depends(get_optional_user),
):
    """Search the knowledge base using text or vector search."""
    try:
        org_ids, user_id = await _extract_scope(current_user)

        if search_request.type == "vector":
            if not await model_manager.get_embedding_model():
                raise HTTPException(
                    status_code=400,
                    detail="Vector search requires an embedding model. Please configure one in the Models section.",
                )

            results = await vector_search(
                keyword=search_request.query,
                results=search_request.limit,
                source=search_request.search_sources,
                note=search_request.search_notes,
                minimum_score=search_request.minimum_score,
                org_ids=org_ids if org_ids else None,
                user_id=user_id,
            )
        else:
            results = await text_search(
                keyword=search_request.query,
                results=search_request.limit,
                source=search_request.search_sources,
                note=search_request.search_notes,
                org_ids=org_ids if org_ids else None,
                user_id=user_id,
            )

        return SearchResponse(
            results=results or [],
            total_count=len(results) if results else 0,
            search_type=search_request.type,
        )

    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except DatabaseOperationError as e:
        logger.error(f"Database error during search: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")
    except Exception as e:
        logger.error(f"Unexpected error during search: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


async def stream_ask_response(
    question: str,
    strategy_model: Model,
    answer_model: Model,
    final_answer_model: Model,
    org_ids: Optional[List[str]] = None,
    user_id: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """Stream the ask response as Server-Sent Events."""
    try:
        final_answer = None

        async for chunk in ask_graph.astream(
            input=dict(question=question),  # type: ignore[arg-type]
            config=dict(
                configurable=dict(
                    strategy_model=strategy_model.id,
                    answer_model=answer_model.id,
                    final_answer_model=final_answer_model.id,
                    org_ids=org_ids,
                    user_id=user_id,
                )
            ),
            stream_mode="updates",
        ):
            if "agent" in chunk:
                strategy_data = {
                    "type": "strategy",
                    "reasoning": chunk["agent"]["strategy"].reasoning,
                    "searches": [
                        {"term": search.term, "instructions": search.instructions}
                        for search in chunk["agent"]["strategy"].searches
                    ],
                }
                yield f"data: {json.dumps(strategy_data)}\n\n"

            elif "provide_answer" in chunk:
                for answer in chunk["provide_answer"]["answers"]:
                    answer_data = {"type": "answer", "content": answer}
                    yield f"data: {json.dumps(answer_data)}\n\n"

            elif "write_final_answer" in chunk:
                final_answer = chunk["write_final_answer"]["final_answer"]
                final_data = {"type": "final_answer", "content": final_answer}
                yield f"data: {json.dumps(final_data)}\n\n"

        completion_data = {"type": "complete", "final_answer": final_answer}
        yield f"data: {json.dumps(completion_data)}\n\n"

    except Exception as e:
        from open_notebook.utils.error_classifier import classify_error

        _, user_message = classify_error(e)
        logger.error(f"Error in ask streaming: {str(e)}")
        error_data = {"type": "error", "message": user_message}
        yield f"data: {json.dumps(error_data)}\n\n"


@router.post("/search/ask")
async def ask_knowledge_base(
    ask_request: AskRequest,
    current_user: Optional[Dict] = Depends(get_optional_user),
):
    """Ask the knowledge base a question using AI models."""
    try:
        strategy_model = await Model.get(ask_request.strategy_model)
        answer_model = await Model.get(ask_request.answer_model)
        final_answer_model = await Model.get(ask_request.final_answer_model)

        if not strategy_model:
            raise HTTPException(
                status_code=400,
                detail=f"Strategy model {ask_request.strategy_model} not found",
            )
        if not answer_model:
            raise HTTPException(
                status_code=400,
                detail=f"Answer model {ask_request.answer_model} not found",
            )
        if not final_answer_model:
            raise HTTPException(
                status_code=400,
                detail=f"Final answer model {ask_request.final_answer_model} not found",
            )

        if not await model_manager.get_embedding_model():
            raise HTTPException(
                status_code=400,
                detail="Ask feature requires an embedding model. Please configure one in the Models section.",
            )

        org_ids, user_id = await _extract_scope(current_user)
        return StreamingResponse(
            stream_ask_response(
                ask_request.question,
                strategy_model,
                answer_model,
                final_answer_model,
                org_ids=org_ids if org_ids else None,
                user_id=user_id,
            ),
            media_type="text/plain",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in ask endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Ask operation failed: {str(e)}")


@router.post("/search/ask/simple", response_model=AskResponse)
async def ask_knowledge_base_simple(
    ask_request: AskRequest,
    current_user: Optional[Dict] = Depends(get_optional_user),
):
    """Ask the knowledge base a question and return a simple response (non-streaming)."""
    try:
        strategy_model = await Model.get(ask_request.strategy_model)
        answer_model = await Model.get(ask_request.answer_model)
        final_answer_model = await Model.get(ask_request.final_answer_model)

        if not strategy_model:
            raise HTTPException(
                status_code=400,
                detail=f"Strategy model {ask_request.strategy_model} not found",
            )
        if not answer_model:
            raise HTTPException(
                status_code=400,
                detail=f"Answer model {ask_request.answer_model} not found",
            )
        if not final_answer_model:
            raise HTTPException(
                status_code=400,
                detail=f"Final answer model {ask_request.final_answer_model} not found",
            )

        if not await model_manager.get_embedding_model():
            raise HTTPException(
                status_code=400,
                detail="Ask feature requires an embedding model. Please configure one in the Models section.",
            )

        org_ids, user_id = await _extract_scope(current_user)
        final_answer = None
        async for chunk in ask_graph.astream(
            input=dict(question=ask_request.question),  # type: ignore[arg-type]
            config=dict(
                configurable=dict(
                    strategy_model=strategy_model.id,
                    answer_model=answer_model.id,
                    final_answer_model=final_answer_model.id,
                    org_ids=org_ids if org_ids else None,
                    user_id=user_id,
                )
            ),
            stream_mode="updates",
        ):
            if "write_final_answer" in chunk:
                final_answer = chunk["write_final_answer"]["final_answer"]

        if not final_answer:
            raise HTTPException(status_code=500, detail="No answer generated")

        return AskResponse(answer=final_answer, question=ask_request.question)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in ask simple endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Ask operation failed: {str(e)}")
