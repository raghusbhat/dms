import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.auth.dependencies import get_current_user, require_role
from app.database import get_db
from app.models.document import Document
from app.models.extraction import DocumentExtraction
from app.models.user import User
from app.models.workflow import WorkflowRule, WorkflowInstance, WorkflowTask

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workflow", tags=["workflow"])


class WorkflowTaskOut(BaseModel):
    id: str
    instance_id: str
    document_id: str
    document_title: str
    document_type: str | None
    sensitivity: str | None
    rule_name: str | None
    status: str
    comment: str | None
    created_at: datetime


class WorkflowRuleOut(BaseModel):
    id: str
    name: str
    document_type: str | None
    sensitivity: str | None
    assign_to_role: str
    is_active: bool
    created_at: datetime


class WorkflowRuleCreate(BaseModel):
    name: str
    document_type: str | None = None
    sensitivity: str | None = None
    assign_to_role: str


class WorkflowRuleUpdate(BaseModel):
    name: str | None = None
    document_type: str | None = None
    sensitivity: str | None = None
    assign_to_role: str | None = None
    is_active: bool | None = None


class TaskComment(BaseModel):
    comment: str | None = None


@router.get("/queue", response_model=list[WorkflowTaskOut])
async def get_reviewer_queue(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("reviewer", "Admin")),
    q: str | None = None,
    document_type: str | None = None,
    sensitivity: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> list[WorkflowTaskOut]:
    result = await db.execute(
        select(WorkflowTask)
        .options(
            joinedload(WorkflowTask.instance)
            .joinedload(WorkflowInstance.document)
            .joinedload(Document.extraction),
            joinedload(WorkflowTask.instance)
            .joinedload(WorkflowInstance.rule),
        )
        .where(WorkflowTask.assigned_to == current_user.id)
        .where(WorkflowTask.status == "pending")
        .order_by(WorkflowTask.created_at)
    )
    tasks = result.unique().scalars().all()

    out = []
    for task in tasks:
        extraction = task.instance.document.extraction
        doc_type = extraction.document_type if extraction else None
        doc_sensitivity = extraction.sensitivity if extraction else None

        # Python-side filtering (queue is always small — one reviewer's pending tasks)
        if q and q.lower() not in task.instance.document.title.lower():
            continue
        if document_type and doc_type != document_type:
            continue
        if sensitivity and doc_sensitivity != sensitivity:
            continue
        if date_from and task.created_at < date_from:
            continue
        if date_to and task.created_at > date_to:
            continue

        out.append(WorkflowTaskOut(
            id=str(task.id),
            instance_id=str(task.instance_id),
            document_id=str(task.instance.document_id),
            document_title=task.instance.document.title,
            document_type=doc_type,
            sensitivity=doc_sensitivity,
            rule_name=task.instance.rule.name if task.instance.rule else None,
            status=task.status,
            comment=task.comment,
            created_at=task.created_at,
        ))
    return out


@router.post("/tasks/{task_id}/approve", response_model=WorkflowTaskOut)
async def approve_task(
    task_id: str,
    body: TaskComment,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("reviewer", "Admin")),
) -> WorkflowTaskOut:
    task = await _get_task_or_404(db, task_id)
    if task.assigned_to != current_user.id:
        raise HTTPException(status_code=403, detail="Task not assigned to you")
    if task.status != "pending":
        raise HTTPException(status_code=400, detail="Task is not pending")

    task.status = "approved"
    task.comment = body.comment
    task.updated_at = datetime.now(timezone.utc)

    task.instance.status = "approved"
    task.instance.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(task)

    extraction = task.instance.document.extraction
    return WorkflowTaskOut(
        id=str(task.id),
        instance_id=str(task.instance_id),
        document_id=str(task.instance.document_id),
        document_title=task.instance.document.title,
        document_type=extraction.document_type if extraction else None,
        sensitivity=extraction.sensitivity if extraction else None,
        rule_name=task.instance.rule.name if task.instance.rule else None,
        status=task.status,
        comment=task.comment,
        created_at=task.created_at,
    )


@router.post("/tasks/{task_id}/reject", response_model=WorkflowTaskOut)
async def reject_task(
    task_id: str,
    body: TaskComment,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("reviewer", "Admin")),
) -> WorkflowTaskOut:
    if not body.comment:
        raise HTTPException(status_code=422, detail="Comment is required for rejection")

    task = await _get_task_or_404(db, task_id)
    if task.assigned_to != current_user.id:
        raise HTTPException(status_code=403, detail="Task not assigned to you")
    if task.status != "pending":
        raise HTTPException(status_code=400, detail="Task is not pending")

    task.status = "rejected"
    task.comment = body.comment
    task.updated_at = datetime.now()

    task.instance.status = "rejected"
    task.instance.updated_at = datetime.now()

    await db.commit()
    await db.refresh(task)

    extraction = task.instance.document.extraction
    return WorkflowTaskOut(
        id=str(task.id),
        instance_id=str(task.instance_id),
        document_id=str(task.instance.document_id),
        document_title=task.instance.document.title,
        document_type=extraction.document_type if extraction else None,
        sensitivity=extraction.sensitivity if extraction else None,
        rule_name=task.instance.rule.name if task.instance.rule else None,
        status=task.status,
        comment=task.comment,
        created_at=task.created_at,
    )


