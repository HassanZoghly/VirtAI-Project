"""
Animation intelligence engine.

Transforms LLM response text into a dynamic animation timeline tuned for
frontend blending behavior (crossfades, continuity, and repetition avoidance).
"""

from __future__ import annotations

import math
import random
import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, ClassVar

from app.application.animation.animation_mapper import AnimationMapper


@dataclass(frozen=True)
class AnimationProfile:
    animation_id: str
    asset_name: str
    gesture_type: str
    intensity: float
    start_frame: int
    end_frame: int
    transition_out_frame: int
    loop_start_frame: int
    loop_end_frame: int


class AnimationIntelligenceService:
    _INTENT_KEYWORDS: ClassVar[dict[str, tuple[str, ...]]] = {
        "question": ("?", "why", "how", "what", "when", "where", "which"),
        "emphasis": ("important", "must", "always", "never", "key", "critical"),
        "explanation": ("because", "therefore", "means", "for example", "step", "first"),
        "reassurance": ("don't worry", "it's okay", "you can", "great", "good job"),
        "transition": ("next", "then", "now", "finally", "also", "in addition"),
    }

    _GESTURE_INTENT_AFFINITY: ClassVar[dict[str, tuple[str, ...]]] = {
        "explanatory": ("explanation", "transition"),
        "emphasis": ("emphasis",),
        "inquisitive": ("question",),
        "warm": ("reassurance",),
        "neutral": ("transition", "explanation"),
    }

    def __init__(self) -> None:
        self._profiles = self._build_profiles()
        self._mapper = AnimationMapper()

    @staticmethod
    def _clamp(value: float, low: float, high: float) -> float:
        return max(low, min(high, value))

    def build_timeline(
        self,
        text: str,
        recent_assets: list[str] | None = None,
        emotion: str | None = None,
        profile_usage: dict[str, int] | None = None,
        intent_history: list[str] | None = None,
    ) -> dict:
        """
        Build animation timeline from response text.

        Output contract is optimized for frontend AnimationMixer-based playback.
        """
        if profile_usage is None:
            profile_usage = defaultdict(int)
        if intent_history is None:
            intent_history = []
        recent = recent_assets or []
        segments = self._segment_text(text)
        timeline: list[dict] = []
        recent_window = list(recent[-6:])
        previous_intent = intent_history[-1] if intent_history else None
        intent_trace: list[str] = []

        for segment in segments:
            mapping = self._mapper.map_segment(
                segment,
                emotion=emotion,
                previous_intent=previous_intent,
            )
            intent_scores = mapping.intent_scores
            intent = mapping.intent
            tone = mapping.tone
            profile = self._select_profile(
                intent=intent,
                tone=tone,
                recent_assets=recent_window,
                profile_usage=profile_usage,
                previous_intent=previous_intent,
            )
            blend = self._blend_for_transition(
                previous=recent_window[-1] if recent_window else None, current=profile
            )

            timeline.append(
                {
                    "animation": profile.animation_id,
                    "animation_asset": profile.asset_name,
                    "start_frame": profile.start_frame,
                    "end_frame": profile.end_frame,
                    "transition_out_frame": profile.transition_out_frame,
                    "loop_start_frame": profile.loop_start_frame,
                    "loop_end_frame": profile.loop_end_frame,
                    "blend": round(blend, 3),
                    "intent": intent,
                    "intent_scores": {k: round(v, 4) for k, v in intent_scores.items()},
                    "tone": tone,
                    "text": segment,
                }
            )
            recent_window.append(profile.asset_name)
            recent_window = recent_window[-6:]
            profile_usage[profile.asset_name] += 1
            previous_intent = intent
            intent_trace.append(intent)

        if intent_trace:
            intent_history.extend(intent_trace)
            intent_history[:] = intent_history[-24:]

        return {
            "timeline": timeline,
            "meta": {
                "segments": len(segments),
                "source": "heuristic-probabilistic-v1",
                "uses_softmax": True,
                "intent_trace": intent_trace,
            },
        }

    def build_timeline_v2(
        self,
        text: str,
        audio_features: dict[str, Any],
        recent_assets: list[str] | None = None,
        emotion: str | None = None,
        profile_usage: dict[str, int] | None = None,
        intent_history: list[str] | None = None,
    ) -> dict[str, Any]:
        """
        Build an audio-synchronized timeline by fusing semantic intent and speech features.

        audio_features contract (from ``analyze_tts_for_animation``):
        - duration_s: float
        - speech_rate_wps: float
        - emphasis_timestamps: list[float]
        - energy_curve: [{time, value}]
        - pause_segments: [{start_time, end_time}]
        """
        if profile_usage is None:
            profile_usage = defaultdict(int)
        if intent_history is None:
            intent_history = []

        duration_s = float(audio_features.get("duration_s") or 0.0)
        duration_s = max(0.2, duration_s)

        semantic_segments = self._segment_text(text)
        if not semantic_segments and text.strip():
            semantic_segments = [text.strip()]

        windows = self._allocate_segment_windows(semantic_segments, duration_s)
        energy_curve = self._normalize_energy_curve(audio_features.get("energy_curve"), duration_s)
        emphasis_marks = self._normalize_emphasis(
            audio_features.get("emphasis_timestamps"),
            duration_s,
        )
        speech_rate = float(audio_features.get("speech_rate_wps") or 2.3)
        pause_segments = self._normalize_time_segments(
            audio_features.get("pause_segments"), duration_s
        )

        timeline: list[dict[str, Any]] = []
        recent_window = list((recent_assets or [])[-6:])
        previous_intent = intent_history[-1] if intent_history else None
        intent_trace: list[str] = []

        for segment, (start_time, end_time) in zip(semantic_segments, windows, strict=False):
            if end_time - start_time < 0.06:
                continue

            mapping = self._mapper.map_segment(
                segment,
                emotion=emotion,
                previous_intent=previous_intent,
            )
            intent_scores = mapping.intent_scores
            intent = mapping.intent
            tone = mapping.tone
            profile = self._select_profile(
                intent=intent,
                tone=tone,
                recent_assets=recent_window,
                profile_usage=profile_usage,
                previous_intent=previous_intent,
            )

            local_energy = self._average_energy(energy_curve, start_time, end_time)
            emphasis_hits = sum(1 for mark in emphasis_marks if start_time <= mark <= end_time)
            intensity = self._clamp(
                profile.intensity * 0.58 + local_energy * 0.34 + min(0.18, emphasis_hits * 0.07),
                0.22,
                1.0,
            )
            speed = self._clamp(
                0.92
                + (speech_rate - 2.3) * 0.13
                + (local_energy - 0.5) * 0.22
                + emphasis_hits * 0.03,
                0.75,
                1.35,
            )
            blend_weight = self._clamp(
                self._blend_for_transition(
                    previous=recent_window[-1] if recent_window else None,
                    current=profile,
                )
                + min(0.08, emphasis_hits * 0.03),
                0.16,
                0.52,
            )

            transition_type = "emphasis" if emphasis_hits > 0 else "smooth"
            timeline.append(
                {
                    "start_time": round(start_time, 3),
                    "end_time": round(end_time, 3),
                    "animation": profile.animation_id,
                    "animation_asset": profile.asset_name,
                    "blend_weight": round(blend_weight, 3),
                    "speed": round(speed, 3),
                    "intensity": round(intensity, 3),
                    "transition_type": transition_type,
                    "intent": intent,
                    "intent_scores": {k: round(v, 4) for k, v in intent_scores.items()},
                    "tone": tone,
                    "text": segment,
                    "start_frame": profile.start_frame,
                    "end_frame": profile.end_frame,
                    "transition_out_frame": profile.transition_out_frame,
                    "loop_start_frame": profile.loop_start_frame,
                    "loop_end_frame": profile.loop_end_frame,
                }
            )

            recent_window.append(profile.asset_name)
            recent_window = recent_window[-6:]
            profile_usage[profile.asset_name] += 1
            previous_intent = intent
            intent_trace.append(intent)

        for pause in pause_segments:
            start_time = float(pause["start_time"])
            end_time = float(pause["end_time"])
            if end_time - start_time < 0.12:
                continue

            timeline.append(
                {
                    "start_time": round(start_time, 3),
                    "end_time": round(end_time, 3),
                    "animation": "idle",
                    "animation_asset": "Idle",
                    "blend_weight": 0.2,
                    "speed": 1.0,
                    "intensity": 0.24,
                    "transition_type": "pause",
                    "intent": "transition",
                    "intent_scores": {"transition": 1.0},
                    "tone": "neutral",
                    "text": "",
                    "start_frame": 0,
                    "end_frame": 36,
                    "transition_out_frame": 30,
                    "loop_start_frame": 8,
                    "loop_end_frame": 30,
                }
            )

        timeline = self._normalize_timeline_ranges(timeline, duration_s)

        if intent_trace:
            intent_history.extend(intent_trace)
            intent_history[:] = intent_history[-24:]

        return {
            "timeline": timeline,
            "meta": {
                "segments": len(semantic_segments),
                "source": "audio-semantic-v2",
                "duration_s": round(duration_s, 3),
                "speech_rate_wps": round(speech_rate, 3),
                "emphasis_count": len(emphasis_marks),
                "intent_trace": intent_trace,
            },
        }

    def _normalize_time_segments(
        self, raw_segments: Any, duration_s: float
    ) -> list[dict[str, float]]:
        if not isinstance(raw_segments, list):
            return []

        normalized: list[dict[str, float]] = []
        for item in raw_segments:
            if not isinstance(item, dict):
                continue

            start = item.get("start_time")
            end = item.get("end_time")
            if not isinstance(start, (float, int)) or not isinstance(end, (float, int)):
                continue

            s = self._clamp(float(start), 0.0, duration_s)
            e = self._clamp(float(end), 0.0, duration_s)
            if e - s <= 0:
                continue
            normalized.append({"start_time": s, "end_time": e})

        normalized.sort(key=lambda seg: seg["start_time"])
        return normalized

    def _normalize_energy_curve(self, raw_curve: Any, duration_s: float) -> list[dict[str, float]]:
        if not isinstance(raw_curve, list):
            return []

        normalized: list[dict[str, float]] = []
        for point in raw_curve:
            if not isinstance(point, dict):
                continue
            t = point.get("time")
            v = point.get("value")
            if not isinstance(t, (float, int)) or not isinstance(v, (float, int)):
                continue

            normalized.append(
                {
                    "time": self._clamp(float(t), 0.0, duration_s),
                    "value": self._clamp(float(v), 0.0, 1.0),
                }
            )

        normalized.sort(key=lambda p: p["time"])
        return normalized

    def _normalize_emphasis(self, raw_marks: Any, duration_s: float) -> list[float]:
        if not isinstance(raw_marks, list):
            return []

        marks: list[float] = []
        for mark in raw_marks:
            if not isinstance(mark, (float, int)):
                continue
            marks.append(round(self._clamp(float(mark), 0.0, duration_s), 3))
        marks.sort()
        return marks

    def _allocate_segment_windows(
        self, segments: list[str], duration_s: float
    ) -> list[tuple[float, float]]:
        if not segments:
            return []

        weights: list[float] = []
        for segment in segments:
            words = max(1, len(segment.split()))
            punctuation_boost = segment.count("!") * 0.35 + segment.count("?") * 0.25
            weights.append(words + punctuation_boost)

        total = sum(weights) or float(len(segments))
        windows: list[tuple[float, float]] = []
        cursor = 0.0

        for idx, weight in enumerate(weights):
            share = duration_s * (weight / total)
            if idx == len(weights) - 1:
                end = duration_s
            else:
                end = self._clamp(cursor + share, 0.0, duration_s)

            if end - cursor < 0.06:
                end = self._clamp(cursor + 0.06, 0.0, duration_s)

            windows.append((round(cursor, 4), round(end, 4)))
            cursor = end

        if windows:
            start, _ = windows[-1]
            windows[-1] = (start, duration_s)

        return windows

    def _average_energy(
        self,
        energy_curve: list[dict[str, float]],
        start_time: float,
        end_time: float,
    ) -> float:
        if not energy_curve:
            return 0.5

        values = [
            float(point["value"])
            for point in energy_curve
            if start_time <= float(point["time"]) <= end_time
        ]
        if not values:
            return 0.5
        return sum(values) / len(values)

    def _normalize_timeline_ranges(
        self,
        timeline: list[dict[str, Any]],
        duration_s: float,
    ) -> list[dict[str, Any]]:
        if not timeline:
            return []

        ordered = sorted(
            timeline, key=lambda item: (item.get("start_time", 0.0), item.get("end_time", 0.0))
        )
        normalized: list[dict[str, Any]] = []

        for item in ordered:
            start = self._clamp(float(item.get("start_time", 0.0)), 0.0, duration_s)
            end = self._clamp(float(item.get("end_time", start + 0.08)), 0.0, duration_s)

            if normalized:
                prev_end = float(normalized[-1]["end_time"])
                if start < prev_end:
                    start = prev_end
            if end - start < 0.06:
                end = self._clamp(start + 0.06, 0.0, duration_s)

            if end <= start:
                continue

            item["start_time"] = round(start, 3)
            item["end_time"] = round(end, 3)
            normalized.append(item)

        return normalized

    def _segment_text(self, text: str) -> list[str]:
        cleaned = re.sub(r"\s+", " ", text).strip()
        if not cleaned:
            return []

        raw = [p.strip() for p in re.split(r"(?<=[.!?])\s+", cleaned) if p.strip()]
        result: list[str] = []
        for chunk in raw:
            if len(chunk) <= 140:
                result.append(chunk)
                continue
            parts = [p.strip() for p in re.split(r",\s+", chunk) if p.strip()]
            result.extend(parts or [chunk])
        return result[:16]

    def _detect_tone(self, segment: str, emotion: str | None) -> str:
        if emotion:
            return emotion.lower()
        if "!" in segment:
            return "excited"
        if "?" in segment:
            return "curious"
        return "neutral"

    def _select_profile(
        self,
        intent: str,
        tone: str,
        recent_assets: list[str],
        profile_usage: dict[str, int],
        previous_intent: str | None = None,
    ) -> AnimationProfile:
        candidates: list[tuple[AnimationProfile, float]] = []
        last_asset = recent_assets[-1] if recent_assets else None

        for profile in self._profiles:
            score = 1.0

            if intent in self._GESTURE_INTENT_AFFINITY.get(profile.gesture_type, ()):
                score += 1.35

            if tone in {"excited", "happy"}:
                score += profile.intensity * 0.6
            elif tone in {"neutral", "thinking", "curious"}:
                score += (1.0 - abs(profile.intensity - 0.62)) * 0.35

            if previous_intent and previous_intent == intent:
                score += 0.1

            # Penalize recent usage and immediate repetition.
            for recency_index, asset in enumerate(reversed(recent_assets), start=1):
                if asset == profile.asset_name:
                    score -= max(0.08, 0.62 / recency_index)

            usage_penalty = min(1.2, profile_usage.get(profile.asset_name, 0) * 0.12)
            score -= usage_penalty

            if last_asset == profile.asset_name:
                score -= 1.25

            # Keep score positive for softmax stability.
            score = max(score, 0.05)
            candidates.append((profile, score))

        return self._softmax_pick(candidates)

    def _softmax_distribution(
        self, scores: dict[str, float], temperature: float = 1.0
    ) -> dict[str, float]:
        exps = {k: math.exp(v / max(temperature, 1e-6)) for k, v in scores.items()}
        total = sum(exps.values()) or 1.0
        return {k: val / total for k, val in exps.items()}

    def _softmax_pick(
        self, scored_profiles: list[tuple[AnimationProfile, float]]
    ) -> AnimationProfile:
        temperature = 0.85
        exps = [math.exp(score / temperature) for _, score in scored_profiles]
        total = sum(exps)
        threshold = random.random() * total
        cumulative = 0.0

        for idx, (profile, _) in enumerate(scored_profiles):
            cumulative += exps[idx]
            if cumulative >= threshold:
                return profile
        return scored_profiles[-1][0]

    def _blend_for_transition(self, previous: str | None, current: AnimationProfile) -> float:
        if previous is None:
            return 0.28
        prev_profile = next((p for p in self._profiles if p.asset_name == previous), None)
        if prev_profile is None:
            return 0.26
        intensity_delta = abs(prev_profile.intensity - current.intensity)
        return max(0.18, min(0.45, 0.22 + intensity_delta * 0.32))

    def _build_profiles(self) -> list[AnimationProfile]:
        assets = self._discover_talk_assets()
        profiles: list[AnimationProfile] = []

        gesture_map = {
            1: "neutral",
            2: "explanatory",
            3: "inquisitive",
            4: "emphasis",
            5: "warm",
            6: "emphasis",
            7: "explanatory",
        }

        for asset in assets:
            # Match Talk_0, Talk_1, etc.
            match = re.match(r"Talk_(\d+)", asset)
            if not match:
                continue

            talk_id = int(match.group(1))
            variant = 1
            animation_id = f"talk{talk_id}"

            # Inferred frame windows favor easing in/out and avoid abrupt cuts.
            start = 8 + (variant * 2)
            end = 50 + talk_id % 3 + (1 if variant == 2 else 0)
            transition_out = max(start + 8, end - 4)
            loop_start = min(start + 4, end - 10)
            loop_end = max(loop_start + 4, end - 6)

            base_intensity = 0.45 + (talk_id * 0.055)
            intensity = min(0.95, base_intensity + (0.04 if variant == 2 else 0.0))

            profiles.append(
                AnimationProfile(
                    animation_id=animation_id,
                    asset_name=asset,
                    gesture_type=gesture_map.get(talk_id, "neutral"),
                    intensity=round(intensity, 3),
                    start_frame=start,
                    end_frame=end,
                    transition_out_frame=transition_out,
                    loop_start_frame=loop_start,
                    loop_end_frame=loop_end,
                )
            )

        if profiles:
            return profiles

        # Fallback profiles if assets are unavailable.
        fallback_assets = [f"Talk{i}.1" for i in range(1, 8)]
        for idx, asset in enumerate(fallback_assets, start=1):
            profiles.append(
                AnimationProfile(
                    animation_id=f"talk{idx}",
                    asset_name=asset,
                    gesture_type="neutral",
                    intensity=0.55 + (idx * 0.04),
                    start_frame=10,
                    end_frame=48,
                    transition_out_frame=44,
                    loop_start_frame=14,
                    loop_end_frame=40,
                )
            )
        return profiles

    def _discover_talk_assets(self) -> list[str]:
        base = (
            Path(__file__).resolve().parents[4]
            / "frontend"
            / "public"
            / "models"
            / "animations"
            / "Talk"
        )
        if not base.exists():
            return []

        assets = []
        for file in base.glob("Talk*.fbx"):
            assets.append(file.stem)
        assets.sort()
        return assets
