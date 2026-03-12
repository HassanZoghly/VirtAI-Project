"""
Tests for binary frame marker byte protocol.

Validates that the WebSocket binary frame protocol correctly parses the is_final
marker byte appended by the frontend:
- Frame format: [PCM bytes (Int16LE)] + [1-byte marker: 0x00 not-final, 0x01 final]
- Backward compatibility: legacy frames without marker byte still work
"""

import struct
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.presentation.ws.gateway import WebSocketHandler
from app.application.chat.session_manager import Session


def _make_handler():
    """Create a WebSocketHandler with mocked dependencies."""
    mock_ws = MagicMock()
    mock_ws.send_json = AsyncMock()
    mock_ws.send_text = AsyncMock()

    mock_session = MagicMock(spec=Session)
    mock_session.session_id = str(uuid.uuid4())
    mock_session.avatar_id = "avatar1"
    mock_session.pipeline = MagicMock()

    handler = WebSocketHandler(websocket=mock_ws, session=mock_session)
    handler._connected = True
    return handler


def _make_pcm(num_samples: int = 320) -> bytes:
    """Generate valid Int16 PCM audio bytes."""
    return struct.pack(f"<{num_samples}h", *([100] * num_samples))


@pytest.mark.asyncio
async def test_marker_byte_not_final():
    """Frame with 0x00 marker → is_final=False, marker stripped."""
    handler = _make_handler()
    mock_voice = MagicMock()
    mock_voice.handle_audio_chunk = AsyncMock()

    pcm = _make_pcm(320)  # 640 bytes
    frame = pcm + b"\x00"  # 641 bytes total

    with patch.object(handler, "_get_voice_mode_handler", return_value=mock_voice):
        await handler._handle_binary_frame(frame)

    mock_voice.handle_audio_chunk.assert_called_once_with(pcm, is_final=False)


@pytest.mark.asyncio
async def test_marker_byte_final():
    """Frame with 0x01 marker → is_final=True, marker stripped."""
    handler = _make_handler()
    mock_voice = MagicMock()
    mock_voice.handle_audio_chunk = AsyncMock()

    pcm = _make_pcm(320)  # 640 bytes
    frame = pcm + b"\x01"  # 641 bytes total

    with patch.object(handler, "_get_voice_mode_handler", return_value=mock_voice):
        await handler._handle_binary_frame(frame)

    mock_voice.handle_audio_chunk.assert_called_once_with(pcm, is_final=True)


@pytest.mark.asyncio
async def test_legacy_frame_even_length():
    """Legacy frame (even length, no marker) → is_final=False, full frame passed."""
    handler = _make_handler()
    mock_voice = MagicMock()
    mock_voice.handle_audio_chunk = AsyncMock()

    pcm = _make_pcm(320)  # 640 bytes, even length
    # Legacy frame: last byte happens to be a PCM sample byte, not 0x00 or 0x01
    # Since stripping last byte gives odd count → legacy path
    # b'\x00\x01' * 320 → last byte 0x01, strip → 639 (odd) → legacy

    with patch.object(handler, "_get_voice_mode_handler", return_value=mock_voice):
        await handler._handle_binary_frame(pcm)

    call_args = mock_voice.handle_audio_chunk.call_args
    # Legacy: full frame used, is_final=False
    passed_pcm = call_args[0][0]
    assert len(passed_pcm) % 2 == 0  # PCM must be even
    assert call_args[1]["is_final"] == False


@pytest.mark.asyncio
async def test_small_frame_fallback():
    """Frame smaller than 3 bytes → legacy path, is_final=False."""
    handler = _make_handler()
    mock_voice = MagicMock()
    mock_voice.handle_audio_chunk = AsyncMock()

    tiny_frame = b"\x00\x01"  # 2 bytes, less than 3

    with patch.object(handler, "_get_voice_mode_handler", return_value=mock_voice):
        await handler._handle_binary_frame(tiny_frame)

    mock_voice.handle_audio_chunk.assert_called_once_with(tiny_frame, is_final=False)


@pytest.mark.asyncio
async def test_various_pcm_sizes_with_marker():
    """Different PCM sizes all correctly parse marker byte."""
    for num_samples in [80, 160, 320, 640, 1600]:
        handler = _make_handler()
        mock_voice = MagicMock()
        mock_voice.handle_audio_chunk = AsyncMock()

        pcm = _make_pcm(num_samples)
        frame_final = pcm + b"\x01"
        frame_not_final = pcm + b"\x00"

        with patch.object(handler, "_get_voice_mode_handler", return_value=mock_voice):
            await handler._handle_binary_frame(frame_final)

        mock_voice.handle_audio_chunk.assert_called_once_with(pcm, is_final=True)

        # Reset and test not-final
        handler2 = _make_handler()
        mock_voice2 = MagicMock()
        mock_voice2.handle_audio_chunk = AsyncMock()

        with patch.object(handler2, "_get_voice_mode_handler", return_value=mock_voice2):
            await handler2._handle_binary_frame(frame_not_final)

        mock_voice2.handle_audio_chunk.assert_called_once_with(pcm, is_final=False)


@pytest.mark.asyncio
async def test_error_handling_preserved():
    """Exceptions in voice handler still produce error response."""
    handler = _make_handler()
    mock_voice = MagicMock()
    mock_voice.handle_audio_chunk = AsyncMock(side_effect=RuntimeError("test error"))

    pcm = _make_pcm(320)
    frame = pcm + b"\x00"

    with patch.object(handler, "_get_voice_mode_handler", return_value=mock_voice):
        await handler._handle_binary_frame(frame)

    # Should have sent an error message via _safe_send → ws.send_text
    handler.ws.send_text.assert_called_once()
