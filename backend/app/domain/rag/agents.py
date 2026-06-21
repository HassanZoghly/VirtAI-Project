import logging
import re
from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator
from typing import Any

from app.domain.rag.entities import (
    AgentAction,
    AgentInput,
    AgentOutput,
    RetrievalResult,
    RetrievalStatus,
    RetrievedDocument,
)
from app.domain.rag.ports import (
    EmbeddingProvider,
    GuardrailPort,
    LLMGenerationProvider,
    TemplateParserPort,
    VectorCollectionStore,
)

logger = logging.getLogger("uvicorn.error")

def _detect_language(text: str) -> str:
    """Detect if query is Arabic or English."""
    if not text:
        return "en"
    arabic_count = len(re.findall(r"[\u0600-\u06FF]", text))
    latin_count = len(re.findall(r"[a-zA-Z]", text))
    if arabic_count > latin_count:
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
        template_parser: TemplateParserPort | None = None,
        embedding_dimension: int = 1536,
    ):
        self.llm_provider = llm_provider
        self.vector_store = vector_store
        self.embedding_provider = embedding_provider
        self.template_parser = template_parser
        self._embedding_dimension = embedding_dimension

    @abstractmethod
    def can_handle(self, input_data: AgentInput) -> bool:
        """
        Returns True if this agent should handle the given input.
        RouterAgent uses this to decide routing.
        """
        pass

    @abstractmethod
    async def run(
        self, input_data: AgentInput, retrieved_documents: Any | None = None
    ) -> AgentOutput:
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

    async def run(
        self, input_data: AgentInput, retrieved_documents: list[dict] | None = None
    ) -> AgentOutput:
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

    async def run(
        self, input_data: AgentInput, retrieved_documents: Any | None = None
    ) -> AgentOutput:
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

            collection_name = f"collection_{self._embedding_dimension}_{input_data.project_id}"

            results = await self.vector_store.search_by_vector(
                collection_name=collection_name,
                vector=raw_vec,
                limit=fetch_limit,
            )

            # No reranker configured — truncate to requested limit
            results = results[: input_data.limit]

            if not results:
                return self._make_output(
                    input_data,
                    result=RetrievalResult(status=RetrievalStatus.NO_RESULTS),
                    success=True,
                    metadata={"warning": "No documents found in collection"},
                )

            docs = [
                RetrievedDocument(
                    text=r.get("text", ""),
                    score=r.get("score", 0.0),
                    metadata=r.get("metadata", {}),
                    id=r.get("id")
                ) for r in results
            ]

            status = RetrievalStatus.SUCCESS
            if docs and docs[0].score < 0.2:
                status = RetrievalStatus.LOW_CONFIDENCE

            return self._make_output(
                input_data,
                result=RetrievalResult(status=status, documents=docs),
                metadata={"doc_count": len(results)},
            )

        except Exception as e:
            logger.error(f"[RetrieverAgent] error: {e}")
            return self._make_output(
                input_data,
                success=False,
                error=str(e),
                result=RetrievalResult(status=RetrievalStatus.FAILED)
            )