@router.post("/tasks/{task_id}/return", response_model=WorkflowTaskOut)
async def return_task(
    task_id: str,
    body: TaskComment,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("reviewer", "Admin")),
) -> WorkflowTaskOut:
    if not body.comment:
        raise HTTPException(status_code=422, detail="Comment is required for return")

    task = await _get_task_or_404(db, task_id)
    if task.assigned_to != current_user.id:
        raise HTTPException(status_code=403, detail="Task not assigned to you")
    if task.status != "pending":
        raise HTTPException(status_code=400, detail="Task is not pending")

    task.status = "returned"
    task.comment = body.comment
    task.updated_at = datetime.now()

    task.instance.status = "returned"
    task.instance.updated_at = datetime.now()

    await db.commit()
    await db.refresh(task)

    extraction = task.instance.document.extraction
    return WorkflowTaskOut(
        id=str(task.id),
        instance_id=str(task.instance_id),
        document_id=str(task.instance.document_id),
        document_title=task.instance.document.title,
        document_type=extraction.document_type if extraction else None,
        sensitivity=extraction.sensitivity if extraction else None,
        rule_name=task.instance.rule.name if task.instance.rule else None,
        status=task.status,
        comment=task.comment,
        created_at=task.created_at,
    )


@router.get("/admin/rules", response_model=list[WorkflowRuleOut])
async def list_workflow_rules(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("Admin")),
) -> list[WorkflowRuleOut]:
    result = await db.execute(
        select(WorkflowRule).order_by(WorkflowRule.created_at)
    )
    rules = result.scalars().all()

    return [
        WorkflowRuleOut(
            id=str(rule.id),
            name=rule.name,
            document_type=rule.document_type,
            sensitivity=rule.sensitivity,
            assign_to_role=rule.assign_to_role,
            is_active=rule.is_active,
            created_at=rule.created_at,
        )
        for rule in rules
    ]


@router.post("/admin/rules", response_model=WorkflowRuleOut, status_code=201)
async def create_workflow_rule(
    body: WorkflowRuleCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("Admin")),
) -> WorkflowRuleOut:
    rule = WorkflowRule(
        name=body.name,
        document_type=body.document_type,
        sensitivity=body.sensitivity,
        assign_to_role=body.assign_to_role,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)

    return WorkflowRuleOut(
        id=str(rule.id),
        name=rule.name,
        document_type=rule.document_type,
        sensitivity=rule.sensitivity,
        assign_to_role=rule.assign_to_role,
        is_active=rule.is_active,
        created_at=rule.created_at,
    )


@router.patch("/admin/rules/{rule_id}", response_model=WorkflowRuleOut)
async def update_workflow_rule(
    rule_id: str,
    body: WorkflowRuleUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("Admin")),
) -> WorkflowRuleOut:
    rule = await _get_rule_or_404(db, rule_id)

    if body.name is not None:
        rule.name = body.name
    if body.document_type is not None:
        rule.document_type = body.document_type
    if body.sensitivity is not None:
        rule.sensitivity = body.sensitivity
    if body.assign_to_role is not None:
        rule.assign_to_role = body.assign_to_role
    if body.is_active is not None:
        rule.is_active = body.is_active

    await db.commit()
    await db.refresh(rule)

    return WorkflowRuleOut(
        id=str(rule.id),
        name=rule.name,
        document_type=rule.document_type,
        sensitivity=rule.sensitivity,
        assign_to_role=rule.assign_to_role,
        is_active=rule.is_active,
        created_at=rule.created_at,
    )


async def _get_task_or_404(db: AsyncSession, task_id: str) -> WorkflowTask:
    try:
        uid = uuid.UUID(task_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(WorkflowTask)
        .options(
            joinedload(WorkflowTask.instance)
            .joinedload(WorkflowInstance.document)
            .joinedload(Document.extraction),
            joinedload(WorkflowTask.instance)
            .joinedload(WorkflowInstance.rule),
        )
        .where(WorkflowTask.id == uid)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


async def _get_rule_or_404(db: AsyncSession, rule_id: str) -> WorkflowRule:
    try:
        uid = uuid.UUID(rule_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Rule not found")

    result = await db.execute(
        select(WorkflowRule).where(WorkflowRule.id == uid)
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    return rule
