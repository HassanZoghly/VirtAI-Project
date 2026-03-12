"""
Viseme Mapping Configuration

This module provides mappings between different phoneme/viseme systems and Ready Player Me morph targets:

1. Microsoft/Edge TTS Viseme IDs → RPM Morph Targets
   Source: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-speech-synthesis-viseme

The Frontend uses the morphTargetName to apply visemes to the GLB model's blend shapes.
"""

from __future__ import annotations

# ── Viseme ID → (morphTargetName, description, example_phonemes) ──────────────

VISEME_MAP: dict[int, dict] = {
    0: {"morph": "viseme_sil", "desc": "Silence", "phonemes": ["_", ""]},
    1: {"morph": "viseme_PP", "desc": "Bilabial", "phonemes": ["p", "b", "m"]},
    2: {"morph": "viseme_FF", "desc": "Labiodental", "phonemes": ["f", "v"]},
    3: {"morph": "viseme_TH", "desc": "Dental", "phonemes": ["th", "dh"]},
    4: {"morph": "viseme_DD", "desc": "Alveolar stop", "phonemes": ["t", "d"]},
    5: {"morph": "viseme_kk", "desc": "Velar", "phonemes": ["k", "g"]},
    6: {"morph": "viseme_CH", "desc": "Palatal", "phonemes": ["ch", "jh", "sh"]},
    7: {"morph": "viseme_SS", "desc": "Sibilant", "phonemes": ["s", "z"]},
    8: {"morph": "viseme_nn", "desc": "Nasal alveolar", "phonemes": ["n", "l"]},
    9: {"morph": "viseme_RR", "desc": "Liquid", "phonemes": ["r"]},
    10: {"morph": "viseme_aa", "desc": "Low vowel", "phonemes": ["ae", "ah"]},
    11: {"morph": "viseme_E", "desc": "Mid vowel", "phonemes": ["eh", "ah"]},
    12: {"morph": "viseme_ih", "desc": "High front", "phonemes": ["ih", "iy"]},
    13: {"morph": "viseme_oh", "desc": "Mid-back vowel", "phonemes": ["ao"]},
    14: {"morph": "viseme_ou", "desc": "High back", "phonemes": ["uh", "uw"]},
    15: {"morph": "viseme_O", "desc": "Open-mid back", "phonemes": ["ow"]},
    16: {"morph": "viseme_aa", "desc": "Low back", "phonemes": ["aa"]},
    17: {"morph": "viseme_E", "desc": "Mid-central", "phonemes": ["ax"]},
    18: {"morph": "viseme_ih", "desc": "Close front", "phonemes": ["iy"]},
    19: {"morph": "viseme_ou", "desc": "Close back", "phonemes": ["uw"]},
    20: {"morph": "viseme_PP", "desc": "Bilabial nasal", "phonemes": ["m", "w"]},
    21: {"morph": "viseme_kk", "desc": "Velar nasal", "phonemes": ["ng"]},
}


# ── ENGLISH Phoneme to Viseme ID ─────────────────────────────────────────────
# Mapping ARPABET phonemes (used by Edge TTS) to viseme IDs

ENGLISH_PHONEME_TO_VISEME: dict[str, int] = {
    # ── Consonants ─────────────────────────────────────────────────
    # Bilabial
    "P": 1,  # p
    "B": 1,  # b
    "M": 1,  # m
    "W": 20,  # w → bilabial nasal variant
    # Labiodental
    "F": 2,  # f
    "V": 2,  # v
    # Dental
    "TH": 3,  # θ
    "DH": 3,  # ð
    # Alveolar stops
    "T": 4,  # t
    "D": 4,  # d
    "N": 8,  # n
    "L": 8,  # l
    # Alveolar sibilants
    "S": 7,  # s
    "Z": 7,  # z
    # Palatal
    "SH": 6,  # ʃ
    "ZH": 6,  # ʒ
    "CH": 6,  # tʃ
    "JH": 6,  # dʒ
    "Y": 12,  # j → high front vowel shape
    # Velar
    "K": 5,  # k
    "G": 5,  # g
    "NG": 21,  # ŋ
    # Liquid
    "R": 9,  # r
    # Glottal
    "HH": 0,  # h
    # ── Vowels ────────────────────────────────────────────────────
    # Low vowels
    "AA": 10,  # ɑ
    "AE": 10,  # æ
    "AH": 10,  # ʌ
    # Mid vowels
    "EH": 11,  # ɛ
    "ER": 17,  # ɚ/ɝ
    "AX": 17,  # ə
    # High front vowels
    "IH": 12,  # ɪ
    "IY": 18,  # i
    # Mid-back vowels
    "AO": 13,  # ɔ
    "OW": 15,  # oʊ
    # High back vowels
    "UH": 14,  # ʊ
    "UW": 19,  # u
    # Diphthongs
    "AW": 10,  # aʊ → aa + ou
    "AY": 10,  # aɪ → aa + ih
    "EY": 11,  # eɪ → E + ih
    "OY": 13,  # ɔɪ → oh + ih
}

# ── Viseme Intensity weights ──────────────────────────────────────────────────
# How "open" the mouth is for each viseme (0.0 → 1.0)
# Used by the frontend to scale morph target influence

VISEME_INTENSITY: dict[int, float] = {
    0: 0.0,  # silence      → fully closed
    1: 0.6,  # PP           → lips pressed
    2: 0.5,  # FF           → teeth on lip
    3: 0.4,  # TH           → tongue between teeth
    4: 0.5,  # DD           → tongue on alveolar
    5: 0.4,  # kk           → back of mouth
    6: 0.6,  # CH           → slight opening
    7: 0.5,  # SS           → teeth close
    8: 0.5,  # nn           → nasal
    9: 0.4,  # RR           → slight opening
    10: 1.0,  # aa           → wide open (jaw drop)
    11: 0.7,  # E            → mid open
    12: 0.5,  # ih           → slight smile
    13: 0.8,  # oh           → mid-back open
    14: 0.6,  # ou           → rounded lips
    15: 0.7,  # O            → rounded open
    16: 1.0,  # aa (variant) → wide open
    17: 0.6,  # E (variant)  → mid open
    18: 0.5,  # ih (variant) → slight
    19: 0.6,  # ou (variant) → rounded
    20: 0.6,  # PP (nasal)   → lips pressed
    21: 0.4,  # kk (nasal)   → back closed
}


# ── Helper Functions ──────────────────────────────────────────────────────────
def get_morph_target(viseme_id: int) -> str:
    """Returns the morph target name for the given viseme ID"""
    return VISEME_MAP.get(viseme_id, VISEME_MAP[0])["morph"]


def get_viseme_intensity(viseme_id: int) -> float:
    """Returns the mouth openness intensity for the given viseme ID (0.0 - 1.0)"""
    return VISEME_INTENSITY.get(viseme_id, 0.0)


def get_all_morph_targets() -> list[str]:
    """Returns all unique morph target names"""
    return list(set(v["morph"] for v in VISEME_MAP.values()))


# ── English helper functions ─────────────────────────────────────────────────
def phoneme_to_viseme(phoneme: str) -> int:
    """
    Maps an English ARPABET phoneme to its viseme ID.
    Returns 0 (silence) if the phoneme is not found.
    """
    return ENGLISH_PHONEME_TO_VISEME.get(phoneme.upper(), 0)


def phonemes_to_viseme_ids(phonemes: list[str]) -> list[int]:
    """
    Converts a list of English phonemes to viseme IDs.
    Useful for debugging or fallback.
    """
    return [phoneme_to_viseme(p) for p in phonemes]
