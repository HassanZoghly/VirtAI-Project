"""
Builds system prompts for different avatars and scenarios.
Each avatar can have a different personality and teaching style.
"""

from __future__ import annotations

from app.services.llm.base import ConversationHistory

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
    """
    if not avatar_id:
        return DEFAULT_PROMPT
    return AVATAR_PROMPTS.get(avatar_id, DEFAULT_PROMPT)


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
