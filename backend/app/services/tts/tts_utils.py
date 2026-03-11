"""Backward-compat shim -- canonical source is app.infrastructure.tts.tts_utils."""

from app.infrastructure.tts.tts_utils import (  # noqa: F401
    AudioSegment,
    audio_to_base64,
    base64_to_audio,
    calculate_audio_duration,
    clean_text_for_tts,
    estimate_tts_cost,
    merge_viseme_lists,
    split_text_for_tts,
    visemes_to_dict_list,
    word_boundaries_to_dict_list,
)
