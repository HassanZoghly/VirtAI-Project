from app.application.rag.retrieval_use_case import RetrievalUseCase
from app.domain.chat.policies import build_conversation
from app.domain.chat.ports import BaseLLMProvider
from app.application.chat.prompt_builder import PromptBuilder


class ChatUseCase:
    """Use case for non-streaming REST queries with RAG context injection."""

    def __init__(self, llm_provider: BaseLLMProvider, retrieval_use_case: RetrievalUseCase):
        self.llm = llm_provider
        self.retrieval = retrieval_use_case

    async def execute_rag_query(self, query: str, user_id: str) -> str:
        # Retrieve context
        context = await self.retrieval.execute(query)

        # Build prompt
        prompt = PromptBuilder.build_user_prompt_with_context(query, context)

        history = build_conversation("avatar1")
        history.add_user_message(prompt)

        full_response = []
        async for chunk in self.llm.stream(history):
            if chunk.token:
                full_response.append(chunk.token)

        return "".join(full_response).strip()
