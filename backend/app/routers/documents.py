import hashlib
import logging
import mimetypes
import uuid
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request, UploadFile, status
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
from app.models.audit import AuditLog
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
    checksum: str | None = None
    change_note: str | None = None
    uploaded_by_name: str | None = None
    created_at: datetime


class VersionHistoryOut(BaseModel):
    versions: list[DocumentVersionOut]
    current_version_id: str | None


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
    deleted_at: datetime | None = None
    deleted_by: str | None = None


class TrashItemOut(BaseModel):
    id: str
    title: str
    status: str
    folder_id: str | None
    tags: list[str]
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime
    deleted_by: str | None
    deleted_by_name: str | None
    latest_version: DocumentVersionOut | None


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
    request: Request,
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

    checksum = hashlib.sha256(data).hexdigest()

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

    # Duplicate detection — exact content match (same checksum, same folder)
    dup_q = (
        select(Document)
        .join(DocumentVersion, DocumentVersion.document_id == Document.id)
        .where(DocumentVersion.checksum == checksum)
    )
    if folder_uuid:
        dup_q = dup_q.where(Document.folder_id == folder_uuid)
    else:
        dup_q = dup_q.where(Document.folder_id.is_(None))
    dup_result = await db.execute(dup_q.limit(1))
    existing_dup = dup_result.scalar_one_or_none()
    if existing_dup:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "exact_duplicate",
                "message": "This exact file already exists in this location.",
                "existing_document_id": str(existing_dup.id),
            },
        )

    # Duplicate detection — same filename in same folder (different content → suggest new version)
    name_q = select(Document).where(Document.title == file.filename)
    if folder_uuid:
        name_q = name_q.where(Document.folder_id == folder_uuid)
    else:
        name_q = name_q.where(Document.folder_id.is_(None))
    name_result = await db.execute(name_q.limit(1))
    existing_name = name_result.scalar_one_or_none()
    if existing_name:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "filename_exists",
                "message": "A document with this name already exists here. Upload as a new version instead.",
                "existing_document_id": str(existing_name.id),
            },
        )

    file_id = str(uuid.uuid4())
    storage_path = await storage.save(file_id, data)

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
        checksum=checksum,
        uploaded_by=current_user.id,
    )
    db.add(version)
    await db.flush()  # get version.id

    doc.current_version_id = version.id

    db.add(AuditLog(
        user_id=current_user.id,
        action="upload",
        resource_type="document",
        resource_id=doc.id,
        ip_address=request.client.host if request.client else None,
        metadata_={"title": doc.title, "file_name": file.filename, "version_number": 1},
    ))

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
        q_obj = q_obj.where(Document.deleted_at.is_(None))
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


