"""
PII masking for stored email bodies (Microsoft Presidio).

Only the body is masked; a raw email's header block is forensic evidence
(sender, Received chain, auth results) and is stored as-is. URLs and IPs
are left alone for the same reason. If Presidio or its spaCy model isn't
installed, text is stored unmasked and a warning is logged once.
"""
from __future__ import annotations

from functools import lru_cache

from config import get_settings
from logger import get_logger

logger = get_logger(__name__)

_ENTITIES = [
    "PERSON", "EMAIL_ADDRESS", "PHONE_NUMBER", "CREDIT_CARD", "IBAN_CODE",
    "IN_PAN", "IN_AADHAAR", "IN_PASSPORT", "IN_VOTER", "US_SSN",
]


@lru_cache(maxsize=1)
def _engines():
    try:
        from presidio_analyzer import AnalyzerEngine
        from presidio_analyzer.nlp_engine import NlpEngineProvider
        from presidio_anonymizer import AnonymizerEngine

        # The small spaCy model keeps the install light; Presidio's default is the ~500MB en_core_web_lg.
        nlp = NlpEngineProvider(nlp_configuration={
            "nlp_engine_name": "spacy",
            "models": [{"lang_code": "en", "model_name": get_settings().PII_SPACY_MODEL}],
        }).create_engine()
        return AnalyzerEngine(nlp_engine=nlp, supported_languages=["en"]), AnonymizerEngine()
    except Exception as exc:  # noqa: BLE001 — optional dependency
        logger.warning("PII masking disabled (Presidio/spaCy model unavailable): %s", exc)
        return None


def mask_text(text: str) -> str:
    engines = _engines()
    if not engines or not text.strip():
        return text
    analyzer, anonymizer = engines
    entities = [e for e in _ENTITIES if e in analyzer.get_supported_entities("en")]
    results = analyzer.analyze(text=text, language="en", entities=entities)
    return anonymizer.anonymize(text=text, analyzer_results=results).text


def mask_email_for_storage(raw: str) -> str:
    """Masks PII in an email body; leaves a raw message's header block untouched."""
    if not get_settings().PII_MASKING_ENABLED:
        return raw
    from tools.header_analyzer import looks_like_rfc822

    if looks_like_rfc822(raw):
        normalized = raw.replace("\r\n", "\n")
        head, sep, body = normalized.partition("\n\n")
        return head + sep + mask_text(body)
    return mask_text(raw)
