import asyncio
import time
import sys
import os

# Add backend to path so imports work correctly
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from loguru import logger
from app.shared.config import get_settings
from app.infrastructure.db.database import init_db
from app.infrastructure.rag.fastembed_provider import FastEmbedProvider
from app.infrastructure.rag.openai_embedder import OpenAIEmbedder
from app.infrastructure.vector.pgvector_store import SessionManagedPGVectorStore
from app.infrastructure.rag.reranker import DummyCrossEncoderReranker, CrossEncoderReranker
from app.shared.config import get_settings
from app.application.rag.token_budget import TokenBudgetManager
from app.application.rag.retrieval_use_case import RetrievalUseCase
from app.infrastructure.llm.groq_provider import GroqLLMProvider
from app.infrastructure.tts.openai_tts_provider import OpenAITTSProvider
from app.domain.chat.policies import build_conversation
from app.application.chat.prompt_builder import PromptBuilder

QUERIES = [
    "What are the graduation requirements?",
    "كيف يمكنني التسجيل في المواد؟",
    "Explain the history and significance of the university's main faculty in detail.",
    "Who is the dean?",
    "ما هي شروط التخرج؟"
]

async def run_benchmark():
    logger.info("Initializing dependencies for benchmarks...")
    settings = get_settings()
    
    # Init DB
    await init_db()
    
    # Init Embedder
    if settings.EMBEDDING_PROVIDER == "fastembed":
        embedder = FastEmbedProvider(
            model_name=settings.EMBEDDING_MODEL,
            cache_dir=settings.FASTEMBED_CACHE_DIR,
        )
    else:
        embedder = OpenAIEmbedder()
        
    retrieval = RetrievalUseCase(
        embedder=embedder,
        vector_store=SessionManagedPGVectorStore(),
        reranker=DummyCrossEncoderReranker() if get_settings().USE_DUMMY_RERANKER else CrossEncoderReranker(),
        budget_manager=TokenBudgetManager()
    )
    
    llm = GroqLLMProvider(
        model=settings.LLM_MODEL,
        max_tokens=settings.LLM_MAX_TOKENS,
        temperature=settings.LLM_TEMPERATURE,
        api_key=settings.GROQ_API_KEY or "dummy",
    )
    
    tts = OpenAITTSProvider()
    
    results = []
    
    logger.info("Starting Benchmark Suite...")
    
    for idx, query in enumerate(QUERIES, 1):
        logger.info(f"[{idx}/{len(QUERIES)}] Benchmarking query: '{query}'")
        
        # 1. Retrieval Latency
        t0 = time.time()
        try:
            context = await retrieval.execute(query, session_id="benchmark")
            retrieval_latency = time.time() - t0
        except Exception as e:
            logger.error(f"Retrieval failed: {e}")
            context = None
            retrieval_latency = 0.0
            
        # 2. LLM TTFT (Time to First Token)
        prompt = PromptBuilder.build_user_prompt_with_context(query, context)
        history = build_conversation("avatar1")
        history.add_user_message(prompt)
        
        t0 = time.time()
        ttft = None
        full_text_parts = []
        
        try:
            async for chunk in llm.stream(history):
                if chunk.token:
                    if ttft is None:
                        ttft = time.time() - t0
                    full_text_parts.append(chunk.token)
        except Exception as e:
            logger.error(f"LLM failed: {e}")
            if ttft is None:
                ttft = 0.0
                
        full_text = "".join(full_text_parts).strip()
        if not full_text:
            full_text = "This is a fallback text because LLM returned empty."
            
        # 3. TTS TTFA (Time to First Audio)
        first_sentence = full_text.split('.')[0] if '.' in full_text else full_text[:100]
        t0 = time.time()
        ttfa = None
        try:
            await tts.synthesize(first_sentence, trace_id="benchmark")
            ttfa = time.time() - t0
        except Exception as e:
            logger.error(f"TTS failed: {e}")
            ttfa = 0.0
            
        results.append({
            "Query": query,
            "Retrieval Latency (s)": round(retrieval_latency, 3),
            "TTFT (s)": round(ttft if ttft is not None else 0.0, 3),
            "TTFA (s)": round(ttfa if ttfa is not None else 0.0, 3)
        })
        
    # Generate Output
    print("\n" + "="*80)
    print("🎓 VirtAI Benchmark Suite - Final Report 🎓")
    print("="*80 + "\n")
    
    print("| Query | Retrieval Latency (s) | TTFT (s) | TTFA (s) |")
    print("|---|---|---|---|")
    for r in results:
        print(f"| {r['Query']} | {r['Retrieval Latency (s)']} | {r['TTFT (s)']} | {r['TTFA (s)']} |")
    print("\n" + "="*80)

if __name__ == "__main__":
    asyncio.run(run_benchmark())
