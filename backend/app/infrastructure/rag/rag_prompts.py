"""
Deprecated backwards-compatibility shim for old prompts.
Use app.infrastructure.rag.prompts.registry instead.
"""

import sys
from loguru import logger

def __getattr__(name: str):
    from app.infrastructure.rag.prompts import en
    if hasattr(en, name):
        logger.warning(
            f"Directly importing '{name}' from app.infrastructure.rag.rag_prompts is deprecated. "
            "Use app.infrastructure.rag.prompts.registry instead."
        )
        return getattr(en, name)
    raise AttributeError(f"module '{__name__}' has no attribute '{name}'")
