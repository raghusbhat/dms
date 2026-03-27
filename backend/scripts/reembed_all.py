"""
Queue RAG embedding for all 'ready' documents that have no chunks yet.

Run once after enabling pgvector to backfill existing documents:
    python scripts/reembed_all.py

Safe to run multiple times — skips documents that already have chunks.
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine, select, func
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.models.document import Document
from app.models.chunk import DocumentChunk
from app.workers.rag_worker import embed_document

_engine = create_engine(
    settings.database_url.replace("postgresql+asyncpg://", "postgresql+psycopg2://"),
    pool_pre_ping=True,
)
_Session = sessionmaker(bind=_engine)


def main() -> None:
    db = _Session()
    try:
        docs = db.execute(
            select(Document).where(Document.status == "ready")
        ).scalars().all()

        print(f"Found {len(docs)} ready documents...")
        queued = 0
        skipped = 0

        for doc in docs:
            chunk_count = db.execute(
                select(func.count()).where(DocumentChunk.document_id == doc.id)
            ).scalar()

            if chunk_count and chunk_count > 0:
                print(f"  SKIP {doc.title[:60]} ({chunk_count} chunks already)")
                skipped += 1
            else:
                embed_document.delay(str(doc.id))
                print(f"  QUEUED {doc.title[:60]}")
                queued += 1

        print(f"\nDone. {queued} queued, {skipped} skipped.")
        print("Watch the Celery worker terminal for progress.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
