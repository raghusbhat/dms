import logging
import mimetypes
import uuid
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, Response, StreamingResponse
from typing import Literal
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession

import asyncio

from app.auth.dependencies import get_current_user
from app.config import settings
from app.conversion.libreoffice import (
    convert_to_pdf,
    is_natively_viewable,
    needs_conversion,
)
from app.database import get_db
from app.models.document import Document, DocumentVersion, Folder
from app.models.extraction import DocumentExtraction
from app.models.user import User
from app.services.search import get_all_ids_for_query
from app.services.rag import answer_question
from app.storage.local import LocalStorageAdapter
from app.storage.registry import storage
from app.workers.extraction_worker import process_document

router = APIRouter(prefix="/documents", tags=["documents"])

MAX_UPLOAD_BYTES = 500 * 1024 * 1024  # 500 MB


class DocumentVersionOut(BaseModel):
    id: str
    version_number: int
    file_name: str
    file_size: int
    mime_type: str
    created_at: datetime


class ExtractionOut(BaseModel):
    document_type: str | None
    type_confidence: float | None
    sensitivity: str | None
    summary: str | None
    key_fields: dict | None


class DocumentOut(BaseModel):
    id: str
    title: str
    status: str
    folder_id: str | None
    current_version_id: str | None
    tags: list[str]
    created_at: datetime
    updated_at: datetime
    latest_version: DocumentVersionOut | None
    extraction: ExtractionOut | None


class MetadataPatchRequest(BaseModel):
    document_type: str | None = None
    sensitivity: Literal["public", "internal", "confidential", "restricted"] | None = None
    tags: list[str] | None = None


class DocumentPage(BaseModel):
    items: list[DocumentOut]
    total: int
    page: int
    pages: int


class AskRequest(BaseModel):
    question: str


class AskResponse(BaseModel):
    answer: str
    document_id: str
    question: str


class DocumentMoveRequest(BaseModel):
    folder_id: str | None  # None = move to root