@router.get("/trash", response_model=list[TrashItemOut])
async def list_trash(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[TrashItemOut]:
    """List all soft-deleted documents. Admin only."""
    user_role = current_user.role.name if current_user.role else None
    if user_role != "Admin":
        raise HTTPException(status_code=403, detail="Only admins can view the trash.")

    result = await db.execute(
        select(Document, User.name)
        .join(User, Document.deleted_by == User.id, isouter=True)
        .where(Document.deleted_at.isnot(None))
        .order_by(Document.deleted_at.desc())
    )
    rows = result.all()

    out = []
    for doc, deleter_name in rows:
        version = await _get_current_version(db, doc)
        out.append(TrashItemOut(
            id=str(doc.id),
            title=doc.title,
            status=doc.status,
            folder_id=str(doc.folder_id) if doc.folder_id else None,
            tags=doc.tags,
            created_at=doc.created_at,
            updated_at=doc.updated_at,
            deleted_at=doc.deleted_at,
            deleted_by=str(doc.deleted_by) if doc.deleted_by else None,
            deleted_by_name=deleter_name,
            latest_version=DocumentVersionOut(
                id=str(version.id),
                version_number=version.version_number,
                file_name=version.file_name,
                file_size=version.file_size,
                mime_type=version.mime_type,
                checksum=version.checksum,
                change_note=version.change_note,
                created_at=version.created_at,
            ) if version else None,
        ))
    return out


@router.get("/{document_id}", response_model=DocumentOut)
async def get_document(
    document_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DocumentOut:
    doc = await _get_doc_or_404(db, document_id)
    version = await _get_current_version(db, doc)
    extraction = await _get_extraction(db, doc)
    db.add(AuditLog(
        user_id=current_user.id,
        action="view",
        resource_type="document",
        resource_id=doc.id,
        ip_address=request.client.host if request.client else None,
        metadata_={"title": doc.title},
    ))
    await db.commit()
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
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    doc = await _get_doc_or_404(db, document_id)
    version = await _get_current_version(db, doc)

    if not version:
        raise HTTPException(status_code=404, detail="No file attached to this document.")

    db.add(AuditLog(
        user_id=current_user.id,
        action="download",
        resource_type="document",
        resource_id=doc.id,
        ip_address=request.client.host if request.client else None,
        metadata_={"title": doc.title, "file_name": version.file_name, "version_number": version.version_number},
    ))
    await db.commit()

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
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Soft-delete: moves document to Trash. Any authenticated user can delete."""
    doc = await _get_doc_or_404(db, document_id)

    doc.deleted_at = datetime.now(timezone.utc)
    doc.deleted_by = current_user.id

    db.add(AuditLog(
        user_id=current_user.id,
        action="soft_delete",
        resource_type="document",
        resource_id=doc.id,
        ip_address=request.client.host if request.client else None,
        metadata_={"title": doc.title},
    ))
    await db.commit()

    try:
        from app.services.search import delete_document as search_delete
        search_delete(document_id)
    except Exception as exc:
        logger.warning("[SOFT-DELETE] Meilisearch removal failed (non-fatal): %s", exc)


@router.patch("/trash/{document_id}/restore", response_model=DocumentOut)
async def restore_document(
    document_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DocumentOut:
    """Restore a soft-deleted document. Admin only."""
    user_role = current_user.role.name if current_user.role else None
    if user_role != "Admin":
        raise HTTPException(status_code=403, detail="Only admins can restore documents.")

    doc = await _get_doc_or_404(db, document_id, include_deleted=True)
    if not doc.deleted_at:
        raise HTTPException(status_code=400, detail="Document is not in the trash.")

    doc.deleted_at = None
    doc.deleted_by = None

    db.add(AuditLog(
        user_id=current_user.id,
        action="restore",
        resource_type="document",
        resource_id=doc.id,
        ip_address=request.client.host if request.client else None,
        metadata_={"title": doc.title},
    ))
    await db.commit()
    await db.refresh(doc)

    # Re-index in Meilisearch
    try:
        from app.services.search import index_document as search_index
        from app.models.extraction import DocumentExtraction
        ext_result = await db.execute(
            select(DocumentExtraction).where(DocumentExtraction.document_id == doc.id)
        )
        extraction = ext_result.scalar_one_or_none()
        version = await _get_current_version(db, doc)
        search_index(
            doc_id=str(doc.id),
            title=doc.title,
            document_type=extraction.document_type if extraction else None,
            sensitivity=extraction.sensitivity if extraction else None,
            status=doc.status,
            tags=doc.tags,
            summary=extraction.summary if extraction else None,
            extracted_text=None,
            updated_at=doc.updated_at.isoformat(),
            created_at=doc.created_at.isoformat(),
        )
    except Exception as exc:
        logger.warning("[RESTORE] Meilisearch re-index failed (non-fatal): %s", exc)

    version = await _get_current_version(db, doc)
    extraction = await _get_extraction(db, doc)
    return _doc_out(doc, version, extraction)


@router.delete("/trash/{document_id}/permanent", status_code=status.HTTP_204_NO_CONTENT)
async def permanent_delete(
    document_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Permanently delete a document. Admin only. Document must already be in trash."""
    user_role = current_user.role.name if current_user.role else None
    if user_role != "Admin":
        raise HTTPException(status_code=403, detail="Only admins can permanently delete documents.")

    doc = await _get_doc_or_404(db, document_id, include_deleted=True)
    if not doc.deleted_at:
        raise HTTPException(
            status_code=400,
            detail="Document must be moved to trash before permanent deletion.",
        )

    db.add(AuditLog(
        user_id=current_user.id,
        action="permanent_delete",
        resource_type="document",
        resource_id=doc.id,
        ip_address=request.client.host if request.client else None,
        metadata_={"title": doc.title},
    ))

    await db.delete(doc)
    await db.commit()

    try:
        from app.services.search import delete_document as search_delete
        search_delete(document_id)
    except Exception as exc:
        logger.warning("[PERM-DELETE] Meilisearch removal failed (non-fatal): %s", exc)


# ── Version control endpoints ─────────────────────────────────────────────────

@router.post("/{document_id}/versions", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_new_version(
    document_id: str,
    file: UploadFile,
    request: Request,
    change_note: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DocumentOut:
    doc = await _get_doc_or_404(db, document_id)

    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File exceeds the 500 MB limit.")
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File must have a name.")

    checksum = hashlib.sha256(data).hexdigest()

    # Check if this exact content already exists as a version of this document
    existing_v = await db.execute(
        select(DocumentVersion)
        .where(DocumentVersion.document_id == doc.id)
        .where(DocumentVersion.checksum == checksum)
        .limit(1)
    )
    if existing_v.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "exact_duplicate",
                "message": "This file is identical to an existing version of this document.",
            },
        )

    # Get next version number
    count_result = await db.execute(
        select(func.count()).select_from(DocumentVersion).where(DocumentVersion.document_id == doc.id)
    )
    next_number = (count_result.scalar_one() or 0) + 1

    mime_type = (
        file.content_type
        or mimetypes.guess_type(file.filename)[0]
        or "application/octet-stream"
    )

    file_id = str(uuid.uuid4())
    storage_path = await storage.save(file_id, data)

    version = DocumentVersion(
        document_id=doc.id,
        version_number=next_number,
        storage_path=storage_path,
        file_name=file.filename,
        file_size=len(data),
        mime_type=mime_type,
        checksum=checksum,
        change_note=change_note,
        uploaded_by=current_user.id,
    )
    db.add(version)
    await db.flush()

    doc.current_version_id = version.id

    db.add(AuditLog(
        user_id=current_user.id,
        action="new_version",
        resource_type="document",
        resource_id=doc.id,
        ip_address=request.client.host if request.client else None,
        metadata_={
            "title": doc.title,
            "version_number": next_number,
            "file_name": file.filename,
            "change_note": change_note,
        },
    ))

    await db.commit()
    await db.refresh(doc)
    await db.refresh(version)

    extraction = await _get_extraction(db, doc)
    return _doc_out(doc, version, extraction)


@router.get("/{document_id}/versions", response_model=VersionHistoryOut)
async def list_versions(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> VersionHistoryOut:
    doc = await _get_doc_or_404(db, document_id)

    result = await db.execute(
        select(DocumentVersion, User.name)
        .join(User, DocumentVersion.uploaded_by == User.id, isouter=True)
        .where(DocumentVersion.document_id == doc.id)
        .order_by(DocumentVersion.version_number.desc())
    )
    rows = result.all()

    versions = [
        DocumentVersionOut(
            id=str(v.id),
            version_number=v.version_number,
            file_name=v.file_name,
            file_size=v.file_size,
            mime_type=v.mime_type,
            checksum=v.checksum,
            change_note=v.change_note,
            uploaded_by_name=uploader_name,
            created_at=v.created_at,
        )
        for v, uploader_name in rows
    ]

    return VersionHistoryOut(
        versions=versions,
        current_version_id=str(doc.current_version_id) if doc.current_version_id else None,
    )


@router.get("/{document_id}/versions/{version_id}/download")
async def download_version(
    document_id: str,
    version_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    doc = await _get_doc_or_404(db, document_id)
    version = await _get_version_or_404(db, doc.id, version_id)

    db.add(AuditLog(
        user_id=current_user.id,
        action="download",
        resource_type="document",
        resource_id=doc.id,
        ip_address=request.client.host if request.client else None,
        metadata_={"title": doc.title, "file_name": version.file_name, "version_number": version.version_number},
    ))
    await db.commit()

    return StreamingResponse(
        storage.stream(version.storage_path),
        media_type=version.mime_type,
        headers={
            "Content-Disposition": f'attachment; filename="{version.file_name}"',
            "Content-Length": str(version.file_size),
        },
    )


@router.get("/{document_id}/versions/{version_id}/preview")
async def preview_version(
    document_id: str,
    version_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    doc = await _get_doc_or_404(db, document_id)
    version = await _get_version_or_404(db, doc.id, version_id)
    mime = version.mime_type

    if is_natively_viewable(mime):
        return StreamingResponse(
            storage.stream(version.storage_path),
            media_type=mime,
            headers={"Content-Length": str(version.file_size)},
        )

    if needs_conversion(mime):
        if not isinstance(storage, LocalStorageAdapter):
            raise HTTPException(status_code=501, detail="Preview conversion is only supported with local storage.")
        source_path = storage.base_path / version.storage_path
        try:
            pdf_path = await convert_to_pdf(source_path, str(version.id), version.file_name)
        except RuntimeError as e:
            raise HTTPException(status_code=422, detail=str(e))
        return FileResponse(pdf_path, media_type="application/pdf")

    raise HTTPException(status_code=415, detail="This file type cannot be previewed. Use the download button.")


@router.patch("/{document_id}/versions/{version_id}/restore", response_model=DocumentOut)
async def restore_version(
    document_id: str,
    version_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DocumentOut:
    user_role = current_user.role.name if current_user.role else None
    if user_role != "Admin":
        raise HTTPException(status_code=403, detail="Only admins can restore document versions.")

    doc = await _get_doc_or_404(db, document_id)
    version = await _get_version_or_404(db, doc.id, version_id)

    prev_version_id = doc.current_version_id
    doc.current_version_id = version.id

    db.add(AuditLog(
        user_id=current_user.id,
        action="restore_version",
        resource_type="document",
        resource_id=doc.id,
        ip_address=request.client.host if request.client else None,
        metadata_={
            "title": doc.title,
            "restored_version_id": str(version.id),
            "restored_version_number": version.version_number,
            "previous_version_id": str(prev_version_id) if prev_version_id else None,
        },
    ))

    await db.commit()
    await db.refresh(doc)

    extraction = await _get_extraction(db, doc)
    return _doc_out(doc, version, extraction)


# ── helpers ──────────────────────────────────────────────────────────────────

async def _get_doc_or_404(db: AsyncSession, document_id: str, include_deleted: bool = False) -> Document:
    try:
        uid = uuid.UUID(document_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Document not found.")
    q = select(Document).where(Document.id == uid)
    if not include_deleted:
        q = q.where(Document.deleted_at.is_(None))
    result = await db.execute(q)
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


async def _get_version_or_404(
    db: AsyncSession, document_id: uuid.UUID, version_id: str
) -> DocumentVersion:
    try:
        vid = uuid.UUID(version_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Version not found.")
    result = await db.execute(
        select(DocumentVersion)
        .where(DocumentVersion.id == vid)
        .where(DocumentVersion.document_id == document_id)
    )
    version = result.scalar_one_or_none()
    if not version:
        raise HTTPException(status_code=404, detail="Version not found.")
    return version


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
            checksum=version.checksum,
            change_note=version.change_note,
            created_at=version.created_at,
        ) if version else None,
        extraction=ExtractionOut(
            document_type=extraction.document_type,
            type_confidence=extraction.type_confidence,
            sensitivity=extraction.sensitivity,
            summary=extraction.summary,
            key_fields=extraction.key_fields,
        ) if extraction else None,
        deleted_at=doc.deleted_at,
        deleted_by=str(doc.deleted_by) if doc.deleted_by else None,
    )


@router.patch("/{document_id}/metadata", response_model=DocumentOut)
async def patch_metadata(
    document_id: str,
    body: MetadataPatchRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentOut:
    doc = await _get_doc_or_404(db, document_id)

    user_role = current_user.role.name if current_user.role else None
    if user_role == "uploader":
        raise HTTPException(status_code=403, detail="Uploaders cannot edit metadata")

    changes: dict = {}

    if body.tags is not None:
        changes["tags"] = {"old": list(doc.tags), "new": body.tags}
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
            changes["document_type"] = {"old": extraction.document_type, "new": body.document_type}
            extraction.document_type = body.document_type
        if body.sensitivity is not None:
            changes["sensitivity"] = {"old": extraction.sensitivity, "new": body.sensitivity}
            extraction.sensitivity = body.sensitivity

    if changes:
        db.add(AuditLog(
            user_id=current_user.id,
            action="metadata_change",
            resource_type="document",
            resource_id=doc.id,
            ip_address=request.client.host if request.client else None,
            metadata_={"title": doc.title, "changes": changes},
        ))

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
