import logging

from app.domain.rag.agents import (
    AnswerAgent,
    QuizAgent,
    RetrieverAgent,
    RouterAgent,
    SummarizerAgent,
)
from app.domain.rag.entities import AgentAction, AgentInput, AgentOutput, AgentTrace
from app.domain.rag.ports import EmbeddingProvider, LLMGenerationProvider, VectorCollectionStore
from app.infrastructure.rag.guardrail_service import GuardrailService
from app.infrastructure.rag.template_parser import TemplateParser

logger = logging.getLogger("uvicorn.error")


class AgentOrchestrator:
    """
    Central Application Service for Agent Orchestration.
    Manages the workflow of receiving an input, applying guardrails, routing,
    retrieving context, and dispatching to the appropriate specialist agent.
    """

    def __init__(
        self,
        vector_store: VectorCollectionStore,
        llm_provider: LLMGenerationProvider,
        embedding_provider: EmbeddingProvider,
        template_parser: TemplateParser,
    ):
        shared_dependencies = {
            "llm_provider": llm_provider,
            "vector_store": vector_store,
            "embedding_provider": embedding_provider,
            "template_parser": template_parser,
        }

        self.router = RouterAgent(**shared_dependencies)
        self.retriever = RetrieverAgent(**shared_dependencies)
        self.answer = AnswerAgent(**shared_dependencies)
        self.summarizer = SummarizerAgent(**shared_dependencies)
        self.quiz = QuizAgent(**shared_dependencies)

    async def run(self, input_data: AgentInput) -> AgentTrace:
        return await self._run_internal(input_data, stream=False)

    async def run_stream(self, input_data: AgentInput) -> AgentTrace:
        return await self._run_internal(input_data, stream=True)

    async def _run_internal(self, input_data: AgentInput, stream: bool) -> AgentTrace:
        trace = AgentTrace(
            input_id=input_data.input_id,
            query=input_data.query,
            project_id=input_data.project_id,
        )

        input_data.stream = stream

        # ── step 0: Guardrails Validation ─────────────────────────────
        is_valid, error_msg = GuardrailService.validate_input(input_data.query)
        if not is_valid:
            trace.success = False
            trace.add_step(
                AgentOutput(
                    input_id=input_data.input_id,
                    agent_name="guardrails",
                    success=False,
                    error=error_msg,
                )
            )
            return trace

        # ── step 1: route ONLY if action is ANSWER/UNKNOWN ───────────
        if input_data.action in (AgentAction.ANSWER, AgentAction.UNKNOWN):
            router_output = await self.router.run(input_data)
            trace.add_step(router_output)

            if not router_output.success:
                trace.success = False
                return trace

            routed_input: AgentInput = router_output.result
            routed_input.stream = stream
        else:
            # explicit action — skip router entirely
            routed_input = input_data
            logger.info(f"[Orchestrator] Skipping router, explicit action: {input_data.action}")

        # ── step 2: retrieve ──────────────────────────────────────────
        retriever_output = await self.retriever.run(routed_input)
        trace.add_step(retriever_output)

        retrieved_docs = retriever_output.result or []

        if not retrieved_docs:
            trace.success = False
            trace.add_step(
                AgentOutput(
                    input_id=routed_input.input_id,
                    agent_name="orchestrator",
                    success=False,
                    error=(
                        "No documents found in vector collection. "
                        "Please index your documents first."
                    ),
                )
            )
            return trace

        # ── step 3: specialist agent ──────────────────────────────────
        if routed_input.action == AgentAction.ANSWER:
            output = await self.answer.run(routed_input, retrieved_documents=retrieved_docs)
        elif routed_input.action == AgentAction.SUMMARIZE:
            output = await self.summarizer.run(routed_input, retrieved_documents=retrieved_docs)
        elif routed_input.action == AgentAction.QUIZ:
            output = await self.quiz.run(routed_input, retrieved_documents=retrieved_docs)
        else:
            output = self.retriever._make_output(routed_input, result=retrieved_docs)

        trace.add_step(output)

        if output.success:
            trace.final_answer = output.result
            trace.stream_generator = output.stream_generator
        else:
            trace.success = False

        return trace
