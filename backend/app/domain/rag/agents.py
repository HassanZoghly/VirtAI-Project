import logging
import re
from abc import ABC, abstractmethod
from typing import Any, AsyncGenerator

from app.domain.rag.entities import AgentAction, AgentInput, AgentOutput
from app.domain.rag.ports import LLMGenerationProvider, VectorCollectionStore, EmbeddingProvider
from app.infrastructure.rag.template_parser import TemplateParser
from app.infrastructure.rag.guardrail_service import GuardrailService

logger = logging.getLogger("uvicorn.error")


def _detect_language(text: str) -> str:
    """Detect if query is Arabic or English."""
    if not text:
        return "en"
    if re.search(r"[a-zA-Z]", text):
        return "en"
    if re.search(r"[\u0600-\u06FF]", text):
        return "ar"
    return "en"


def _build_language_prompt(query: str) -> str:
    """Build an explicit language instruction block."""
    lang_code = _detect_language(query)
    target_lang = "Arabic" if lang_code == "ar" else "English"
    return (
        f"\n\nCRITICAL INSTRUCTION: The user is asking in {target_lang}. "
        f"You MUST write your ENTIRE final response strictly in {target_lang}. "
        f"If the retrieved documents are in a different language, you MUST translate your summary and answers into {target_lang}."
    )


