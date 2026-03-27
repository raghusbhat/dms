import logging
import os
import uuid
from datetime import datetime, timezone

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.models.document import Document, DocumentVersion
from app.models.extraction import DocumentExtraction
from app.models.workflow import WorkflowRule, WorkflowInstance, WorkflowTask
from app.models.user import Role, User
from app.services.extraction import extract_text
from app.services.ner import extract_entities
from app.services.ai import classify_document
from app.services.search import index_document as search_index_document
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)

_db_url = settings.database_url.replace("postgresql+asyncpg://", "postgresql+psycopg2://")
_engine = create_engine(_db_url, pool_pre_ping=True)
_SessionLocal = sessionmaker(bind=_engine, autocommit=False, autoflush=False)


@celery_app.task(name="app.workers.extraction_worker.process_document", bind=True)
def process_document(self, document_id: str) -> None:
    logger.info("[WORKER] process_document started — document_id=%s", document_id)
    db = _SessionLocal()

    try:
        doc_result = db.execute(
            select(Document).where(Document.id == uuid.UUID(document_id))
        )
        document = doc_result.scalar_one_or_none()

        if not document:
            logger.warning("[WORKER] Document %s not found — aborting", document_id)
            return

        logger.info("[WORKER] Document found — title='%s' current_status=%s", document.title, document.status)

        version_result = db.execute(
            select(DocumentVersion)
            .where(DocumentVersion.document_id == document.id)
            .order_by(DocumentVersion.version_number.desc())
        )
        version = version_result.scalar_one_or_none()

        if not version:
            logger.warning("[WORKER] No version found for document %s — aborting", document_id)
            return

        logger.info("[WORKER] Version found — file=%s mime=%s size=%d bytes",
                    version.file_name, version.mime_type, version.file_size)

        document.status = "processing"
        db.commit()
        logger.info("[WORKER] Status set to 'processing'")

        abs_path = os.path.join(settings.base_dir, settings.storage_files_dir, version.storage_path)
        logger.info("[WORKER] Resolved file path: %s", abs_path)
        logger.info("[WORKER] File exists: %s", os.path.exists(abs_path))

        extracted_text = extract_text(abs_path, version.mime_type)
        logger.info("[WORKER] Extraction complete — %d chars extracted", len(extracted_text))

        existing = db.execute(
            select(DocumentExtraction).where(
                DocumentExtraction.document_id == document.id
            )
        ).scalar_one_or_none()

        if existing:
            logger.debug("[WORKER] Updating existing extraction record")
            existing.extracted_text = extracted_text
            existing.extracted_at = datetime.now(timezone.utc)
        else:
            logger.debug("[WORKER] Creating new extraction record")
            extraction = DocumentExtraction(
                document_id=document.id,
                extracted_text=extracted_text,
                extracted_at=datetime.now(timezone.utc),
            )
            db.add(extraction)

        db.commit()

        entities = extract_entities(extracted_text)
        logger.info("[WORKER] NER complete — %d entities found", len(entities))

        if existing:
            existing.key_fields = {"entities": entities}
        else:
            extraction.key_fields = {"entities": entities}

        db.commit()
        logger.info("[WORKER] Entities saved to key_fields")

        logger.info("[WORKER] Starting AI classification")
        ai_result = classify_document(extracted_text)
        logger.info("[WORKER] AI classification complete — type=%s confidence=%.2f",
                    ai_result.document_type, ai_result.confidence)

        target = existing if existing else extraction
        target.document_type = ai_result.document_type
        target.type_confidence = ai_result.confidence
        target.sensitivity = ai_result.sensitivity
        target.summary = ai_result.summary
        current_fields = target.key_fields or {}
        current_fields.update(ai_result.key_fields)
        current_fields["tags"] = ai_result.tags
        target.key_fields = current_fields
        db.commit()
        logger.info("[WORKER] AI results saved")

        # Workflow routing
        logger.info("[WORKER] Starting workflow routing")
        doc_type = ai_result.document_type.lower() if ai_result.document_type else None
        sensitivity = ai_result.sensitivity

        rules_query = select(WorkflowRule).where(WorkflowRule.is_active == True)
        rules = db.execute(rules_query).scalars().all()

        matched_rule = None
        for rule in rules:
            type_match = (
                rule.document_type is None or
                (doc_type and rule.document_type.lower() == doc_type)
            )
            sensitivity_match = (
                rule.sensitivity is None or
                (sensitivity and rule.sensitivity == sensitivity)
            )

            if type_match and sensitivity_match:
                matched_rule = rule
                break

        if not matched_rule:
            logger.info("[WORKFLOW] No matching rule found — skipping workflow")
        else:
            instance = WorkflowInstance(
                document_id=document.id,
                rule_id=matched_rule.id,
                status="pending",
            )
            db.add(instance)
            db.flush()

            users_result = db.execute(
                select(User)
                .join(Role)
                .where(Role.name == matched_rule.assign_to_role)
                .where(User.is_active == True)
            )
            users = users_result.scalars().all()

            if not users:
                logger.warning(
                    "[WORKFLOW] No active users found for role '%s' — skipping tasks",
                    matched_rule.assign_to_role,
                )
            else:
                for user in users:
                    task = WorkflowTask(
                        instance_id=instance.id,
                        assigned_to=user.id,
                        status="pending",
                    )
                    db.add(task)

                db.commit()
                logger.info(
                    "[WORKFLOW] Created instance + %d tasks — rule='%s' role='%s'",
                    len(users),
                    matched_rule.name,
                    matched_rule.assign_to_role,
                )

        document.status = "ready"
        db.commit()

        # Index in Meilisearch — failure must never fail the worker
        try:
            search_index_document(
                doc_id=str(document.id),
                title=document.title,
                document_type=target.document_type,
                sensitivity=target.sensitivity,
                status="ready",
                summary=target.summary,
                extracted_text=target.extracted_text,
                tags=target.key_fields.get("tags", []) if target.key_fields else [],
                updated_at=document.updated_at.isoformat(),
                created_at=document.created_at.isoformat(),
            )
        except Exception as exc:
            logger.warning("[WORKER] Meilisearch indexing failed (non-fatal): %s", exc)

        logger.info(
            "[WORKER] ✓ DONE — document_id=%s title='%s' type='%s' confidence=%.2f sensitivity=%s status=ready",
            document_id,
            document.title,
            ai_result.document_type,
            ai_result.confidence,
            ai_result.sensitivity,
        )

    except Exception as e:
        logger.error("[WORKER] process_document failed — document_id=%s error=%s", document_id, e, exc_info=True)
        try:
            document.status = "processing_failed"
            db.commit()
        except Exception:
            pass
        raise

    finally:
        db.close()
