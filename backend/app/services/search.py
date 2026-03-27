"""
Meilisearch wrapper.

Index shape:
  id              — document UUID string (primary key)
  title           — file name / document title
  document_type   — AI-classified type (e.g. "Invoice")
  sensitivity     — public | internal | confidential | restricted
  status          — uploaded | processing | ready | processing_failed
  summary         — AI-generated summary
  extracted_text  — full extracted text (capped at 50 000 chars)
  tags            — list[str]
  updated_at_ts   — Unix timestamp (int) — used for date range filters
  updated_at      — ISO string — displayed in UI
  created_at      — ISO string

Searchable:   title, summary, document_type, tags, extracted_text
Filterable:   document_type, sensitivity, status, updated_at_ts
Sortable:     updated_at_ts, title
"""

import logging
from typing import Any

import meilisearch
import meilisearch.errors

from app.config import settings

logger = logging.getLogger(__name__)

INDEX_NAME = "documents"
_index_configured = False


def _client() -> meilisearch.Client:
    return meilisearch.Client(settings.meilisearch_url, settings.meilisearch_api_key)


def _get_index() -> meilisearch.index.Index:
    """Return index, creating and configuring it on first call."""
    global _index_configured
    client = _client()

    try:
        client.get_index(INDEX_NAME)
    except meilisearch.errors.MeilisearchApiError:
        client.create_index(INDEX_NAME, {"primaryKey": "id"})
        logger.info("[SEARCH] Created Meilisearch index '%s'", INDEX_NAME)

    index = client.index(INDEX_NAME)

    if not _index_configured:
        index.update_settings({
            "searchableAttributes": [
                "title",
                "summary",
                "document_type",
                "tags",
                "extracted_text",
            ],
            "filterableAttributes": [
                "document_type",
                "sensitivity",
                "status",
                "updated_at_ts",
            ],
            "sortableAttributes": ["updated_at_ts", "title"],
            "displayedAttributes": [
                "id", "title", "document_type", "sensitivity",
                "status", "summary", "tags", "updated_at", "created_at",
            ],
        })
        _index_configured = True

    return index


def index_document(
    doc_id: str,
    title: str,
    document_type: str | None,
    sensitivity: str | None,
    status: str,
    summary: str | None,
    extracted_text: str | None,
    tags: list[str],
    updated_at: str,
    created_at: str,
) -> None:
    """Index or re-index a single document. Never raises — failure is logged only."""
    try:
        import datetime as dt

        # Parse updated_at to Unix timestamp for range filtering
        try:
            ts = int(dt.datetime.fromisoformat(updated_at.replace("Z", "+00:00")).timestamp())
        except Exception:
            ts = 0

        doc = {
            "id": doc_id,
            "title": title,
            "document_type": document_type or "",
            "sensitivity": sensitivity or "",
            "status": status,
            "summary": summary or "",
            "extracted_text": (extracted_text or "")[:50_000],
            "tags": tags or [],
            "updated_at_ts": ts,
            "updated_at": updated_at,
            "created_at": created_at,
        }
        _get_index().add_documents([doc])
        logger.info("[SEARCH] Indexed document %s ('%s')", doc_id, title)
    except Exception as exc:
        logger.error("[SEARCH] Failed to index document %s: %s", doc_id, exc)


def delete_document(doc_id: str) -> None:
    """Remove a document from the index. Never raises."""
    try:
        _get_index().delete_document(doc_id)
        logger.info("[SEARCH] Deleted document %s from index", doc_id)
    except Exception as exc:
        logger.error("[SEARCH] Failed to delete document %s from index: %s", doc_id, exc)


def search_documents(
    q: str,
    *,
    limit: int = 20,
    offset: int = 0,
    document_type: str | None = None,
    sensitivity: str | None = None,
    status: str | None = None,
    date_from_ts: int | None = None,
    date_to_ts: int | None = None,
) -> dict[str, Any]:
    """
    Full-text search via Meilisearch.
    Returns raw Meilisearch response dict:
      {
        hits: [...],
        estimatedTotalHits: int,
        ...
      }
    Each hit includes _formatted with <mark> highlights.
    """
    try:
        filters: list[str] = []
        if document_type:
            filters.append(f'document_type = "{document_type}"')
        if sensitivity:
            filters.append(f'sensitivity = "{sensitivity}"')
        if status:
            filters.append(f'status = "{status}"')
        if date_from_ts is not None:
            filters.append(f"updated_at_ts >= {date_from_ts}")
        if date_to_ts is not None:
            filters.append(f"updated_at_ts <= {date_to_ts}")

        params: dict[str, Any] = {
            "limit": limit,
            "offset": offset,
            "attributesToHighlight": ["title", "summary", "extracted_text"],
            "highlightPreTag": "<mark>",
            "highlightPostTag": "</mark>",
            "attributesToCrop": ["extracted_text"],
            "cropLength": 30,  # words around match
        }
        if filters:
            params["filter"] = " AND ".join(filters)

        result = _get_index().search(q, params)
        return result
    except Exception as exc:
        logger.error("[SEARCH] Search failed for q=%r: %s", q, exc)
        return {"hits": [], "estimatedTotalHits": 0}


def get_all_ids_for_query(
    q: str,
    *,
    document_type: str | None = None,
    sensitivity: str | None = None,
    status: str | None = None,
    date_from_ts: int | None = None,
    date_to_ts: int | None = None,
) -> list[str]:
    """
    Return all matching document IDs (up to 10 000) in Meilisearch relevance order.
    Used by GET /documents?q= to swap ILIKE for full-text search while keeping
    PostgreSQL as the source of truth for all other data.
    """
    result = search_documents(
        q,
        limit=10_000,
        offset=0,
        document_type=document_type,
        sensitivity=sensitivity,
        status=status,
        date_from_ts=date_from_ts,
        date_to_ts=date_to_ts,
    )
    return [hit["id"] for hit in result.get("hits", [])]