class BaseAgent(ABC):
    """
    Every agent must inherit from this.
    Defines the contract all agents must fulfill.
    """

    agent_name: str = "base_agent"

    def __init__(
        self,
        llm_provider: LLMGenerationProvider | None = None,
        vector_store: VectorCollectionStore | None = None,
        embedding_provider: EmbeddingProvider | None = None,
        template_parser: TemplateParser | None = None,
    ):
        self.llm_provider = llm_provider
        self.vector_store = vector_store
        self.embedding_provider = embedding_provider
        self.template_parser = template_parser

    @abstractmethod
    def can_handle(self, input_data: AgentInput) -> bool:
        """
        Returns True if this agent should handle the given input.
        RouterAgent uses this to decide routing.
        """
        pass

    @abstractmethod
    async def run(self, input_data: AgentInput, retrieved_documents: list[dict] | None = None) -> AgentOutput:
        """
        Core execution logic. Must return AgentOutput.
        """
        pass

    def _make_output(
        self,
        input_data: AgentInput,
        result: Any = None,
        success: bool = True,
        error: str | None = None,
        stream_generator: AsyncGenerator | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> AgentOutput:
        """Helper — builds a consistent AgentOutput."""
        return AgentOutput(
            input_id=input_data.input_id,
            agent_name=self.agent_name,
            success=success,
            result=result,
            error=error,
            stream_generator=stream_generator,
            metadata=metadata or {},
        )


ROUTING_KEYWORDS = {
    AgentAction.SUMMARIZE: [
        "summarize this",
        "summarize the",
        "give me a summary",
        "make a summary",
        "write a summary",
        "tldr",
    ],
    AgentAction.QUIZ: [
        "generate quiz",
        "make a quiz",
        "create quiz",
        "give me questions",
        "test me",
        "make a test",
    ],
}


class RouterAgent(BaseAgent):
    agent_name = "router_agent"

    def can_handle(self, input_data: AgentInput) -> bool:
        return True

    async def run(self, input_data: AgentInput, retrieved_documents: list[dict] | None = None) -> AgentOutput:
        query_lower = input_data.query.lower().strip()

        # ── keyword routing (strict matching) ─────────────────────
        for action, keywords in ROUTING_KEYWORDS.items():
            for kw in keywords:
                if kw in query_lower:
                    routed = AgentInput(
                        input_id=input_data.input_id,
                        query=input_data.query,
                        project_id=input_data.project_id,
                        action=action,
                        limit=input_data.limit,
                        stream=input_data.stream,
                        metadata=input_data.metadata,
                        created_at=input_data.created_at,
                    )
                    return self._make_output(
                        input_data,
                        result=routed,
                        metadata={
                            "routing_method": "keyword",
                            "matched_keyword": kw,
                            "action": action.value,
                        },
                    )

        # ── explicit action passed from caller ────────────────────
        if input_data.action not in (AgentAction.ANSWER, AgentAction.UNKNOWN):
            return self._make_output(
                input_data,
                result=input_data,
                metadata={
                    "routing_method": "explicit",
                    "action": input_data.action.value,
                },
            )

        # ── default: answer (most questions go here) ──────────────
        routed = AgentInput(
            input_id=input_data.input_id,
            query=input_data.query,
            project_id=input_data.project_id,
            action=AgentAction.ANSWER,
            limit=input_data.limit,
            stream=input_data.stream,
            metadata=input_data.metadata,
            created_at=input_data.created_at,
        )
        return self._make_output(
            input_data,
            result=routed,
            metadata={
                "routing_method": "default",
                "action": AgentAction.ANSWER.value,
            },
        )


ACTION_QUERIES = {
    AgentAction.SUMMARIZE: "overview, main concepts, summary, introduction, conclusion",
    AgentAction.QUIZ: "key concepts, main definitions, important details",
}


class RetrieverAgent(BaseAgent):
    agent_name = "retriever_agent"

    def can_handle(self, input_data: AgentInput) -> bool:
        return input_data.action in (
            AgentAction.RETRIEVE,
            AgentAction.ANSWER,
            AgentAction.SUMMARIZE,
            AgentAction.QUIZ,
        )

    async def run(self, input_data: AgentInput, retrieved_documents: list[dict] | None = None) -> AgentOutput:
        try:
            if not self.vector_store or not self.embedding_provider:
                raise ValueError("Vector store and embedding provider required for RetrieverAgent")

            # use action-specific query for summarize/quiz
            search_query = ACTION_QUERIES.get(input_data.action, input_data.query)

            # for answer, always use the user's actual query
            if input_data.action == AgentAction.ANSWER:
                search_query = input_data.query

            fetch_limit = input_data.limit * 3

            # Flatten the embedding vector as expected by legacy implementations
            raw_vec = await self.embedding_provider.embed(text=search_query)

            collection_name = f"collection_1536_{input_data.project_id}"
            
            results = await self.vector_store.search_by_vector(
                collection_name=collection_name,
                vector=raw_vec,
                limit=fetch_limit,
            )

            # Simple Reranking slice
            results = results[: input_data.limit]

            if not results:
                return self._make_output(
                    input_data,
                    result=[],
                    success=True,
                    metadata={"warning": "No documents found in collection"},
                )

            return self._make_output(
                input_data,
                result=results,
                metadata={"doc_count": len(results)},
            )

        except Exception as e:
            logger.error(f"[RetrieverAgent] error: {e}")
            return self._make_output(input_data, success=False, error=str(e))


class AnswerAgent(BaseAgent):
    agent_name = "answer_agent"

    def can_handle(self, input_data: AgentInput) -> bool:
        return input_data.action == AgentAction.ANSWER

    async def run(self, input_data: AgentInput, retrieved_documents: list[dict] | None = None) -> AgentOutput:
        try:
            if not self.llm_provider or not self.template_parser:
                raise ValueError("LLM provider and Template Parser required for AnswerAgent")

            docs = retrieved_documents or []
            if not docs:
                return self._make_output(
                    input_data, success=False, error="No relevant documents found."
                )

            base_system_prompt = self.template_parser.get("rag", "system_prompt")
            
            chat_history = [
                self.llm_provider.construct_prompt(
                    prompt=base_system_prompt,
                    role="system",
                )
            ]

            # inject memory as previous turns
            memory_context = input_data.metadata.get("memory_context", [])
            for mem in memory_context:
                role = mem.get("role", "user")
                content = mem.get("content", "")
                mem_role = "USER" if role == "user" else "CHATBOT"
                chat_history.append(
                    self.llm_provider.construct_prompt(
                        prompt=content,
                        role=mem_role,
                    )
                )

            # build document prompts
            documents_prompts = "\n".join(
                [
                    self.template_parser.get(
                        "rag",
                        "document_prompt",
                        {
                            "doc_num": idx + 1,
                            "chunk_text": self.llm_provider.process_text(doc.get("text", "")),
                        },
                    )
                    for idx, doc in enumerate(docs)
                ]
            )

            lang = "Arabic" if _detect_language(input_data.query) == "ar" else "English"
            lang_prefix = f"[Respond in {lang} only]\n"
            footer = self.template_parser.get(
                "rag", "footer_prompt", {"query": lang_prefix + input_data.query}
            )
            footer += _build_language_prompt(input_data.query)

            full_prompt = "\n\n".join([documents_prompts, footer])

            if input_data.stream:
                async def answer_stream():
                    for chunk in self.llm_provider.generate_stream(
                        prompt=full_prompt,
                        chat_history=chat_history,
                    ):
                        filtered_chunk = GuardrailService.validate_output(chunk)
                        if filtered_chunk:
                            yield filtered_chunk

                return self._make_output(
                    input_data,
                    result="streaming",
                    stream_generator=answer_stream(),
                    metadata={"streaming": True, "doc_count": len(docs), "language": lang},
                )

            # non-streaming
            answer = self.llm_provider.generate_text(
                prompt=full_prompt,
                chat_history=chat_history,
            )
            answer = GuardrailService.validate_output(answer)

            return self._make_output(
                input_data,
                result={"answer": answer, "doc_count": len(docs), "language": lang},
            )

        except Exception as e:
            logger.error(f"[AnswerAgent] error: {e}")
            return self._make_output(input_data, success=False, error=str(e))


class SummarizerAgent(BaseAgent):
    agent_name = "summarizer_agent"

    def can_handle(self, input_data: AgentInput) -> bool:
        return input_data.action == AgentAction.SUMMARIZE

    async def run(self, input_data: AgentInput, retrieved_documents: list[dict] | None = None) -> AgentOutput:
        try:
            if not self.llm_provider or not self.template_parser:
                raise ValueError("LLM provider and Template Parser required for SummarizerAgent")

            docs = retrieved_documents or []
            if not docs:
                return self._make_output(
                    input_data, success=False, error="No documents to summarize"
                )

            system_prompt = self.template_parser.get("rag", "summarize_system_prompt")
            footer_prompt = self.template_parser.get("rag", "summarize_footer_prompt")
            
            user_lang_code = _detect_language(input_data.query or "")
            target_lang = "Arabic" if user_lang_code == "ar" else "English"
            language_enforcement = (
                f"\n\nCRITICAL INSTRUCTION: The user is asking in {target_lang}. "
                f"You MUST write your ENTIRE final response strictly in {target_lang}. "
                f"If the retrieved documents are in a different language, you MUST translate your summary and answers into {target_lang}."
            )
            footer_prompt += language_enforcement

            documents_prompts = "\n".join(
                [
                    self.template_parser.get(
                        "rag",
                        "document_prompt",
                        {
                            "doc_num": idx + 1,
                            "chunk_text": doc.get("text", ""),
                        },
                    )
                    for idx, doc in enumerate(docs)
                ]
            )

            chat_history = [
                self.llm_provider.construct_prompt(
                    prompt=system_prompt,
                    role="system",
                )
            ]

            full_prompt = "\n\n".join([documents_prompts, footer_prompt])

            if input_data.stream:
                async def summary_stream():
                    for chunk in self.llm_provider.generate_stream(
                        prompt=full_prompt,
                        chat_history=chat_history,
                    ):
                        yield chunk

                return self._make_output(
                    input_data,
                    result="streaming",
                    stream_generator=summary_stream(),
                    metadata={"streaming": True, "doc_count": len(docs)},
                )

            summary = self.llm_provider.generate_text(
                prompt=full_prompt,
                chat_history=chat_history,
                max_output_tokens=4000,
            )

            return self._make_output(input_data, result={"summary": summary})

        except Exception as e:
            logger.error(f"[SummarizerAgent] error: {e}")
            return self._make_output(input_data, success=False, error=str(e))


class QuizAgent(BaseAgent):
    agent_name = "quiz_agent"

    def can_handle(self, input_data: AgentInput) -> bool:
        return input_data.action == AgentAction.QUIZ

    async def run(self, input_data: AgentInput, retrieved_documents: list[dict] | None = None) -> AgentOutput:
        try:
            if not self.llm_provider or not self.template_parser:
                raise ValueError("LLM provider and Template Parser required for QuizAgent")

            docs = retrieved_documents or []
            if not docs:
                return self._make_output(
                    input_data, success=False, error="No documents to generate quiz from"
                )

            system_prompt = self.template_parser.get("rag", "quiz_system_prompt", {"num_questions": 3})
            footer_prompt = self.template_parser.get("rag", "quiz_footer_prompt", {"num_questions": 3})

            user_lang_code = _detect_language(input_data.query or "")
            target_lang = "Arabic" if user_lang_code == "ar" else "English"
            language_enforcement = (
                f"\n\nCRITICAL INSTRUCTION: The user is asking in {target_lang}. "
                f"You MUST write your ENTIRE final response strictly in {target_lang}. "
                f"If the retrieved documents are in a different language, you MUST translate your summary and answers into {target_lang}."
            )
            footer_prompt += language_enforcement

            documents_prompts = "\n".join(
                [
                    self.template_parser.get(
                        "rag",
                        "document_prompt",
                        {
                            "doc_num": idx + 1,
                            "chunk_text": doc.get("text", ""),
                        },
                    )
                    for idx, doc in enumerate(docs)
                ]
            )

            chat_history = [
                self.llm_provider.construct_prompt(
                    prompt=system_prompt,
                    role="system",
                )
            ]

            full_prompt = "\n\n".join([documents_prompts, footer_prompt])

            if input_data.stream:
                async def quiz_stream():
                    for chunk in self.llm_provider.generate_stream(
                        prompt=full_prompt,
                        chat_history=chat_history,
                    ):
                        yield chunk

                return self._make_output(
                    input_data,
                    result="streaming",
                    stream_generator=quiz_stream(),
                    metadata={"streaming": True},
                )

            quiz = self.llm_provider.generate_text(
                prompt=full_prompt,
                chat_history=chat_history,
                max_output_tokens=2000,
            )

            return self._make_output(input_data, result={"quiz": quiz})

        except Exception as e:
            logger.error(f"[QuizAgent] error: {e}")
            return self._make_output(input_data, success=False, error=str(e))
