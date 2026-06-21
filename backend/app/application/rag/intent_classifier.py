import asyncio
import threading
import numpy as np
import numpy.typing as npt
from fastembed import TextEmbedding

class IntentClassifier:
    """
    Fast local semantic intent classifier for Voice Avatar to avoid expensive retrieval
    for simple greetings and conversational acknowledgments.
    Uses thread-safe lazy Singleton pattern.
    """
    _instance = None
    _lock = threading.Lock()

    def __new__(cls) -> 'IntentClassifier':
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(IntentClassifier, cls).__new__(cls)
                cls._instance._initialize()
        return cls._instance

    def _initialize(self) -> None:
        """Initialize the embedding model and anchor embeddings."""
        import logging
        try:
            from app.shared.config import get_settings
            model_name = get_settings().EMBEDDING_MODEL or "BAAI/bge-small-en-v1.5"
            self.model = TextEmbedding(model_name=model_name)
            self.is_initialized = True
        except Exception as e:
            logging.getLogger(__name__).error(f"[IntentClassifier] Initialization failed: {e}. Semantic routing will be disabled.")
            self.model = None
            self.is_initialized = False
            return
        
        # The E5 model requires "query: " prefix for asymmetric tasks
        prefix = ""  # BGE does not strictly require this for semantic similarity
        
        raw_anchors = [
            # English Anchors
            "hello", "hi", "hey", "greetings", "good morning", "good evening", "good afternoon",
            "how are you", "what's up", "how's it going", "how are you doing",
            "thanks", "thank you", "thanks a lot", "thx", "appreciate it",
            "ok", "okay", "got it", "makes sense", "understood", "i see", "sure", "alright", "fine",
            "bye", "goodbye", "see you", "cya", "catch you later",
            "yes", "no", "yep", "nope", "yeah", "nah",
            # Arabic Anchors
            "مرحبا", "أهلا", "هلا", "سلام", "السلام عليكم", "السلام عليكم ورحمة الله", "صباح الخير", "مساء الخير",
            "كيفك", "كيف حالك", "شخبارك", "عامل ايه",
            "شكرا", "شكراً", "يعطيك العافية", "تسلم", "مشكور", "الف شكر",
            "تمام", "حسنا", "حسناً", "مفهوم", "طيب", "اوكي", "ماشي", "زين",
            "مع السلامة", "وداعا", "وداعاً", "باي", "الى اللقاء",
            "نعم", "لا", "اه", "ايوه", "أجل", "كلا", "يا هندسة", "السلام عليكم، يا هندسة"
        ]
        
        anchors = [prefix + a for a in raw_anchors]
        
        # Compute embeddings for all anchors exactly once
        embeddings_iter = self.model.embed(anchors)
        self.anchor_embeddings: npt.NDArray[np.float64] = np.vstack(list(embeddings_iter))
        
        # Pre-normalize anchor embeddings to speed up cosine similarity calculation
        norms = np.linalg.norm(self.anchor_embeddings, axis=1, keepdims=True)
        self.anchor_embeddings_normalized: npt.NDArray[np.float64] = self.anchor_embeddings / norms

    @classmethod
    def _is_casual_chat_sync(cls, text: str, threshold: float = 0.82) -> bool:
        text = text.strip()
        if not text:
            return True
            
        # Fast-path fallback for long queries (likely domain questions)
        if len(text) > 80:
            return False
            
        try:
            # Get singleton instance (thread-safe initialization)
            instance = cls()
            if getattr(instance, "model", None) is None or not getattr(instance, "is_initialized", False):
                return False
            
            # Use appropriate prefix if defined
            prefixed_text = text
            
            # Embed the incoming query text
            query_embedding_list = list(instance.model.embed([prefixed_text]))
            if not query_embedding_list:
                return False
                
            query_embedding: npt.NDArray[np.float64] = query_embedding_list[0]
            
            # Normalize the query embedding
            query_norm = np.linalg.norm(query_embedding)
            if query_norm == 0:
                return False
                
            query_normalized: npt.NDArray[np.float64] = query_embedding / query_norm
            
            # Calculate cosine similarities using vectorized dot product
            scores = np.dot(instance.anchor_embeddings_normalized, query_normalized)
            max_score = float(np.max(scores))
            
            return max_score > threshold
        except Exception as e:
            # Fallback to standard RAG retrieval on model failure (e.g. timeout, OOM)
            return False

    @classmethod
    async def async_is_casual_chat(cls, text: str, threshold: float = 0.82) -> bool:
        """
        Non-blocking async wrapper to prevent event loop blocking during 
        synchronous CPU-bound embedding calculations.
        """
        return await asyncio.to_thread(cls._is_casual_chat_sync, text, threshold)

    @classmethod
    def preload(cls) -> None:
        """Explicitly load the model into memory. Useful during FastAPI lifespan startup."""
        cls()
