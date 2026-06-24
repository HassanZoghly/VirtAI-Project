import re
from loguru import logger
from app.domain.chat.entities import ConversationHistory
from app.domain.chat.ports import LLMProvider

class GenerateTitleUseCase:
    def __init__(self, llm: LLMProvider):
        self.llm = llm

    def _fallback_title(self, message: str, max_chars: int = 48) -> str:
        compact = re.sub(r"\s+", " ", message).strip()
        compact = re.sub(r"^[\"'`]+|[\"'`]+$", "", compact)
        if not compact:
            return "New chat"
        words = compact.split(" ")
        title = " ".join(words[:7]).strip(" .,:;!?")
        if len(title) > max_chars:
            title = title[:max_chars].rsplit(" ", 1)[0].strip()
        return title or "New chat"

    def _clean_generated_title(self, raw_title: str, original_message: str) -> str:
        title = re.sub(r"\s+", " ", raw_title or "").strip()
        title = re.sub(r"^[\"'`]+|[\"'`]+$", "", title)
        title = title.removeprefix("Title:").strip()
        if not title or len(title) > 80 or "\n" in title:
            return self._fallback_title(original_message)
        return title[:60].strip(" .,:;!?") or self._fallback_title(original_message)

    async def execute(self, message: str) -> str:
        """Generate a concise title for a chat session based on the first message."""
        title = self._fallback_title(message)
        try:
            history = ConversationHistory(
                system_prompt=(
                    "Generate a concise chat title from the user's first message. "
                    "Return only the title, no quotes, no punctuation at the end, "
                    "maximum 6 words. Preserve the user's language when possible."
                ),
                max_messages=1,
            )
            history.add_user_message(message)
            result = await self.llm.complete(history)
            title = self._clean_generated_title(result.full_text, message)
        except Exception as title_error:
            logger.warning(
                f"Falling back to heuristic title due to LLM error: {title_error}"
            )
        return title
