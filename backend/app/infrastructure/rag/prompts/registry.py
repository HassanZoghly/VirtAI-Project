from dataclasses import dataclass
from string import Template

from app.domain.rag.task_types import Locale, TaskType
from app.infrastructure.rag.prompts import ar, en


@dataclass(frozen=True)
class PromptSet:
    system: Template
    document: Template
    footer: Template

_PROMPT_TABLE: dict[tuple[TaskType, Locale], PromptSet] = {}

def _build_table() -> None:
    for locale, module in [(Locale.EN, en), (Locale.AR, ar)]:
        doc = module.document_prompt

        _PROMPT_TABLE[(TaskType.SIMPLE_QA, locale)] = PromptSet(
            system=module.system_prompt,
            document=doc,
            footer=module.footer_prompt,
        )

        _PROMPT_TABLE[(TaskType.EXPLANATION, locale)] = PromptSet(
            system=module.system_prompt,
            document=doc,
            footer=module.footer_prompt,
        )

        _PROMPT_TABLE[(TaskType.QUIZ, locale)] = PromptSet(
            system=module.quiz_system_prompt,
            document=doc,
            footer=module.quiz_footer_prompt,
        )

        _PROMPT_TABLE[(TaskType.SUMMARY, locale)] = PromptSet(
            system=module.summarize_system_prompt,
            document=doc,
            footer=module.summarize_footer_prompt,
        )

        _PROMPT_TABLE[(TaskType.SUMMARY_BATCH, locale)] = PromptSet(
            system=module.summary_batch_system_prompt,
            document=doc,
            footer=module.summary_batch_footer_prompt,
        )

        _PROMPT_TABLE[(TaskType.DIAGRAM, locale)] = PromptSet(
            system=module.diagram_system_prompt,
            document=doc,
            footer=module.diagram_footer_prompt,
        )

_build_table()

def get_prompt_set(task: TaskType, locale: Locale) -> PromptSet:
    """Returns the correct PromptSet for the given task and locale."""
    return _PROMPT_TABLE[(task, locale)]
