class PromptBuilder:
    """
    Dedicated builder for assembling LLM prompts.
    Centralizes prompt injection logic to keep UseCases and Stages clean.
    """

    @staticmethod
    def build_system_prompt_with_context(original_system_prompt: str, context: str | None) -> str:
        if not context:
            return original_system_prompt
        return f"{original_system_prompt}\n\nUse the following retrieved context to answer the query:\n{context}"

    @staticmethod
    def build_user_prompt_with_context(query: str, context: str | None) -> str:
        if not context:
            return query
        return f"Use the following retrieved context to answer the user's query.\n\nContext:\n{context}\n\nQuery: {query}"
