import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Float, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, new_uuid


class DocumentExtraction(Base, TimestampMixin):
    __tablename__ = "document_extractions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=new_uuid
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    document_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    type_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    key_fields: Mapped[dict] = mapped_column(JSONB, server_default="{}", nullable=False)
    sensitivity: Mapped[str | None] = mapped_column(String(20), nullable=True)
    risk_level: Mapped[str | None] = mapped_column(String(10), nullable=True)
    risk_flags: Mapped[list] = mapped_column(JSONB, server_default="[]", nullable=False)
    gatekeeper_passed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    gatekeeper_issues: Mapped[list] = mapped_column(JSONB, server_default="[]", nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    extracted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    document: Mapped["Document"] = relationship("Document", back_populates="extraction")  # type: ignore[name-defined]
