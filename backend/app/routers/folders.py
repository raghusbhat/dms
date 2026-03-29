import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.models.document import Document, Folder
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/folders", tags=["folders"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class FolderOut(BaseModel):
    id: str
    name: str
    parent_id: str | None
    document_count: int
    children: list["FolderOut"]


FolderOut.model_rebuild()


class FolderCreate(BaseModel):
    name: str
    parent_id: str | None = None


class FolderRename(BaseModel):
    name: str


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_folder_or_404(db: AsyncSession, folder_id: str) -> Folder:
    try:
        uid = uuid.UUID(folder_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Folder not found.")
    result = await db.execute(select(Folder).where(Folder.id == uid))
    folder = result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found.")
    return folder


async def _get_doc_counts(db: AsyncSession) -> dict[str, int]:
    """Return {folder_id_str: document_count} for all folders."""
    rows = await db.execute(
        select(Document.folder_id, func.count(Document.id))
        .where(Document.folder_id.isnot(None))
        .group_by(Document.folder_id)
    )
    return {str(folder_id): count for folder_id, count in rows.all()}


def _build_tree(
    folders: list[Folder],
    doc_counts: dict[str, int],
    parent_id: uuid.UUID | None = None,
) -> list[FolderOut]:
    """Recursively build folder tree from flat list."""
    result = []
    for f in folders:
        if f.parent_id == parent_id:
            children = _build_tree(folders, doc_counts, f.id)
            result.append(FolderOut(
                id=str(f.id),
                name=f.name,
                parent_id=str(f.parent_id) if f.parent_id else None,
                document_count=doc_counts.get(str(f.id), 0),
                children=children,
            ))
    return result


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[FolderOut])
async def list_folders(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[FolderOut]:
    """Return full folder tree with document counts."""
    result = await db.execute(select(Folder).order_by(Folder.name))
    folders = list(result.scalars().all())
    doc_counts = await _get_doc_counts(db)
    return _build_tree(folders, doc_counts, parent_id=None)


@router.post("", response_model=FolderOut, status_code=status.HTTP_201_CREATED)
async def create_folder(
    body: FolderCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FolderOut:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Folder name cannot be empty.")

    parent_uuid: uuid.UUID | None = None
    if body.parent_id:
        # Validate parent exists
        await _get_folder_or_404(db, body.parent_id)
        parent_uuid = uuid.UUID(body.parent_id)

    # Check for duplicate name under same parent
    existing = await db.execute(
        select(Folder).where(
            Folder.name == name,
            Folder.parent_id == parent_uuid,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail=f"A folder named '{name}' already exists here.",
        )

    folder = Folder(
        name=name,
        parent_id=parent_uuid,
        created_by=current_user.id,
    )
    db.add(folder)
    await db.commit()
    await db.refresh(folder)

    logger.info("[FOLDER] Created '%s' id=%s by user=%s", name, folder.id, current_user.id)
    return FolderOut(
        id=str(folder.id),
        name=folder.name,
        parent_id=str(folder.parent_id) if folder.parent_id else None,
        document_count=0,
        children=[],
    )


@router.patch("/{folder_id}", response_model=FolderOut)
async def rename_folder(
    folder_id: str,
    body: FolderRename,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FolderOut:
    user_role = current_user.role.name if current_user.role else None
    if user_role != "Admin":
        raise HTTPException(status_code=403, detail="Only admins can rename folders.")

    folder = await _get_folder_or_404(db, folder_id)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Folder name cannot be empty.")

    # Check duplicate name in same parent
    existing = await db.execute(
        select(Folder).where(
            Folder.name == name,
            Folder.parent_id == folder.parent_id,
            Folder.id != folder.id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail=f"A folder named '{name}' already exists here.",
        )

    folder.name = name
    await db.commit()
    await db.refresh(folder)

    doc_counts = await _get_doc_counts(db)
    return FolderOut(
        id=str(folder.id),
        name=folder.name,
        parent_id=str(folder.parent_id) if folder.parent_id else None,
        document_count=doc_counts.get(str(folder.id), 0),
        children=[],
    )


@router.delete("/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_folder(
    folder_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    user_role = current_user.role.name if current_user.role else None
    if user_role != "Admin":
        raise HTTPException(status_code=403, detail="Only admins can delete folders.")

    folder = await _get_folder_or_404(db, folder_id)
    uid = uuid.UUID(folder_id)

    # Block delete if folder has documents
    doc_count_result = await db.execute(
        select(func.count(Document.id)).where(Document.folder_id == uid)
    )
    doc_count = doc_count_result.scalar_one()
    if doc_count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete folder — it contains {doc_count} document(s). Move or delete them first.",
        )

    # Block delete if folder has sub-folders
    child_count_result = await db.execute(
        select(func.count(Folder.id)).where(Folder.parent_id == uid)
    )
    child_count = child_count_result.scalar_one()
    if child_count > 0:
        raise HTTPException(
            status_code=409,
            detail="Cannot delete folder — it contains sub-folders. Delete them first.",
        )

    await db.delete(folder)
    await db.commit()
    logger.info("[FOLDER] Deleted id=%s by user=%s", folder_id, current_user.id)
