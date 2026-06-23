import asyncio
import json
import logging
import os
import time
from logging.handlers import TimedRotatingFileHandler
from app.application.chat.chat_use_case import ChatUseCase

# Secure logging setup: TimedRotatingFileHandler with a maxBytes wrapper
class SizedTimedRotatingFileHandler(TimedRotatingFileHandler):
    """
    Extends TimedRotatingFileHandler to also rotate when the file size exceeds maxBytes.
    """
    def __init__(self, filename, when='h', interval=1, backupCount=0, encoding=None, delay=False, utc=False, atTime=None, maxBytes=0):
        super().__init__(filename, when, interval, backupCount, encoding, delay, utc, atTime)
        self.maxBytes = maxBytes

    def shouldRollover(self, record):
        # Check size limit
        if self.maxBytes > 0:
            msg = "%s\n" % self.format(record)
            self.stream.seek(0, 2)  # Go to end
            if self.stream.tell() + len(msg) >= self.maxBytes:
                return 1
        return super().shouldRollover(record)

log_dir = "/var/log"
if not os.access(log_dir, os.W_OK):
    log_dir = "./logs"
os.makedirs(log_dir, exist_ok=True)

log_file = os.path.join(log_dir, "rag_ab.log")

ab_logger = logging.getLogger("rag_ab_logger")
ab_logger.setLevel(logging.INFO)

# 100MB max bytes
handler = SizedTimedRotatingFileHandler(
    log_file, 
    when="midnight", 
    interval=1, 
    backupCount=7, 
    maxBytes=100 * 1024 * 1024
)
formatter = logging.Formatter('%(asctime)s - %(message)s')
handler.setFormatter(formatter)
ab_logger.addHandler(handler)

async def run_shadow_test(
    legacy_chat_use_case: ChatUseCase,
    query: str,
    user_id: str,
    session_id: str | None,
    document_id: str | None,
    new_path_response: str,
    new_path_latency: float
):
    """
    Executes the legacy prompt path in the background to compare against the new path.
    Logs the difference securely via the A/B logger.
    """
    try:
        start_time = time.time()
        
        from app.infrastructure.db.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            # We explicitly pass metadata_filter=None or specific settings if needed
            # We assume the legacy_chat_use_case uses the legacy prompt
            legacy_response = await legacy_chat_use_case.execute_rag_query(
                query=query,
                user_id=user_id,
                session_id=session_id,
                document_id=document_id
            )
            
        legacy_latency = time.time() - start_time
        
        log_payload = {
            "query": query,
            "user_id": user_id,
            "document_id": document_id,
            "new_path": {
                "response": new_path_response,
                "latency_sec": round(new_path_latency, 3)
            },
            "legacy_path": {
                "response": legacy_response,
                "latency_sec": round(legacy_latency, 3)
            }
        }
        
        ab_logger.info(json.dumps(log_payload))
        
    except Exception as e:
        ab_logger.error(f"Shadow test failed: {str(e)}")

def execute_ab_shadow_run(*args, **kwargs):
    """
    Fire-and-forget wrapper to ensure zero latency impact on the user-facing response.
    """
    asyncio.create_task(run_shadow_test(*args, **kwargs))
