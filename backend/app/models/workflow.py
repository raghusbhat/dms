import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, new_uuid


class WorkflowRule(Base, TimestampMixin):
    __tablename__ = "workflow_rules"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=new_uuid
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    document_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    sensitivity: Mapped[str | None] = mapped_column(String(50), nullable=True)
    assign_to_role: Mapped[str] = mapped_column(String(50), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=func.true())

    instances: Mapped[list["WorkflowInstance"]] = relationship(
        "WorkflowInstance", back_populates="rule"
    )


class WorkflowInstance(Base, TimestampMixin):
    __tablename__ = "workflow_instances"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=new_uuid
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    rule_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("workflow_rules.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(50), nullable=False, server_default="pending")

    document: Mapped["Document"] = relationship("Document", back_populates="workflow_instance")  # type: ignore[name-defined]
    rule: Mapped["WorkflowRule | None"] = relationship("WorkflowRule", back_populates="instances")
    tasks: Mapped[list["WorkflowTask"]] = relationship(
        "WorkflowTask", back_populates="instance", cascade="all, delete-orphan"
    )


class WorkflowTask(Base, TimestampMixin):
    __tablename__ = "workflow_tasks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=new_uuid
    )
    instance_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("workflow_instances.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    assigned_to: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    status: Mapped[str] = mapped_column(String(50), nullable=False, server_default="pending")
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    instance: Mapped["WorkflowInstance"] = relationship("WorkflowInstance", back_populates="tasks")
    user: Mapped["User"] = relationship("User", back_populates="workflow_tasks")  # type: ignore[name-defined]
