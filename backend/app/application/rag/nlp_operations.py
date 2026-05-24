import json
import logging
from typing import Any

from app.application.rag.orchestrator import AgentOrchestrator
from app.domain.rag.entities import AgentAction, AgentInput, AgentTrace
from app.domain.rag.ports import (
    EmbeddingProvider,
    LLMGenerationProvider,
    TemplateParserPort,
    VectorCollectionStore,
)
from app.infrastructure.db.models import DataChunk, Project
from app.infrastructure.memory.memory_manager import MemoryManager

logger = logging.getLogger("uvicorn.error")


class NLPOperations:
    """
    Application Use Case orchestrating NLP workflows for the Agentic RAG system.
    This replaces the legacy NLPController God-Object.
    It cleanly separates presentation/HTTP from business logic.
    """

    def __init__(
        self,
        vector_store: VectorCollectionStore,
        llm_provider: LLMGenerationProvider,
        embedding_provider: EmbeddingProvider,
        template_parser: TemplateParserPort,
        memory_manager: MemoryManager,
    ):
        self.vector_store = vector_store
        self.llm_provider = llm_provider
        self.embedding_provider = embedding_provider
        self.memory_manager = memory_manager
        self.orchestrator = AgentOrchestrator(
            vector_store=vector_store,
            llm_provider=llm_provider,
            embedding_provider=embedding_provider,
            template_parser=template_parser,
        )

    def _create_collection_name(self, project_id: int) -> str:
        # Assuming 1536 is the standard dimension for the embeddings here.
        return f"collection_1536_{project_id}"

    async def reset_vector_db_collection(self, project_id: int) -> bool:
        collection_name = self._create_collection_name(project_id)
        return await self.vector_store.delete_collection(collection_name=collection_name)

    async def get_vector_db_collection_info(self, project_id: int) -> dict[str, Any] | None:
        collection_name = self._create_collection_name(project_id)
        info = await self.vector_store.get_collection_info(collection_name=collection_name)
        if not info:
            return None
        return json.loads(json.dumps(info, default=lambda x: x.__dict__))

    async def index_into_vector_db(
        self, project: Project, chunks: list[DataChunk], do_reset: bool = False
    ) -> bool:
        """
        Embeds chunk texts and stores them into the designated vector collection.
        """
        collection_name = self._create_collection_name(project.project_id)
        texts = [c.chunk_text.replace("\x00", "").strip() for c in chunks]
        metadata = [c.chunk_metadata or {} for c in chunks]
        record_ids = [c.chunk_id for c in chunks]

        # Use embedding provider directly
        vectors = await self.embedding_provider.embed_batch(texts)

        # We assume embedding_size matches what the model returned.
        # Generally this should be dynamic or pulled from the provider's config.
        embedding_size = len(vectors[0]) if vectors else 1536

        await self.vector_store.create_collection(
            collection_name=collection_name,
            embedding_size=embedding_size,
            do_reset=do_reset,
        )

        success = await self.vector_store.insert_many(
            collection_name=collection_name,
            texts=texts,
            metadata=metadata,
            vectors=vectors,
            record_ids=record_ids,
        )
        return success

    async def execute_agent_query(
        self,
        session_id: str,
        project_id: int,
        query: str,
        action: AgentAction = AgentAction.UNKNOWN,
        limit: int = 5,
        stream: bool = False,
    ) -> AgentTrace:
        """
        Core interaction workflow:
        1. Load context from MemoryManager.
        2. Create AgentInput.
        3. Dispatch to AgentOrchestrator.
        4. Save interaction to MemoryManager.
        """
        try:
            # 1. Fetch relevant memory context
            memory_context = await self.memory_manager.get_context(
                session_id=session_id, project_id=project_id, query=query
            )

            # 2. Prepare the AgentInput
            agent_input = AgentInput(
                query=query,
                project_id=project_id,
                action=action,
                limit=limit,
                stream=stream,
                metadata={"memory_context": memory_context},
            )

            # 3. Run the orchestration pipeline
            if stream:
                trace = await self.orchestrator.run_stream(agent_input)
            else:
                trace = await self.orchestrator.run(agent_input)

            # 4. Save interaction context
            if trace.success and trace.final_answer and not stream:
                # In non-streaming scenarios, we can save immediately.
                # For streaming, the router/handler must save it after consuming the generator.
                final_answer_text = ""
                if isinstance(trace.final_answer, dict):
                    final_answer_text = (
                        trace.final_answer.get("answer")
                        or trace.final_answer.get("summary")
                        or trace.final_answer.get("quiz")
                        or str(trace.final_answer)
                    )
                else:
                    final_answer_text = str(trace.final_answer)

                await self.memory_manager.save_interaction(
                    session_id=session_id,
                    project_id=project_id,
                    user_query=query,
                    assistant_answer=final_answer_text,
                )

            return trace
        except Exception as e:
            logger.error(f"[NLPOperations] Error executing query: {e}")
            raise
