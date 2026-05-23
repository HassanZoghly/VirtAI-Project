"""Chat domain entities — pure data classes with no external dependencies."""

from __future__ import annotations

import base64
import re
import unicodedata
from typing import ClassVar
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import Enum, auto

_logger = logging.getLogger(__name__)


# ── Message Roles ─────────────────────────────────────────────────────────────
class MessageRole(str, Enum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"


# ── Data Classes ──────────────────────────────────────────────────────────────
@dataclass
class ChatMessage:
    """A single message in the conversation history"""

    role: MessageRole
    content: str

    def to_dict(self) -> dict[str, str]:
        return {
            "role": self.role.value,
            "content": self.content,
        }


@dataclass
class LLMChunk:
    """A single streaming chunk from the LLM"""

    token: str  # the token text
    is_done: bool = False  # True = stream finished
    sentence: str | None = None  # set when a full sentence is ready


@dataclass
class LLMResult:
    """Full result after streaming is complete"""

    full_text: str
    sentences: list[str] = field(default_factory=list)
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    model: str = ""
    duration_ms: float = 0.0

    @property
    def total_chars(self) -> int:
        return len(self.full_text)


@dataclass
class PromptSanitizer:
    """
    Multi-layer input sanitizer for user messages before LLM insertion.

    Important:
    - This is a defense-in-depth layer, not a complete security boundary.
    - It reduces prompt injection, token smuggling, encoding attacks,
        and common jailbreak patterns while preserving legitimate user intent.
    - Suspicious inputs are logged for backend observability.
        The LLM never receives suspicion flags — those are for ops only.
    """

    MAX_LENGTH: ClassVar[int] = 8_000
    SUSPICIOUS_LENGTH_THRESHOLD: ClassVar[int] = 4_000  # extra scrutiny above this

    # ── Layer 1 — Unicode & Homoglyphs ────────────────────────

    ZERO_WIDTH_CHARS = re.compile(r"[\u200B-\u200F\u2028\u2029\uFEFF\u00AD\u034F\u17B4\u17B5]")
    CONTROL_CHARS = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]")
    MULTIPLE_SPACES = re.compile(r"[ \t]{2,}")
    MULTIPLE_NEWLINES = re.compile(r"\n{3,}")

    # Common Cyrillic / Greek chars visually identical to Latin
    HOMOGLYPH_MAP: ClassVar[dict[str, str]] = {
        "\u0430": "a",  # Cyrillic а → a
        "\u0435": "e",  # Cyrillic е → e
        "\u043e": "o",  # Cyrillic о → o
        "\u0440": "r",  # Cyrillic р → r
        "\u0441": "c",  # Cyrillic с → c
        "\u0445": "x",  # Cyrillic х → x
        "\u0456": "i",  # Cyrillic і → i
        "\u04cf": "l",  # Cyrillic ӏ → l
        "\u03b5": "e",  # Greek ε → e
        "\u03bf": "o",  # Greek ο → o
        "\u03b1": "a",  # Greek α → a
        "\u03c1": "p",  # Greek ρ → p
        "\u03bd": "v",  # Greek ν → v
    }

    # ── Layer 2 — Token Smuggling ─────────────────────────────
    # Catches: i g n o r e / i.g.n.o.r.e / i-g-n-o-r-e etc.

    _sep = r"[\s._\-*]{0,3}"  # allowed separators between chars

    TOKEN_SMUGGLING = re.compile(
        r"(?i)\b(?:"
        + r"|".join(
            [
                _sep.join("ignore"),
                _sep.join("forget"),
                _sep.join("bypass"),
                _sep.join("override"),
                _sep.join("jailbreak"),
                _sep.join("disregard"),
            ]
        )
        + r")\b"
    )

    # ── Layer 3 — Base64 / Encoding Detection ─────────────────

    BASE64_LIKE = re.compile(r"\b[A-Za-z0-9+/]{16,}={0,2}\b")

    _INJECTION_KEYWORDS = (
        "ignore",
        "forget",
        "bypass",
        "override",
        "jailbreak",
        "system prompt",
        "disregard",
    )

    # Pre-compute base64 variants of injection keywords
    ENCODED_KEYWORDS: ClassVar[frozenset[str]] = frozenset(
        base64.b64encode(kw.encode()).decode().rstrip("=") for kw in _INJECTION_KEYWORDS
    )

    # ── Layer 4 — Direct Jailbreak Patterns ───────────────────
    # Context-aware: avoids false positives on legitimate educational text.

    JAILBREAK_PATTERNS: ClassVar[list[str]] = [
        # Instruction override
        r"(?i)\bignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|rules?|guidelines?|context|prompt)\b",
        r"(?i)\bforget\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|rules?|guidelines?|context|prompt)\b",
        r"(?i)\bdisregard\s+(all\s+)?(previous|prior|above|earlier)\b",
        r"(?i)\boverride\s+(all\s+)?(your\s+)?(instructions?|rules?|behavior|settings?|guidelines?)\b",
        # System prompt exposure
        r"(?i)\b(reveal|show|dump|print|output|expose|repeat|display)\b.{0,50}\b(system\s*prompt|developer\s*message|hidden\s*instructions?|internal\s*policy|secret\s*instructions?)\b",
        # From-now-on style overrides (requires "must/will/should" after)
        r"(?i)\bfrom\s+now\s+on\s+(you\s+)?(must|will|should|are\s+required\s+to|have\s+to)\b",
        r"(?i)\bstarting\s+(right\s+)?now\s+(you\s+)?(must|will|should|are\s+required\s+to)\b",
        # Roleplay injection — only triggers with suspicious context words
        r"(?i)\b(act|pretend|roleplay|play|simulate|behave)\s+(as|like)\s+(an?\s+)?"
        r"(unrestricted|unfiltered|different\s+ai|evil|hacked|jailbroken|uncensored|unlimited)\b",
        r"(?i)\b(act|pretend|roleplay)\s+(as|like)\s+"
        r"(DAN|GPT-?[0-9]+|Claude\s*[0-9]*|an?\s+AI\s+without\s+(restrictions?|guidelines?|rules?|policies?))\b",
        # Developer / admin impersonation
        r"(?i)\b(i\s+am|i'm|this\s+is)\s+(the\s+)?(developer|admin|anthropic|openai|operator|system\s+owner)\b",
        r"(?i)\bdeveloper\s+(mode|override|access\s+granted|key|token|unlock)\b",
        r"(?i)\badmin\s+(mode|override|access\s+granted|unlock)\b",
        # Safety bypass
        r"(?i)\b(bypass|circumvent|disable|turn\s+off|deactivate|remove)\s+(all\s+)?"
        r"(safety|content\s+filter|moderation|policy|restriction|guardrail)\b",
        # Special token injection (LLM prompt format attacks)
        r"(?i)<!--.*?(ignore|forget|override|bypass).*?-->",
        r"(?s)(?i)<\s*system\s*>.*?<\s*/\s*system\s*>",
        r"(?i)\[INST\]|\[SYS\]|<\|system\|>|<\|im_start\|>|\{\{system\}\}",
        # Repetition / context flooding DoS
        r"(?s)(.{15,})\1{4,}",
    ]

    # ── Layer 5 — Soft Heuristic Markers ──────────────────────

    SUSPICIOUS_MARKERS: ClassVar[frozenset[str]] = frozenset(
        {
            "system prompt",
            "developer message",
            "hidden prompt",
            "secret instructions",
            "ignore previous",
            "forget previous",
            "override instructions",
            "jailbreak",
            "prompt injection",
            "internal policy",
            "policy bypass",
            "uncensored mode",
            "without restrictions",
            "no restrictions",
            "unrestricted mode",
            "dan mode",
            "developer mode",
            "admin mode",
            "god mode",
            "you are now",
            "from now on you",
            "base64 encoded",
            "hex encoded",
            "encoded message",
            "simulate a different ai",
            "pretend you have no limits",
            "your true self",
            "your real instructions",
        }
    )

    # ── Layer 6 ───────────────────────────────────────────────

    @classmethod
    def _replace_homoglyphs(cls, text: str) -> str:
        return "".join(cls.HOMOGLYPH_MAP.get(ch, ch) for ch in text)

    @classmethod
    def _has_base64_injection(cls, text: str) -> bool:
        for match in cls.BASE64_LIKE.finditer(text):
            token = match.group().rstrip("=")
            if token in cls.ENCODED_KEYWORDS:
                return True
            try:
                decoded = base64.b64decode(token + "==").decode("utf-8", errors="ignore").lower()
                if any(kw in decoded for kw in cls._INJECTION_KEYWORDS):
                    return True
            except Exception:
                pass
        return False

    @classmethod
    def normalize_text(cls, text: str) -> str:
        if not text:
            return text
        text = unicodedata.normalize("NFKC", text)
        text = cls._replace_homoglyphs(text)
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        text = cls.ZERO_WIDTH_CHARS.sub("", text)
        text = cls.CONTROL_CHARS.sub("", text)
        text = cls.MULTIPLE_SPACES.sub(" ", text)
        text = cls.MULTIPLE_NEWLINES.sub("\n\n", text)
        return text.strip()

    @classmethod
    def is_suspicious(cls, text: str) -> bool:
        if not text:
            return False
        normalized = cls.normalize_text(text).lower()

        if any(marker in normalized for marker in cls.SUSPICIOUS_MARKERS):
            return True
        if cls.TOKEN_SMUGGLING.search(normalized):
            return True
        if cls._has_base64_injection(text):
            return True
        if len(normalized) > cls.SUSPICIOUS_LENGTH_THRESHOLD:
            return True
        return False

    @classmethod
    def sanitize(cls, text: str) -> str:
        """
        Returns a cleaned version of the text.
        Preserves user intent while neutralizing injection patterns.
        """
        if not text:
            return text

        sanitized = cls.normalize_text(text)
        sanitized = cls.TOKEN_SMUGGLING.sub("[REDACTED]", sanitized)

        for pattern in cls.JAILBREAK_PATTERNS:
            sanitized = re.sub(pattern, "[REDACTED]", sanitized)

        sanitized = cls.normalize_text(sanitized)

        if len(sanitized) > cls.MAX_LENGTH:
            sanitized = sanitized[: cls.MAX_LENGTH].rstrip() + "…"

        return sanitized

    @classmethod
    def sanitize_for_history(cls, text: str) -> str:
        """
        Stricter wrapper used before inserting user messages into conversation history.

        Suspicious inputs are logged for backend observability.
        The LLM receives the sanitized text only — never the suspicion flag.
        This keeps the LLM focused on the educational task without meta-noise.
        """
        if not text:
            return text

        sanitized = cls.sanitize(text)

        if cls.is_suspicious(text):
            logger.warning(
                "Suspicious user input detected",
                extra={
                    "raw_preview": text[:300],
                    "length": len(text),
                },
            )

        return sanitized


