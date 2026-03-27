"""
RAG — Retrieval-Augmented Generation.
Given a document ID and a question, find relevant chunks and answer using Gemini.
"""
import logging
import uuid

from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.models.chunk import DocumentChunk
from app.services.embeddings import embed_query

logger = logging.getLogger(__name__)

_engine = create_engine(
    settings.database_url.replace("postgresql+asyncpg://", "postgresql+psycopg2://"),
    pool_pre_ping=True,
)
_Session = sessionmaker(bind=_engine)

TOP_K = 5  # number of chunks to retrieve


def retrieve_chunks(document_id: str, query: str) -> list[str]:
    """Find the TOP_K most relevant chunks for the query using cosine similarity."""
    query_embedding = embed_query(query)
    embedding_str = "[" + ",".join(str(x) for x in query_embedding) + "]"

    db = _Session()
    try:
        rows = db.execute(
            text("""
                SELECT text
                FROM document_chunks
                WHERE document_id = :doc_id
                ORDER BY embedding <=> CAST(:embedding AS vector)
                LIMIT :k
            """),
            {"doc_id": uuid.UUID(document_id), "embedding": embedding_str, "k": TOP_K},
        ).fetchall()
        return [row[0] for row in rows]
    finally:
        db.close()


def answer_question(document_id: str, question: str, document_title: str) -> str:
    """Retrieve relevant chunks and generate an answer using Gemini."""
    chunks = retrieve_chunks(document_id, question)

    if not chunks:
        return "No content available to answer this question. The document may not have been processed yet."

    context = "\n\n---\n\n".join(chunks)

    prompt = f"""You are a document assistant. Answer the question based ONLY on the provided document excerpts.
If the answer is not in the excerpts, say "I could not find this information in the document."
Be concise and direct.

Document: {document_title}

Excerpts:
{context}

Question: {question}

Answer:"""

    try:
        from google import genai
        client = genai.Client(api_key=settings.gemini_api_key)
        response = client.models.generate_content(
            model=settings.ai_model,
            contents=prompt,
        )
        return response.text.strip()
    except Exception as exc:
        logger.error("[RAG] Gemini answer generation failed: %s", exc)
        return "Failed to generate an answer. Please try again."
