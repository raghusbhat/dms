"""
Re-index all 'ready' documents in Meilisearch.

Run once after enabling Meilisearch, or any time the index needs rebuilding:
    python scripts/reindex_all.py

Safe to run multiple times (add_documents upserts by id).
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.models.document import Document
from app.models.extraction import DocumentExtraction
from app.services.search import index_document

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

        print(f"Found {len(docs)} ready documents to index...")
        ok = 0
        failed = 0

        for doc in docs:
            extraction = db.execute(
                select(DocumentExtraction).where(DocumentExtraction.document_id == doc.id)
            ).scalar_one_or_none()

            try:
                index_document(
                    doc_id=str(doc.id),
                    title=doc.title,
                    document_type=extraction.document_type if extraction else None,
                    sensitivity=extraction.sensitivity if extraction else None,
                    status=doc.status,
                    summary=extraction.summary if extraction else None,
                    extracted_text=extraction.extracted_text if extraction else None,
                    tags=(extraction.key_fields or {}).get("tags", []) if extraction else [],
                    updated_at=doc.updated_at.isoformat(),
                    created_at=doc.created_at.isoformat(),
                )
                ok += 1
                print(f"  OK  {doc.title[:60]}")
            except Exception as exc:
                failed += 1
                print(f"  ERR {doc.title[:60]} - {exc}")

        print(f"\nDone. {ok} indexed, {failed} failed.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
