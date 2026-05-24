"""
Template parser for the agentic RAG prompt pipeline.

Loads prompt templates from ``rag_prompts.py`` and renders them
with variable substitution. English-only — no locale switching.
"""

from __future__ import annotations

from string import Template

from loguru import logger

from app.infrastructure.rag import rag_prompts as _prompts


class TemplateParser:
    """
    Resolves and renders RAG prompt templates.

    Templates are defined as ``string.Template`` attributes in
    ``app.infrastructure.rag.rag_prompts``.

    Usage::

        parser = TemplateParser()
        prompt = parser.get("system_prompt")
        rendered = parser.get("footer_prompt", vars={"query": "What is AI?"})
    """

    def get(
        self,
        category: str,
        key: str,
        variables: dict | None = None,
    ) -> str | None:
        """
        Retrieve and render a prompt template by name.

        Args:
            category: Namespace (ignored, for compatibility with port).
            key: Template attribute name (e.g. "system_prompt", "footer_prompt").
            variables: Substitution variables for ``string.Template.substitute()``.

        Returns:
            Rendered template string.
        """
        if not key:
            return None

        template: Template | None = getattr(_prompts, key, None)
        if template is None:
            logger.warning(f"Template key '{key}' not found in rag_prompts")
            return None

        try:
            return template.substitute(variables or {})
        except (KeyError, ValueError) as exc:
            logger.error(f"Template substitution failed for '{key}': {exc}")
            return None
