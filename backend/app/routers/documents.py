import logging
import mimetypes
import uuid
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.config import settings
from app.conversion.libreoffice import (
    convert_to_pdf,
    is_natively_viewable,
    needs_conversion,
)
from app.database import get_db
from app.models.document import Document, DocumentVersion
from app.models.user import User
from app.storage.local import LocalStorageAdapter
from app.storage.registry import storage

router = APIRouter(prefix="/documents", tags=["documents"])

MAX_UPLOAD_BYTES = 500 * 1024 * 1024  # 500 MB


class DocumentVersionOut(BaseModel):
    id: str
    version_number: int
    file_name: str
    file_size: int
    mime_type: str
    created_at: datetime


class DocumentOut(BaseModel):
    id: str
    title: str
    folder_id: str | None
    current_version_id: str | None
    created_at: datetime
    updated_at: datetime
    latest_version: DocumentVersionOut | None


@router.post("/upload", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile,
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

    # Create document record
    doc = Document(
        title=file.filename,
        created_by=current_user.id,
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

    return _doc_out(doc, version)


@router.get("", response_model=list[DocumentOut])
async def list_documents(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[DocumentOut]:
    result = await db.execute(
        select(Document).order_by(Document.updated_at.desc())
    )
    docs = result.scalars().all()

    out = []
    for doc in docs:
        version = await _get_current_version(db, doc)
        out.append(_doc_out(doc, version))
    return out


@router.get("/{document_id}", response_model=DocumentOut)
async def get_document(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DocumentOut:
    doc = await _get_doc_or_404(db, document_id)
    version = await _get_current_version(db, doc)
    return _doc_out(doc, version)


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


def _doc_out(doc: Document, version: DocumentVersion | None) -> DocumentOut:
    return DocumentOut(
        id=str(doc.id),
        title=doc.title,
        folder_id=str(doc.folder_id) if doc.folder_id else None,
        current_version_id=str(doc.current_version_id) if doc.current_version_id else None,
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
    )
