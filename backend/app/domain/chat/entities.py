"""Chat domain entities — pure data classes with no external dependencies."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from enum import Enum, auto


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
class ConversationHistory:
    """
    Manages conversation history with automatic trimming.
    Keeps the system prompt always at index 0.
    """

    system_prompt: str
    max_messages: int = 20  # max user+assistant pairs to keep
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
            # Backwards-compatibility fallback: lazy import to avoid circular
            # imports at module import time. Callers constructed via
            from app.domain.chat.policies import PromptSanitizer

            sanitized_content = PromptSanitizer.sanitize(content)

        self._messages.append(ChatMessage(role=MessageRole.USER, content=sanitized_content))
        self._trim()

    def add_assistant_message(self, content: str) -> None:
        self._messages.append(ChatMessage(role=MessageRole.ASSISTANT, content=content))

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
            self._messages = self._messages[-max_raw:]

        while len(self._messages) >= 2:
            total_chars = len(self.system_prompt) + sum(len(m.content) for m in self._messages)
            estimated_tokens = total_chars // 4

            if estimated_tokens <= self.max_tokens:
                break

            self._messages = self._messages[2:]

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