class AnswerAgent(BaseAgent):
    agent_name = "answer_agent"

    def can_handle(self, input_data: AgentInput) -> bool:
        return input_data.action == AgentAction.ANSWER

    async def run(
        self, input_data: AgentInput, retrieved_documents: Any | None = None
    ) -> AgentOutput:
        try:
            if not self.llm_provider or not self.template_parser:
                raise ValueError("LLM provider and Template Parser required for AnswerAgent")

            if isinstance(retrieved_documents, RetrievalResult):
                docs = retrieved_documents.documents
            else:
                docs = retrieved_documents or []

            base_system_prompt = self.template_parser.get(category="rag", key="system_prompt")

            chat_history = [
                self.llm_provider.construct_prompt(
                    prompt=base_system_prompt or "",
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

            documents_prompts = "\n".join(
                [
                    self.template_parser.get(
                        category="rag",
                        key="document_prompt",
                        variables={
                            "doc_num": idx + 1,
                            "chunk_text": self.llm_provider.process_text(
                                getattr(doc, "text", "")
                            ),
                        },
                    ) or ""
                    for idx, doc in enumerate(docs)
                ]
            )

            lang = "Arabic" if _detect_language(input_data.query) == "ar" else "English"
            lang_prefix = f"[Respond in {lang} only]\n"
            footer = self.template_parser.get(
                category="rag", key="footer_prompt", variables={"query": lang_prefix + input_data.query}
            )
            footer = (footer or "") + _build_language_prompt(input_data.query)

            full_prompt = "\n\n".join([documents_prompts, footer])

            if input_data.stream:
                llm = self.llm_provider
                async def answer_stream():
                    async for chunk in llm.generate_stream(
                        prompt=full_prompt,
                        chat_history=chat_history,
                    ):
                        filtered_chunk = GuardrailPort.validate_output(chunk)
                        if filtered_chunk:
                            yield filtered_chunk

                return self._make_output(
                    input_data,
                    result="streaming",
                    stream_generator=answer_stream(),
                    metadata={"streaming": True, "doc_count": len(docs), "language": lang},
                )

            answer = await self.llm_provider.generate_text(
                prompt=full_prompt,
                chat_history=chat_history,
            )
            if answer is None:
                return self._make_output(
                    input_data, success=False, error="LLM provider returned None — check configuration"
                )
            answer = GuardrailPort.validate_output(answer)

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

    async def run(
        self, input_data: AgentInput, retrieved_documents: Any | None = None
    ) -> AgentOutput:
        try:
            if not self.llm_provider or not self.template_parser:
                raise ValueError("LLM provider and Template Parser required for SummarizerAgent")

            if isinstance(retrieved_documents, RetrievalResult):
                docs = retrieved_documents.documents
                if retrieved_documents.status in (RetrievalStatus.NO_RESULTS, RetrievalStatus.FAILED):
                    return self._make_output(
                        input_data, success=False, error="No relevant documents found to summarize."
                    )
            else:
                docs = retrieved_documents or []

            if not docs:
                return self._make_output(
                    input_data, success=False, error="No relevant documents found."
                )

            system_prompt = self.template_parser.get(category="rag", key="summarize_system_prompt")
            footer_prompt = self.template_parser.get(category="rag", key="summarize_footer_prompt") or ""

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
                        category="rag",
                        key="document_prompt",
                        variables={
                            "doc_num": idx + 1,
                            "chunk_text": doc.text if hasattr(doc, "text") else getattr(doc, "chunk_text", ""),
                        },
                    ) or ""
                    for idx, doc in enumerate(docs)
                ]
            )

            chat_history = [
                self.llm_provider.construct_prompt(
                    prompt=system_prompt or "",
                    role="system",
                )
            ]

            full_prompt = "\n\n".join([documents_prompts, footer_prompt])

            if input_data.stream:
                llm = self.llm_provider
                async def summary_stream():
                    async for chunk in llm.generate_stream(
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

            summary = await self.llm_provider.generate_text(
                prompt=full_prompt,
                chat_history=chat_history,
                max_output_tokens=4000,
            )
            if summary is None:
                return self._make_output(
                    input_data, success=False, error="LLM provider returned None — check configuration"
                )

            return self._make_output(input_data, result={"summary": summary})

        except Exception as e:
            logger.error(f"[SummarizerAgent] error: {e}")
            return self._make_output(input_data, success=False, error=str(e))


class QuizAgent(BaseAgent):
    agent_name = "quiz_agent"

    def can_handle(self, input_data: AgentInput) -> bool:
        return input_data.action == AgentAction.QUIZ

    async def run(
        self, input_data: AgentInput, retrieved_documents: Any | None = None
    ) -> AgentOutput:
        try:
            if not self.llm_provider or not self.template_parser:
                raise ValueError("LLM provider and Template Parser required for QuizAgent")

            if isinstance(retrieved_documents, RetrievalResult):
                docs = retrieved_documents.documents
                if retrieved_documents.status in (RetrievalStatus.NO_RESULTS, RetrievalStatus.FAILED):
                    return self._make_output(
                        input_data, success=False, error="No relevant documents found to generate quiz."
                    )
            else:
                docs = retrieved_documents or []

            if not docs:
                return self._make_output(
                    input_data, success=False, error="No relevant documents found."
                )

            system_prompt = self.template_parser.get(
                category="rag", key="quiz_system_prompt", variables={"num_questions": 3}
            )
            footer_prompt = self.template_parser.get(
                category="rag", key="quiz_footer_prompt", variables={"num_questions": 3}
            ) or ""

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
                        category="rag",
                        key="document_prompt",
                        variables={
                            "doc_num": idx + 1,
                            "chunk_text": doc.text if hasattr(doc, "text") else getattr(doc, "chunk_text", ""),
                        },
                    ) or ""
                    for idx, doc in enumerate(docs)
                ]
            )

            chat_history = [
                self.llm_provider.construct_prompt(
                    prompt=system_prompt or "",
                    role="system",
                )
            ]

            full_prompt = "\n\n".join([documents_prompts, footer_prompt])

            if input_data.stream:
                llm = self.llm_provider
                async def quiz_stream():
                    async for chunk in llm.generate_stream(
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

            quiz = await self.llm_provider.generate_text(
                prompt=full_prompt,
                chat_history=chat_history,
                max_output_tokens=2000,
            )
            if quiz is None:
                return self._make_output(
                    input_data, success=False, error="LLM provider returned None — check configuration"
                )

            return self._make_output(input_data, result={"quiz": quiz})

        except Exception as e:
            logger.error(f"[QuizAgent] error: {e}")
            return self._make_output(input_data, success=False, error=str(e))
