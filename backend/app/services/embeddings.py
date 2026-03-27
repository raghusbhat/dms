"""
Text chunking and embedding generation using bge-small-en-v1.5.
Model is loaded once at module level (lazy, on first use).
"""
import logging
import re
from functools import lru_cache

from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)

CHUNK_SIZE = 400  # words per chunk
CHUNK_OVERLAP = 50  # words overlap between chunks
MODEL_NAME = "BAAI/bge-small-en-v1.5"


@lru_cache(maxsize=1)
def _get_model() -> SentenceTransformer:
    logger.info("[EMBED] Loading embedding model %s", MODEL_NAME)
    model = SentenceTransformer(MODEL_NAME)
    logger.info("[EMBED] Model loaded")
    return model


def chunk_text(text: str) -> list[str]:
    """Split text into overlapping chunks of ~CHUNK_SIZE words."""
    text = re.sub(r"\s+", " ", text).strip()
    words = text.split()
    if not words:
        return []

    chunks = []
    start = 0
    while start < len(words):
        end = min(start + CHUNK_SIZE, len(words))
        chunk = " ".join(words[start:end])
        chunks.append(chunk)
        if end == len(words):
            break
        start += CHUNK_SIZE - CHUNK_OVERLAP

    return chunks


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for a list of texts. Returns list of 384-dim vectors."""
    if not texts:
        return []
    model = _get_model()
    embeddings = model.encode(texts, normalize_embeddings=True)
    return embeddings.tolist()


def embed_query(query: str) -> list[float]:
    """Embed a single query string."""
    model = _get_model()
    embedding = model.encode(
        f"Represent this sentence for searching relevant passages: {query}",
        normalize_embeddings=True,
    )
    return embedding.tolist()