@router.post("/upload", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile,
    folder_id: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DocumentOut:
    data = await file.read()

    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File exceeds the 500 MB limit.",
        )

    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must have a name.",
        )

    mime_type = (
        file.content_type
        or mimetypes.guess_type(file.filename)[0]
        or "application/octet-stream"
    )

    file_id = str(uuid.uuid4())
    storage_path = await storage.save(file_id, data)

    # Validate folder if provided
    folder_uuid: uuid.UUID | None = None
    if folder_id:
        try:
            folder_uuid = uuid.UUID(folder_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid folder_id.")
        folder_exists = await db.execute(select(Folder).where(Folder.id == folder_uuid))
        if not folder_exists.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Folder not found.")

    # Create document record
    doc = Document(
        title=file.filename,
        created_by=current_user.id,
        folder_id=folder_uuid,
    )
    db.add(doc)
    await db.flush()  # get doc.id

    version = DocumentVersion(
        document_id=doc.id,
        version_number=1,
        storage_path=storage_path,
        file_name=file.filename,
        file_size=len(data),
        mime_type=mime_type,
        uploaded_by=current_user.id,
    )
    db.add(version)
    await db.flush()  # get version.id

    doc.current_version_id = version.id
    await db.commit()
    await db.refresh(doc)
    await db.refresh(version)

    task = process_document.delay(str(doc.id))
    logger.info("[UPLOAD] Dispatched extraction task — document_id=%s task_id=%s", doc.id, task.id)

    return _doc_out(doc, version)


@router.get("", response_model=DocumentPage)
async def list_documents(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    q: str | None = Query(None),
    folder_id: str | None = Query(None, description="Filter by folder (omit for all, 'root' for unfoldered)"),
    document_type: str | None = Query(None),
    sensitivity: str | None = Query(None),
    status: str | None = Query(None),
    date_from: datetime | None = Query(None, description="ISO 8601 — filter updated_at >= this date"),
    date_to: datetime | None = Query(None, description="ISO 8601 — filter updated_at <= this date"),
    sort_by: str = Query("updated_at", description="updated_at | title | created_at"),
    sort_order: str = Query("desc", description="asc | desc"),
) -> DocumentPage:
    date_from_ts = int(date_from.timestamp()) if date_from else None
    date_to_ts = int(date_to.timestamp()) if date_to else None

    # ── Full-text search via Meilisearch ─────────────────────────────────────
    if q:
        ms_ids = await asyncio.to_thread(
            get_all_ids_for_query,
            q,
            document_type=document_type,
            sensitivity=sensitivity,
            status=status,
            date_from_ts=date_from_ts,
            date_to_ts=date_to_ts,
        )
        if not ms_ids:
            return DocumentPage(items=[], total=0, page=page, pages=1)

        total = len(ms_ids)
        page_ids = ms_ids[(page - 1) * limit : page * limit]
        uid_list = [uuid.UUID(i) for i in page_ids]

        result = await db.execute(select(Document).where(Document.id.in_(uid_list)))
        docs_by_id = {str(d.id): d for d in result.scalars().all()}

        out = []
        for doc_id in page_ids:
            doc = docs_by_id.get(doc_id)
            if doc:
                version = await _get_current_version(db, doc)
                extraction = await _get_extraction(db, doc)
                out.append(_doc_out(doc, version, extraction))

        return DocumentPage(
            items=out,
            total=total,
            page=page,
            pages=max(1, -(-total // limit)),
        )

    # ── Standard SQL query (no search term) ──────────────────────────────────
    def _apply_filters(q_obj):
        if folder_id == "root":
            q_obj = q_obj.where(Document.folder_id.is_(None))
        elif folder_id:
            try:
                fid = uuid.UUID(folder_id)
                q_obj = q_obj.where(Document.folder_id == fid)
            except ValueError:
                pass
        if status:
            q_obj = q_obj.where(Document.status == status)
        if date_from:
            q_obj = q_obj.where(Document.updated_at >= date_from)
        if date_to:
            q_obj = q_obj.where(Document.updated_at <= date_to)
        if document_type or sensitivity:
            ext = aliased(DocumentExtraction)
            q_obj = q_obj.join(ext, Document.id == ext.document_id, isouter=True)
            if document_type:
                q_obj = q_obj.where(ext.document_type == document_type)
            if sensitivity:
                q_obj = q_obj.where(ext.sensitivity == sensitivity)
        return q_obj

    count_result = await db.execute(_apply_filters(select(func.count()).select_from(Document)))
    total = count_result.scalar_one()

    valid_sort_fields = {"updated_at": Document.updated_at, "title": Document.title, "created_at": Document.created_at}
    sort_field = valid_sort_fields.get(sort_by, Document.updated_at)
    order = sort_field.asc() if sort_order.lower() == "asc" else sort_field.desc()

    offset = (page - 1) * limit
    result = await db.execute(_apply_filters(select(Document)).order_by(order).offset(offset).limit(limit))
    docs = result.scalars().all()

    out = []
    for doc in docs:
        version = await _get_current_version(db, doc)
        extraction = await _get_extraction(db, doc)
        out.append(_doc_out(doc, version, extraction))

    return DocumentPage(
        items=out,
        total=total,
        page=page,
        pages=max(1, -(-total // limit)),
    )


@router.get("/{document_id}", response_model=DocumentOut)
async def get_document(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DocumentOut:
    doc = await _get_doc_or_404(db, document_id)
    version = await _get_current_version(db, doc)
    extraction = await _get_extraction(db, doc)
    return _doc_out(doc, version, extraction)


@router.get("/{document_id}/preview")
async def preview_document(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    doc = await _get_doc_or_404(db, document_id)
    version = await _get_current_version(db, doc)

    if not version:
        raise HTTPException(status_code=404, detail="No file attached to this document.")

    mime = version.mime_type

    # ── Natively viewable — stream directly ──────────────────────────────────
    if is_natively_viewable(mime):
        return StreamingResponse(
            storage.stream(version.storage_path),
            media_type=mime,
            headers={"Content-Length": str(version.file_size)},
        )

    # ── Office documents — convert to PDF via LibreOffice ────────────────────
    if needs_conversion(mime):
        if not isinstance(storage, LocalStorageAdapter):
            raise HTTPException(status_code=501, detail="Preview conversion is only supported with local storage.")
        source_path = storage.base_path / version.storage_path
        try:
            pdf_path = await convert_to_pdf(source_path, str(version.id), version.file_name)
        except RuntimeError as e:
            logger.error(
                "Conversion failed for document %s (%s): %s",
                document_id, version.file_name, e,
            )
            raise HTTPException(status_code=422, detail=str(e))
        return FileResponse(pdf_path, media_type="application/pdf")

    # ── Not previewable ───────────────────────────────────────────────────────
    raise HTTPException(
        status_code=415,
        detail="This file type cannot be previewed. Use the download button.",
    )


@router.get("/{document_id}/download")
async def download_document(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    doc = await _get_doc_or_404(db, document_id)
    version = await _get_current_version(db, doc)

    if not version:
        raise HTTPException(status_code=404, detail="No file attached to this document.")

    return StreamingResponse(
        storage.stream(version.storage_path),
        media_type=version.mime_type,
        headers={
            "Content-Disposition": f'attachment; filename="{version.file_name}"',
            "Content-Length": str(version.file_size),
        },
    )


@router.patch("/{document_id}/move", response_model=DocumentOut)
async def move_document(
    document_id: str,
    body: DocumentMoveRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentOut:
    doc = await _get_doc_or_404(db, document_id)

    if body.folder_id is None:
        doc.folder_id = None
    else:
        try:
            fid = uuid.UUID(body.folder_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid folder_id.")
        folder_exists = await db.execute(select(Folder).where(Folder.id == fid))
        if not folder_exists.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Folder not found.")
        doc.folder_id = fid

    await db.commit()
    await db.refresh(doc)
    version = await _get_current_version(db, doc)
    extraction = await _get_extraction(db, doc)
    return _doc_out(doc, version, extraction)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    doc = await _get_doc_or_404(db, document_id)
    
    user_role = current_user.role.name if current_user.role else None
    if user_role != "Admin":
        raise HTTPException(status_code=403, detail="Only admins can delete documents")
    
    await db.delete(doc)
    await db.commit()
    
    try:
        from app.services.search import delete_document as search_delete
        search_delete(document_id)
    except Exception as exc:
        logger.warning("[DELETE] Meilisearch deletion failed (non-fatal): %s", exc)


# ── helpers ──────────────────────────────────────────────────────────────────

async def _get_doc_or_404(db: AsyncSession, document_id: str) -> Document:
    try:
        uid = uuid.UUID(document_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Document not found.")
    result = await db.execute(select(Document).where(Document.id == uid))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    return doc


async def _get_current_version(
    db: AsyncSession, doc: Document
) -> DocumentVersion | None:
    if not doc.current_version_id:
        return None
    result = await db.execute(
        select(DocumentVersion).where(DocumentVersion.id == doc.current_version_id)
    )
    return result.scalar_one_or_none()


async def _get_extraction(
    db: AsyncSession, doc: Document
) -> DocumentExtraction | None:
    result = await db.execute(
        select(DocumentExtraction).where(DocumentExtraction.document_id == doc.id)
    )
    return result.scalar_one_or_none()


def _doc_out(
    doc: Document,
    version: DocumentVersion | None,
    extraction: DocumentExtraction | None = None,
) -> DocumentOut:
    return DocumentOut(
        id=str(doc.id),
        title=doc.title,
        status=doc.status,
        folder_id=str(doc.folder_id) if doc.folder_id else None,
        current_version_id=str(doc.current_version_id) if doc.current_version_id else None,
        tags=doc.tags,
        created_at=doc.created_at,
        updated_at=doc.updated_at,
        latest_version=DocumentVersionOut(
            id=str(version.id),
            version_number=version.version_number,
            file_name=version.file_name,
            file_size=version.file_size,
            mime_type=version.mime_type,
            created_at=version.created_at,
        ) if version else None,
        extraction=ExtractionOut(
            document_type=extraction.document_type,
            type_confidence=extraction.type_confidence,
            sensitivity=extraction.sensitivity,
            summary=extraction.summary,
            key_fields=extraction.key_fields,
        ) if extraction else None,
    )


@router.patch("/{document_id}/metadata", response_model=DocumentOut)
async def patch_metadata(
    document_id: str,
    body: MetadataPatchRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentOut:
    doc = await _get_doc_or_404(db, document_id)
    
    user_role = current_user.role.name if current_user.role else None
    if user_role == "uploader":
        raise HTTPException(status_code=403, detail="Uploaders cannot edit metadata")
    
    if body.tags is not None:
        doc.tags = body.tags
    
    if body.document_type is not None or body.sensitivity is not None:
        result = await db.execute(
            select(DocumentExtraction).where(DocumentExtraction.document_id == doc.id)
        )
        extraction = result.scalar_one_or_none()
        if extraction is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Document has no AI extraction yet — cannot edit document_type or sensitivity.",
            )
        if body.document_type is not None:
            extraction.document_type = body.document_type
        if body.sensitivity is not None:
            extraction.sensitivity = body.sensitivity
    
    await db.commit()
    await db.refresh(doc)
    
    version = await _get_current_version(db, doc)
    extraction = await _get_extraction(db, doc)
    return _doc_out(doc, version, extraction)


@router.post("/{document_id}/ask", response_model=AskResponse)
async def ask_document(
    document_id: str,
    body: AskRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AskResponse:
    doc = await _get_doc_or_404(db, document_id)

    answer = await asyncio.to_thread(
        answer_question,
        str(doc.id),
        body.question,
        doc.title,
    )
    return AskResponse(answer=answer, document_id=document_id, question=body.question)
