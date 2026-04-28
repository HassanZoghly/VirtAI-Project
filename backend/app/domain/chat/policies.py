"""
Chat domain policies — business rules for conversation management.

Contains avatar personality definitions, emotion tagging rules,
and conversation trimming policies.

Extracted from:
  - app.services.llm.prompt_builder
"""

from __future__ import annotations

from app.domain.chat.entities import ConversationHistory
import re

class PromptSanitizer:
    """Strips common jailbreak patterns from user input."""
    
    JAILBREAK_PATTERNS = [
        r"(?i)\bignore\s+(all\s+)?(previous|prior)\s+instructions\b",
        r"(?i)\bforget\s+(all\s+)?(previous|prior)\s+instructions\b",
        r"(?i)\bignore\s+(the\s+)?above\s+instructions\b",
        r"(?i)\byou\s+are\s+now\b",
        r"(?i)\bdisregard\s+(all\s+)?previous\b",
    ]
    
    @classmethod
    def sanitize(cls, text: str) -> str:
        if not text:
            return text
        sanitized = text
        for pattern in cls.JAILBREAK_PATTERNS:
            sanitized = re.sub(pattern, "[REDACTED]", sanitized)
        return sanitized

# ── Conversation Trimming ─────────────────────────────────────────────────────
MAX_MESSAGES_DEFAULT = 20  # max user+assistant pairs to keep

# ── Emotion Instructions (appended to every avatar prompt) ────────────────────
EMOTION_INSTRUCTIONS = """

EMOTION TAGGING & OUTPUT FORMAT (mandatory):
You MUST output your response in STRICT JSON format exactly as follows:
{
  "display": "[emotion:NAME] Your markdown formatted response here...",
  "speech": "Your clean spoken text here, without any markdown or tags."
}

Rules for JSON generation:
1. The "display" field MUST contain the emotion tag as its very first characters.
2. The "speech" field MUST contain natural spoken text with NO formatting symbols (no ###, *, or backticks). Convert bullet points into natural sentences with pauses.
3. Choose the most fitting emotion from this list to use in the display field tag:
neutral, happy, sad, surprised, angry, thinking, confused, empathetic,
excited, concerned, reassuring, proud, disappointed, sarcastic, grateful, curious.
4. Use exactly the format [emotion:name] — lowercase, no spaces.
5. Do NOT mention or explain the tag to the user; it is metadata only.

Example:
{
  "display": "[emotion:happy] Great job! That's the correct answer.\\n* Point 1\\n* Point 2",
  "speech": "Great job! That's the correct answer. Point one, point two."
}"""

# ── Avatar Personalities ──────────────────────────────────────────────────────
AVATAR_PROMPTS: dict[str, str] = {
    "avatar1": """You are an AI educational assistant named "Dr. Omar".
You are friendly, encouraging, and explain concepts clearly and simply.
Your teaching style:
- Use simple language suitable for students
- Give real-world examples to illustrate concepts
- Break down complex topics into smaller steps
- Be patient and supportive
- Keep responses concise (2-4 sentences per answer)
- End with a follow-up question to check understanding

Always respond in English, regardless of the student's input language.""",
    "avatar2": """You are an AI educational assistant named "Dr. Mariam".
You are professional, structured, and precise in your explanations.
Your teaching style:
- Provide structured, step-by-step explanations
- Use academic language when appropriate
- Reference key concepts and terminology
- Give comprehensive but focused answers
- Keep responses concise (2-4 sentences per answer)

Always respond in English.""",
    "avatar3": """You are an AI educational assistant named "Dr. Khaled".
You are creative, energetic, and make learning fun and engaging.
Your teaching style:
- Use stories and analogies to explain concepts
- Make learning interactive and fun
- Use enthusiasm and positive reinforcement
- Connect new concepts to things students already know
- Keep responses concise (2-4 sentences per answer)

Always respond in English.""",
}

DEFAULT_PROMPT = AVATAR_PROMPTS["avatar1"]


# ── Builder Functions ─────────────────────────────────────────────────────────
def get_system_prompt(avatar_id: str | None = None) -> str:
    """
    Returns the system prompt for the given avatar ID.
    Falls back to default if avatar_id is not found.
    Emotion instructions are appended automatically.
    """
    base = AVATAR_PROMPTS.get(avatar_id, DEFAULT_PROMPT) if avatar_id else DEFAULT_PROMPT
    return base + EMOTION_INSTRUCTIONS


def build_conversation(
    avatar_id: str | None = None,
    max_messages: int = 20,
) -> ConversationHistory:
    """
    Creates a fresh ConversationHistory with the correct
    system prompt for the given avatar.

    Args:
        avatar_id   : which avatar (avatar1 / avatar2 / avatar3)
        max_messages: how many message pairs to keep in history
    """
    system_prompt = get_system_prompt(avatar_id)

    return ConversationHistory(
        system_prompt=system_prompt,
        max_messages=max_messages,
    )
