# After pip install spacy, run: python -m spacy download en_core_web_sm
import logging

logger = logging.getLogger(__name__)

ALLOWED_LABELS = {"PERSON", "ORG", "DATE", "MONEY", "GPE", "LAW", "PRODUCT", "EVENT"}

try:
    import spacy
    nlp = spacy.load("en_core_web_sm")
except (ImportError, OSError):
    logger.error("spaCy model not available. Run: pip install spacy && python -m spacy download en_core_web_sm")
    nlp = None


def extract_entities(text: str) -> list[dict]:
    if not text:
        return []

    if nlp is None:
        logger.warning("spaCy model not loaded. Returning empty entities.")
        return []

    try:
        doc = nlp(text[:50000])
        entities = []
        seen = set()

        for ent in doc.ents:
            if ent.label_ not in ALLOWED_LABELS:
                continue

            key = (ent.text, ent.label_)
            if key in seen:
                continue

            seen.add(key)
            entities.append({
                "text": ent.text,
                "label": ent.label_,
                "start": ent.start_char,
                "end": ent.end_char,
            })

        return entities

    except Exception as e:
        logger.error("Entity extraction failed: %s", e)
        return []
