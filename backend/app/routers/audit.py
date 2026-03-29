from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import or_, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user, require_role
from app.database import get_db
from app.models.audit import AuditLog
from app.models.user import User

router = APIRouter(prefix="/audit", tags=["audit"])

_admin = require_role("Admin")


# ── Schemas ───────────────────────────────────────────────────────────────────

class AuditLogOut(BaseModel):
    id: str
    timestamp: datetime
    user_id: str | None
    user_name: str | None
    action: str
    resource_type: str
    resource_id: str | None
    document_title: str | None   # pulled from metadata_ when present
    ip_address: str | None
    metadata: dict[str, Any]


class AuditLogPage(BaseModel):
    items: list[AuditLogOut]
    total: int
    page: int
    page_size: int


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("", response_model=AuditLogPage, dependencies=[Depends(_admin)])
async def list_audit_logs(
    q: str | None = Query(None, description="Free-text search on document title or user name"),
    action: str | None = Query(None),
    resource_type: str | None = Query(None),
    user_id: str | None = Query(None),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    base = (
        select(AuditLog, User.name.label("user_name"))
        .outerjoin(User, AuditLog.user_id == User.id)
    )

    if q:
        term = f"%{q.lower()}%"
        base = base.where(
            or_(
                func.lower(AuditLog.metadata_["title"].as_string()).like(term),
                func.lower(User.name).like(term),
            )
        )
    if action:
        base = base.where(AuditLog.action == action)
    if resource_type:
        base = base.where(AuditLog.resource_type == resource_type)
    if user_id:
        base = base.where(AuditLog.user_id == user_id)
    if date_from:
        base = base.where(AuditLog.created_at >= date_from)
    if date_to:
        base = base.where(AuditLog.created_at <= date_to)

    # total count
    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar_one()

    # paginated rows, newest first
    rows_q = (
        base
        .order_by(AuditLog.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = (await db.execute(rows_q)).all()

    items = [
        AuditLogOut(
            id=str(row.AuditLog.id),
            timestamp=row.AuditLog.created_at,
            user_id=str(row.AuditLog.user_id) if row.AuditLog.user_id else None,
            user_name=row.user_name,
            action=row.AuditLog.action,
            resource_type=row.AuditLog.resource_type,
            resource_id=str(row.AuditLog.resource_id) if row.AuditLog.resource_id else None,
            document_title=row.AuditLog.metadata_.get("title") or row.AuditLog.metadata_.get("file_name"),
            ip_address=row.AuditLog.ip_address,
            metadata=row.AuditLog.metadata_,
        )
        for row in rows
    ]

    return AuditLogPage(items=items, total=total, page=page, page_size=page_size)


@router.get("/actions", dependencies=[Depends(_admin)])
async def list_actions(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    """Returns the distinct action values present in the log — used to populate the filter dropdown."""
    result = await db.execute(
        select(AuditLog.action).distinct().order_by(AuditLog.action)
    )
    return result.scalars().all()


@router.get("/users", dependencies=[Depends(_admin)])
async def list_active_users(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    """Returns users who appear in the audit log — used to populate the user filter dropdown."""
    result = await db.execute(
        select(User.id, User.name)
        .where(User.id.in_(select(AuditLog.user_id).where(AuditLog.user_id.isnot(None)).distinct()))
        .order_by(User.name)
    )
    return [{"id": str(r.id), "name": r.name} for r in result.all()]
