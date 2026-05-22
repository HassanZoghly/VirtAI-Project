"""
LLM provider factory for the agentic RAG pipeline.

Selects and instantiates the correct LLM provider based on
configuration. Reads API keys and model settings from the
unified backend Settings.
"""

from __future__ import annotations

from loguru import logger

from app.domain.rag.ports import LLMGenerationProvider
from app.infrastructure.llm.enums import LLMProvider
from app.shared.config import Settings


class LLMProviderFactory:
    """
    Creates LLMGenerationProvider instances based on backend setting.

    Usage::

        factory = LLMProviderFactory(settings)
        gen_client = factory.create(provider="OPENAI")
        gen_client.set_generation_model("gpt-3.5-turbo")
    """

    def __init__(self, settings: Settings):
        self._settings = settings

    def create(self, provider: str) -> LLMGenerationProvider:
        """
        Instantiate an LLM provider by name.

        Args:
            provider: One of "OPENAI" or "COHERE" (case-insensitive).

        Raises:
            ValueError: If the provider string is not recognized.
        """
        provider_upper = provider.strip().upper()

        if provider_upper == LLMProvider.OPENAI:
            from app.infrastructure.llm.openai_generation import OpenAIGenerationProvider

            if not self._settings.OPENAI_API_KEY:
                logger.warning("OPENAI_API_KEY not set — provider may fail on use")

            return OpenAIGenerationProvider(
                api_key=self._settings.OPENAI_API_KEY,
                api_url=getattr(self._settings, "OPENAI_API_URL", None),
                default_generation_max_output_tokens=self._settings.GENERATION_MAX_TOKENS,
                default_generation_temperature=self._settings.GENERATION_TEMPERATURE,
            )

        if provider_upper == LLMProvider.COHERE:
            from app.infrastructure.llm.cohere_provider import CoHereProvider

            if not self._settings.COHERE_API_KEY:
                logger.warning("COHERE_API_KEY not set — provider may fail on use")

            return CoHereProvider(
                api_key=self._settings.COHERE_API_KEY,
                default_generation_max_output_tokens=self._settings.GENERATION_MAX_TOKENS,
                default_generation_temperature=self._settings.GENERATION_TEMPERATURE,
            )

        raise ValueError(
            f"Unsupported LLM provider: '{provider}'. "
            f"Supported: {[e.value for e in LLMProvider]}"
        )
