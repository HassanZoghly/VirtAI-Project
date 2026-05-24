"""
RAG-specific guardrail service.

Builds on the production ``PromptSanitizer`` (domain/chat/policies.py)
for prompt injection detection, and adds RAG-specific safety layers:

1. **Input validation** — delegates injection detection to PromptSanitizer, adds profanity filtering for RAG-specific queries.
2. **Output filtering** — PII masking and profanity replacement on LLM output before returning to the user.

This service is stateless — all methods are classmethods.
"""

from __future__ import annotations

import re

from loguru import logger

from app.domain.chat.policies import PromptSanitizer


class GuardrailService:
    """
    Stateless input/output safety filter for RAG queries and responses.

    For prompt injection detection, delegates to the production-grade
    ``PromptSanitizer`` which has 7 security layers including unicode
    normalization, homoglyph replacement, token-smuggling detection,
    and Base64 obfuscation detection. This class adds RAG-specific
    profanity filtering and PII masking on top.
    """

    # ── Profanity / Harmful content dictionary ───────────────────────────
    PROFANITY_WORDS: set[str] = {
        "fuck",
        "shit",
        "bitch",
        "asshole",
        "cunt",
        "dick",
        "bastard",
        "whore",
        "slut",
        "fag",
        "kill",
        "murder",
        "suicide",
        "rape",
        "bomb",
    }

    # ── PII Patterns (emails, SSN, phone numbers) ────────────────────────
    PII_PATTERNS: list[re.Pattern] = [
        re.compile(r"(?i)\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b"),
        re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
        re.compile(r"\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b"),
    ]

    @classmethod
    def validate_input(cls, query: str) -> tuple[bool, str]:
        """
        Validate a user query against safety guardrails.

        Checks:
        1. Empty input
        2. Prompt injection (via production PromptSanitizer)
        3. Profanity / harmful content

        Returns:
            (is_valid, error_message) - error_message is empty if valid.
        """
        if not query or not query.strip():
            return False, "Query cannot be empty."

        is_suspicious = PromptSanitizer.is_suspicious(query)
        if is_suspicious:
            logger.warning(f"[Guardrails] PromptSanitizer flagged input: {query[:80]}")
            return False, (
                "I cannot process this request as it appears to be an "
                "attempt to override system instructions."
            )

        # Check profanity
        query_lower = query.lower()
        words = set(re.findall(r"\b\w+\b", query_lower))
        if words.intersection(cls.PROFANITY_WORDS):
            logger.warning(f"[Guardrails] Blocked profanity in query: {query[:80]}")
            return False, (
                "I cannot process this request as it violates our safety "
                "guidelines (profanity/harmful content detected)."
            )

        return True, ""

    @classmethod
    def mask_pii(cls, text: str) -> str:
        """Mask common PII patterns (emails, SSN, phone numbers) in text."""
        masked = text
        for pattern in cls.PII_PATTERNS:
            masked = pattern.sub("[REDACTED]", masked)
        return masked

    @classmethod
    def validate_output(cls, output: str) -> str:
        """
        Filter LLM output before sending to the user.

        Applies PII masking and profanity replacement.
        """
        if not output:
            return output

        safe_output = cls.mask_pii(output)

        # Mask profanity in output (LLM hallucination safety net)
        for word in re.findall(r"\b\w+\b", safe_output):
            if word.lower() in cls.PROFANITY_WORDS:
                safe_output = re.sub(rf"\b{word}\b", "***", safe_output, flags=re.IGNORECASE)

        return safe_output
