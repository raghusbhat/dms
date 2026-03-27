"""
Celery task: chunk and embed a document after extraction is complete.
Called from extraction_worker.py after document.status = "ready".
"""
import logging
import uuid

from sqlalchemy import create_engine, select, delete
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.models.chunk import DocumentChunk
from app.models.extraction import DocumentExtraction
from app.workers.celery_app import celery_app
from app.services.embeddings import chunk_text, embed_texts

logger = logging.getLogger(__name__)

_engine = create_engine(
    settings.database_url.replace("postgresql+asyncpg://", "postgresql+psycopg2://"),
    pool_pre_ping=True,
)
_Session = sessionmaker(bind=_engine)


@celery_app.task(name="app.workers.rag_worker.embed_document", bind=True)
def embed_document(self, document_id: str) -> None:
    logger.info("[RAG] embed_document started — document_id=%s", document_id)
    db = _Session()
    try:
        extraction = db.execute(
            select(DocumentExtraction).where(
                DocumentExtraction.document_id == uuid.UUID(document_id)
            )
        ).scalar_one_or_none()

        if not extraction or not extraction.extracted_text:
            logger.warning("[RAG] No extracted text found for document %s — skipping", document_id)
            return

        # Delete existing chunks (re-embedding is idempotent)
        db.execute(
            delete(DocumentChunk).where(
                DocumentChunk.document_id == uuid.UUID(document_id)
            )
        )
        db.commit()

        chunks = chunk_text(extraction.extracted_text)
        if not chunks:
            logger.warning("[RAG] No chunks generated for document %s", document_id)
            return

        logger.info("[RAG] Generated %d chunks — embedding...", len(chunks))
        embeddings = embed_texts(chunks)

        chunk_rows = [
            DocumentChunk(
                document_id=uuid.UUID(document_id),
                chunk_index=i,
                text=chunk,
                embedding=embedding,
            )
            for i, (chunk, embedding) in enumerate(zip(chunks, embeddings))
        ]
        db.add_all(chunk_rows)
        db.commit()
        logger.info("[RAG] Saved %d chunks with embeddings for document %s", len(chunk_rows), document_id)

    except Exception as exc:
        logger.error("[RAG] embed_document failed — document_id=%s error=%s", document_id, exc, exc_info=True)
        raise
    finally:
        db.close()