class ConversationHistory:
    """
    Manages conversation history with automatic trimming.
    Keeps the system prompt always at index 0.
    """

    system_prompt: str
    max_messages: int = 10  # max user+assistant pairs to keep (sliding window)
    max_tokens: int = 4096  # safe token limit threshold
    _messages: list[ChatMessage] = field(default_factory=list)
    sanitizer: Callable[[str], str] | None = None

    def add_user_message(self, content: str) -> None:
        """Add a user message, applying the configured sanitizer if present.

        If no sanitizer was injected, fall back to the existing behavior and
        import `PromptSanitizer` lazily for backwards compatibility.
        """
        if self.sanitizer is not None:
            sanitized_content = self.sanitizer(content)
        else:
            sanitized_content = PromptSanitizer.sanitize(content)

        self._messages.append(ChatMessage(role=MessageRole.USER, content=sanitized_content))
        self._trim()

    def add_assistant_message(self, content: str) -> None:
        self._messages.append(ChatMessage(role=MessageRole.ASSISTANT, content=content))
        self._trim()

    def get_messages(self) -> list[dict[str, str]]:
        """Returns messages formatted for the API"""
        system = ChatMessage(role=MessageRole.SYSTEM, content=self.system_prompt)
        return [system.to_dict()] + [m.to_dict() for m in self._messages]

    def clear(self) -> None:
        """Clears history but keeps system prompt"""
        self._messages.clear()

    def _trim(self) -> None:
        """
        Keeps only the last N message pairs, and enforces a maximum token limit.
        Always removes in pairs (user + assistant) to keep history consistent.
        Uses 1 token ≈ 4 characters heuristic.
        """
        max_raw = self.max_messages * 2  # pairs → individual messages
        if len(self._messages) > max_raw:
            trimmed = len(self._messages) - max_raw
            self._messages = self._messages[-max_raw:]
            _logger.warning(
                "History trimmed by pair count | removed=%d messages | remaining=%d | max_pairs=%d",
                trimmed, len(self._messages), self.max_messages,
            )

        while len(self._messages) >= 2:
            total_chars = len(self.system_prompt) + sum(len(m.content) for m in self._messages)
            estimated_tokens = total_chars // 4

            if estimated_tokens <= self.max_tokens:
                break

            self._messages = self._messages[2:]
            _logger.warning(
                "History trimmed by token budget | est_tokens=%d | max=%d | remaining=%d",
                estimated_tokens, self.max_tokens, len(self._messages),
            )

    @property
    def message_count(self) -> int:
        return len(self._messages)

    @property
    def is_empty(self) -> bool:
        return len(self._messages) == 0


