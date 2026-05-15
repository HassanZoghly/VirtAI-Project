# Voice Ports Cleanup Design

Date: 2026-05-15

## Context
The voice domain ports file includes an unused `VisemePort`, unused hexagonal aliases, and a loose type for streaming ASR inputs. The concrete streaming ASR implementation expects a float32 `numpy.ndarray` input, and the viseme generator is instantiated directly rather than injected via the port.

## Goals
- Remove the unused `VisemePort` contract.
- Remove unused aliases (`ASRPort`, `StreamingASRPort`, `TTSPort`).
- Tighten the streaming ASR input type to `numpy.ndarray` to reflect actual usage.

## Non-Goals
- Introduce dependency injection for viseme generation.
- Change any runtime logic beyond the port contract type definitions.

## Decisions
1. Remove `VisemePort` from `domain/voice/ports.py`.
2. Remove `ASRPort`, `StreamingASRPort`, and `TTSPort` aliases.
3. Update `StreamingASRService.transcribe_stream` to accept `np.ndarray` and import numpy as `np`.

## API Changes
- `VisemePort` is deleted.
- `StreamingASRService.transcribe_stream(self, audio_data: np.ndarray, sample_rate: int = 16000) -> StreamingASRResult`.
- Only primary port classes remain in the module.

## Compatibility
- No runtime behavior changes are expected.
- The ports module becomes stricter and more aligned with current implementations.

## Verification
- Run a syntax check on `domain/voice/ports.py`.
- Optional: run any voice-related unit tests if available.
