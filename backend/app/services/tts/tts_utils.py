"""
Utilities for TTS Service
"""
import base64
import re
from typing import List, Dict, Optional
import wave
import io
from pydub import AudioSegment
from loguru import logger

from app.services.tts.base import VisemeEvent, WordBoundary


def audio_to_base64(audio_bytes: bytes) -> str:
    """Convert audio bytes to base64 string"""
    return base64.b64encode(audio_bytes).decode("utf-8")


def base64_to_audio(b64_string: str) -> bytes:
    """Convert base64 string to audio bytes"""
    return base64.b64decode(b64_string)


def clean_text_for_tts(text: str) -> str:
    """
    Clean text before sending to TTS
    - Remove markdown
    - Remove excessive emojis
    - Ensure proper punctuation
    """
    # Remove markdown bold/italic
    text = re.sub(r'\*{1,3}(.+?)\*{1,3}', r'\1', text)

    # Remove markdown code blocks
    text = re.sub(r'`{1,3}[^`]*`{1,3}', '', text)

    # Remove URLs
    text = re.sub(r'http[s]?://\S+', '', text)

    # Remove emojis (optional)
    # text = re.sub(r'[^\w\s.,!?؟،؛]', '', text)

    # Clean extra whitespace
    text = re.sub(r'\s+', ' ', text).strip()

    return text


def split_text_for_tts(text: str, max_length: int = 500) -> List[str]:
    """
    Split long text into smaller chunks
    Makes TTS faster and starts streaming quickly
    Split on:
    1. Sentences (. ! ? ؟ !)
    2. Commas (، ,)
    3. Max length
    """
    if len(text) <= max_length:
        return [text]

    # Split on sentence boundaries
    sentence_pattern = r'(?<=[.!?؟!])\s+'
    sentences = re.split(sentence_pattern, text)

    chunks = []
    current_chunk = ""

    for sentence in sentences:
        if len(current_chunk) + len(sentence) <= max_length:
            current_chunk += sentence + " "
        else:
            if current_chunk:
                chunks.append(current_chunk.strip())
            current_chunk = sentence + " "

    if current_chunk:
        chunks.append(current_chunk.strip())

    return chunks if chunks else [text]


def calculate_audio_duration(audio_bytes: bytes, format: str = "mp3") -> float:
    """
    Calculate audio duration accurately using pydub
    Falls back to estimation if pydub fails
    """
    try:
        audio = AudioSegment.from_file(io.BytesIO(audio_bytes), format=format)
        return len(audio)  # milliseconds
    except Exception as e:
        logger.warning(f"Failed to calculate exact duration, estimating: {e}")
        # Fallback: MP3 @ ~24kbps = 3000 bytes/sec
        bytes_per_ms = 3000 / 1000.0
        return len(audio_bytes) / bytes_per_ms


def visemes_to_dict_list(visemes: List[VisemeEvent]) -> List[Dict]:
    """Convert list of VisemeEvent objects to dicts for JSON"""
    return [
        {
            "offset_ms": v.offset_ms,
            "viseme_id": v.viseme_id,
            "duration_ms": v.duration_ms,
        }
        for v in visemes
    ]


def word_boundaries_to_dict_list(boundaries: List[WordBoundary]) -> List[Dict]:
    """Convert list of WordBoundary objects to dicts for JSON"""
    return [
        {
            "word": w.word,
            "offset_ms": w.offset_ms,
            "duration_ms": w.duration_ms,
        }
        for w in boundaries
    ]


def merge_viseme_lists(viseme_lists: List[List[VisemeEvent]]) -> List[VisemeEvent]:
    """
    Merge multiple viseme lists from different TTS chunks
    Adjusts offsets for sequential playback
    """
    if not viseme_lists:
        return []
    
    merged = []
    time_offset = 0.0
    
    for viseme_list in viseme_lists:
        for viseme in viseme_list:
            merged.append(VisemeEvent(
                offset_ms=viseme.offset_ms + time_offset,
                viseme_id=viseme.viseme_id,
                duration_ms=viseme.duration_ms
            ))
        
        if viseme_list:
            time_offset += viseme_list[-1].offset_ms + viseme_list[-1].duration_ms
    
    return merged


def estimate_tts_cost(text: str) -> Dict[str, int]:
    """
    Estimate TTS cost based on text length
    Returns character count and estimated duration
    """
    char_count = len(text)
    # Average speaking rate: ~150 words per minute
    # Average word length: ~5 characters
    words = len(text.split())
    estimated_seconds = (words / 150) * 60
    
    return {
        "characters": char_count,
        "words": words,
        "estimated_seconds": round(estimated_seconds, 1)
    }