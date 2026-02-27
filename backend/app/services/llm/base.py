from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator, Callable
from dataclasses import dataclass, field
from enum import Enum


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

    def to_dict(self) -> dict:
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
    _messages: list[ChatMessage] = field(default_factory=list)

    def add_user_message(self, content: str) -> None:
        self._messages.append(ChatMessage(role=MessageRole.USER, content=content))
        self._trim()

    def add_assistant_message(self, content: str) -> None:
        self._messages.append(ChatMessage(role=MessageRole.ASSISTANT, content=content))

    def get_messages(self) -> list[dict]:
        """Returns messages formatted for the API"""
        system = ChatMessage(role=MessageRole.SYSTEM, content=self.system_prompt)
        return [system.to_dict()] + [m.to_dict() for m in self._messages]

    def clear(self) -> None:
        """Clears history but keeps system prompt"""
        self._messages.clear()

    def _trim(self) -> None:
        """
        Keeps only the last N message pairs.
        Always removes in pairs (user + assistant) to keep history consistent.
        """
        max_raw = self.max_messages * 2  # pairs → individual messages
        if len(self._messages) > max_raw:
            self._messages = self._messages[-max_raw:]

    @property
    def message_count(self) -> int:
        return len(self._messages)

    @property
    def is_empty(self) -> bool:
        return len(self._messages) == 0


# ── Abstract Provider ─────────────────────────────────────────────────────────
class BaseLLMProvider(ABC):
    @abstractmethod
    async def stream(
        self,
        history: ConversationHistory,
        on_sentence: "Callable[[str], None] | None" = None,
    ) -> AsyncGenerator[LLMChunk, None]:
        """
        Streams tokens from the LLM.
        Yields LLMChunk for each token.
        When a full sentence is detected → sets chunk.sentence.
        Args:
            history    : full conversation history
            on_sentence: optional callback when a sentence is complete
        """
        ...

    @abstractmethod
    async def complete(
        self,
        history: ConversationHistory,
    ) -> LLMResult:
        """Non-streaming completion (for simple cases)"""
        ...

    @abstractmethod
    async def is_available(self) -> bool:
        """Health check"""
        ...
