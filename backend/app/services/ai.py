# pip install google-genai
import json
import logging
import re
from dataclasses import dataclass, field

import requests

from app.config import settings

logger = logging.getLogger(__name__)


@dataclass
class ClassificationResult:
    document_type: str
    confidence: float
    sensitivity: str
    summary: str
    key_fields: dict = field(default_factory=dict)
    tags: list[str] = field(default_factory=list)


CLASSIFICATION_PROMPT = """You are a document analysis AI inside a Document Management System.
Analyze the document text below and respond ONLY with a valid JSON object.
No explanation. No markdown. No code blocks. Just the raw JSON.

JSON schema:
{{
  "document_type": string,
  "confidence": float between 0.0 and 1.0,
  "sensitivity": "public" | "internal" | "confidential" | "restricted",
  "summary": string (2-3 sentences),
  "key_fields": object (extract any important fields you find: vendor, amount, date, parties, etc.),
  "tags": array of 3-5 strings
}}

Document text (first 3000 characters):
{text}
"""


def _call_gemini(prompt: str) -> str:
    from google import genai
    client = genai.Client(api_key=settings.gemini_api_key)
    response = client.models.generate_content(
        model=settings.ai_model,
        contents=prompt,
    )
    # response.text raises ValueError in some SDK versions when safety metadata
    # is present — fall back to reading directly from candidates
    try:
        return response.text
    except Exception:
        return response.candidates[0].content.parts[0].text


def _call_ollama(prompt: str) -> str:
    response = requests.post(
        f"{settings.ollama_url}/api/generate",
        json={"model": settings.ollama_model, "prompt": prompt, "stream": False},
    )
    response.raise_for_status()
    return response.json()["response"]


def call_ai(prompt: str) -> str:
    if settings.ai_provider == "gemini":
        return _call_gemini(prompt)
    elif settings.ai_provider == "ollama":
        return _call_ollama(prompt)
    else:
        raise ValueError(f"Unknown AI provider: {settings.ai_provider}")


def classify_document(text: str) -> ClassificationResult:
    default_result = ClassificationResult(
        document_type="Unknown",
        confidence=0.0,
        sensitivity="internal",
        summary="Document has no extractable text.",
        key_fields={},
        tags=[],
    )

    if not settings.ai_enabled:
        logger.info("[AI] AI disabled — skipping classification")
        return default_result

    if not text or len(text) < 50:
        return default_result

    try:
        prompt = CLASSIFICATION_PROMPT.format(text=text[:3000])
        response = call_ai(prompt)
    except Exception as e:
        logger.error("AI call failed: %s", e)
        return default_result

    try:
        response = response.strip()
        response = re.sub(r"^```(?:json)?\s*", "", response)
        response = re.sub(r"\s*```$", "", response)
        response = response.strip()

        data = json.loads(response)
    except json.JSONDecodeError:
        logger.error("Failed to parse AI response: %s", response)
        return default_result

    try:
        valid_sensitivities = {"public", "internal", "confidential", "restricted"}
        sensitivity = data.get("sensitivity", "internal")
        if sensitivity not in valid_sensitivities:
            sensitivity = "internal"

        confidence = float(data.get("confidence", 0.5))
        confidence = max(0.0, min(1.0, confidence))

        result = ClassificationResult(
            document_type=data.get("document_type", "Other"),
            confidence=confidence,
            sensitivity=sensitivity,
            summary=data.get("summary", ""),
            key_fields=data.get("key_fields", {}),
            tags=data.get("tags", []),
        )

        logger.info(
            "[AI] type=%s confidence=%.2f sensitivity=%s",
            result.document_type,
            result.confidence,
            result.sensitivity,
        )

        return result

    except Exception as e:
        logger.error("Failed to build ClassificationResult: %s", e)
        return default_result