# ── Pipeline Events ───────────────────────────────────────────────────────────
class PipelineEventType(Enum):
    # ── Status ────────────────────────────────────────────────────────────────
    LISTENING = auto()  # mic is active
    PROCESSING = auto()  # ASR running
    THINKING = auto()  # LLM running
    SPEAKING = auto()  # TTS running
    IDLE = auto()  # done

    # ── ASR ───────────────────────────────────────────────────────────────────
    TRANSCRIPT = auto()  # ASR result ready

    # ── LLM ───────────────────────────────────────────────────────────────────
    LLM_TOKEN = auto()  # single token
    LLM_SENTENCE = auto()  # full sentence ready → triggers TTS
    LLM_DONE = auto()  # full response done

    # ── TTS ───────────────────────────────────────────────────────────────────
    TTS_VISEMES = auto()  # viseme events for a sentence
    TTS_AUDIO = auto()  # audio chunk
    TTS_DONE = auto()  # sentence TTS done

    # ── Errors ────────────────────────────────────────────────────────────────
    ERROR = auto()
    WARNING = auto()  # non-fatal warning

    # ── Control ───────────────────────────────────────────────────────────────
    ABORT = auto()  # stop everything
    HEARTBEAT = auto()  # keepalive
    CLEANUP = auto()  # session cleanup


@dataclass
class PipelineEvent:
    type: PipelineEventType
    data: dict = field(default_factory=dict)
    session_id: str | None = None  # for tracking
    trace_id: str | None = None  # for distributed tracing


def ev(
    event_type: PipelineEventType,
    session_id: str | None = None,
    trace_id: str | None = None,
    **kwargs
) -> PipelineEvent:
    """Shorthand to create a PipelineEvent."""
    return PipelineEvent(type=event_type, data=kwargs, session_id=session_id, trace_id=trace_id)
