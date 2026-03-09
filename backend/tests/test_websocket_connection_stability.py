"""
Bug Condition Exploration Test - WebSocket Connection Stability

**Validates: Requirements 2.4**

This test explores the bug condition where WebSocket connections close prematurely
after establishment. The test encodes the EXPECTED behavior (connection stays open
for 60+ seconds) and is designed to FAIL on unfixed code.

**CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists.
**EXPECTED OUTCOME**: Test FAILS with connection closing within 100ms-1000ms.

The bug manifests as: "WebSocket is closed before the connection is established"
when connecting to 'ws://localhost:8000/api/v1/ws/avatar1'.

Root cause hypothesis: The heartbeat mechanism's _last_pong_time is not properly
initialized, causing immediate timeout on connection establishment. OR the issue
is with the actual WebSocket connection handshake/protocol.
"""

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.mark.asyncio
async def test_websocket_connection_stability_scoped():
    """
    Property 1: Fault Condition - Connection Closes Within 1 Second
    
    **SCOPED PBT APPROACH**: This test is scoped to the concrete failing case
    identified in the bug report - connection closes within 1 second.
    
    Test that WebSocket connection does NOT close within 1 second of establishment.
    This is a more focused test that should fail on unfixed code where connections
    close immediately (within 100ms-1000ms).
    
    **EXPECTED OUTCOME ON UNFIXED CODE**: 
    - Connection closes within 1 second
    - Test FAILS (this confirms the bug exists)
    
    **EXPECTED OUTCOME ON FIXED CODE**:
    - Connection stays open for at least 1 second
    - Test PASSES (this confirms the fix works)
    """
    # Arrange
    import uuid
    
    # Import here to avoid module-level import issues
    with patch('app.services.tts.tts_utils.AudioSegment'):
        from app.api.v1.endpoints.websocket import WebSocketHandler
        from app.services.pipeline.session_manager import Session

        session_id = str(uuid.uuid4())
        
        # Mock WebSocket
        mock_ws = MagicMock()
        mock_ws.send_json = AsyncMock()
        mock_ws.send_text = AsyncMock()
        mock_ws.close = AsyncMock()
        
        # Track when close is called
        close_called_at = None
        close_reason = None
        close_code = None
        
        async def track_close(*args, **kwargs):
            nonlocal close_called_at, close_reason, close_code
            close_called_at = time.time()
            close_code = kwargs.get('code')
            close_reason = kwargs.get('reason')
            # Don't actually close to allow test to continue
        
        mock_ws.close.side_effect = track_close
        
        # Mock Session with pipeline
        mock_session = MagicMock(spec=Session)
        mock_session.session_id = session_id
        mock_session.avatar_id = "avatar1"
        mock_pipeline = MagicMock()
        mock_session.pipeline = mock_pipeline
        
        # Create handler
        handler = WebSocketHandler(websocket=mock_ws, session=mock_session)
        
        # Record connection establishment time
        connection_start_time = time.time()
        
        # Act - Start the heartbeat loop
        heartbeat_task = asyncio.create_task(handler._heartbeat_loop())
        
        # Wait for 1 second to check if connection closes prematurely
        await asyncio.sleep(1.0)
        
        # Cleanup
        handler._connected = False
        heartbeat_task.cancel()
        try:
            await heartbeat_task
        except asyncio.CancelledError:
            pass
        
        # Assert
        # Document the counterexample if connection closed prematurely
        if close_called_at is not None:
            time_to_closure = close_called_at - connection_start_time
            
            print(f"\n=== COUNTEREXAMPLE FOUND ===")
            print(f"Connection closed prematurely after {time_to_closure:.3f} seconds")
            print(f"Close code: {close_code}")
            print(f"Close reason: {close_reason}")
            print(f"Expected: Connection should stay open for at least 1 second")
            print(f"Actual: Connection closed within {time_to_closure:.3f} seconds")
            print(f"===========================\n")
            
            # This assertion will FAIL on unfixed code (confirming the bug exists)
            assert time_to_closure >= 1.0, (
                f"Connection closed prematurely after {time_to_closure:.3f} seconds. "
                f"Expected: >= 1 second. "
                f"This confirms the bug exists: WebSocket connections close immediately "
                f"after establishment."
            )
        
        # If we reach here, connection stayed open for at least 1 second
        print(f"\nConnection remained stable for at least 1 second")
        print(f"Close was called: {close_called_at is not None}")



@pytest.mark.asyncio
async def test_websocket_connection_remains_open_60_seconds():
    """
    Property 1: Fault Condition - Connection Closes Prematurely (Full Test)
    
    Test that WebSocket connection remains open for at least 60 seconds after
    establishment, unless explicitly closed by the user or due to network errors.
    
    This is the full test as specified in the requirements. It verifies that
    connections stay open for the full 60-second period required for normal
    message flow.
    
    **EXPECTED OUTCOME ON UNFIXED CODE**: 
    - Connection closes within 100ms-1000ms
    - Error: "Heartbeat timeout" or similar
    - Test FAILS (this confirms the bug exists)
    
    **EXPECTED OUTCOME ON FIXED CODE**:
    - Connection stays open for 60+ seconds
    - Test PASSES (this confirms the fix works)
    
    **NOTE**: This test takes 60+ seconds to run. Use the scoped test above
    for faster feedback during development.
    """
    # Arrange
    import uuid
    
    # Import here to avoid module-level import issues
    with patch('app.services.tts.tts_utils.AudioSegment'):
        from app.api.v1.endpoints.websocket import WebSocketHandler
        from app.services.pipeline.session_manager import Session

        session_id = str(uuid.uuid4())
        
        # Mock WebSocket
        mock_ws = MagicMock()
        mock_ws.send_json = AsyncMock()
        mock_ws.send_text = AsyncMock()
        mock_ws.close = AsyncMock()
        
        # Track when close is called
        close_called_at = None
        close_reason = None
        close_code = None
        
        async def track_close(*args, **kwargs):
            nonlocal close_called_at, close_reason, close_code
            close_called_at = time.time()
            close_code = kwargs.get('code')
            close_reason = kwargs.get('reason')
            # Don't actually close to allow test to continue
        
        mock_ws.close.side_effect = track_close
        
        # Mock Session with pipeline
        mock_session = MagicMock(spec=Session)
        mock_session.session_id = session_id
        mock_session.avatar_id = "avatar1"
        mock_pipeline = MagicMock()
        mock_session.pipeline = mock_pipeline
        
        # Create handler
        handler = WebSocketHandler(websocket=mock_ws, session=mock_session)
        
        # Record connection establishment time
        connection_start_time = time.time()
        
        # Act - Start the heartbeat loop
        heartbeat_task = asyncio.create_task(handler._heartbeat_loop())
        
        # Wait for 60 seconds to verify connection stability
        await asyncio.sleep(60.0)
        
        # Cleanup
        handler._connected = False
        heartbeat_task.cancel()
        try:
            await heartbeat_task
        except asyncio.CancelledError:
            pass
        
        # Assert
        connection_end_time = time.time()
        connection_duration = connection_end_time - connection_start_time
        
        # Document the counterexample if connection closed prematurely
        if close_called_at is not None:
            time_to_closure = close_called_at - connection_start_time
            
            print(f"\n=== COUNTEREXAMPLE FOUND ===")
            print(f"Connection closed prematurely after {time_to_closure:.3f} seconds")
            print(f"Close code: {close_code}")
            print(f"Close reason: {close_reason}")
            print(f"Expected: Connection should stay open for 60+ seconds")
            print(f"Actual: Connection closed within {time_to_closure:.3f} seconds")
            print(f"===========================\n")
            
            # This assertion will FAIL on unfixed code (confirming the bug exists)
            assert time_to_closure >= 60.0, (
                f"Connection closed prematurely after {time_to_closure:.3f} seconds. "
                f"Expected: >= 60 seconds. "
                f"This confirms the bug exists: WebSocket connections close immediately "
                f"after establishment due to heartbeat timeout logic."
            )
        
        # If we reach here without close being called, verify connection stayed open
        assert connection_duration >= 60.0, (
            f"Test ran for {connection_duration:.3f} seconds, expected >= 60 seconds"
        )
        
        # Verify close was NOT called during the 60+ second period
        assert close_called_at is None or (close_called_at - connection_start_time) >= 60.0, (
            "Connection should remain open for at least 60 seconds unless explicitly closed"
        )
        
        print(f"\nConnection remained stable for {connection_duration:.1f} seconds")



@pytest.mark.asyncio
async def test_websocket_heartbeat_initialization():
    """
    Property 1: Fault Condition - Heartbeat Timeout on Fresh Connection
    
    Test that verifies the specific root cause: _last_pong_time initialization.
    
    This test checks if the heartbeat mechanism properly initializes _last_pong_time
    to prevent immediate timeout on connection establishment.
    
    **EXPECTED OUTCOME ON UNFIXED CODE**:
    - _last_pong_time is not initialized or set to 0
    - Heartbeat timeout check triggers immediately
    - Connection closes within 1 second
    - Test FAILS
    
    **EXPECTED OUTCOME ON FIXED CODE**:
    - _last_pong_time is initialized to current time
    - Heartbeat timeout check does not trigger immediately
    - Test PASSES
    """
    # Arrange
    import uuid
    
    # Import here to avoid module-level import issues
    with patch('app.services.tts.tts_utils.AudioSegment'):
        from app.api.v1.endpoints.websocket import WebSocketHandler
        from app.services.pipeline.session_manager import Session

        session_id = str(uuid.uuid4())
        
        # Mock WebSocket
        mock_ws = MagicMock()
        mock_ws.send_json = AsyncMock()
        mock_ws.send_text = AsyncMock()
        mock_ws.close = AsyncMock()
        
        # Mock Session
        mock_session = MagicMock(spec=Session)
        mock_session.session_id = session_id
        mock_session.avatar_id = "avatar1"
        mock_pipeline = MagicMock()
        mock_session.pipeline = mock_pipeline
        
        # Create handler
        handler = WebSocketHandler(websocket=mock_ws, session=mock_session)
        
        # Record the initial _last_pong_time value
        initial_last_pong_time = handler._last_pong_time
        current_time = time.time()
        
        # Act - Start heartbeat loop briefly
        heartbeat_task = asyncio.create_task(handler._heartbeat_loop())
        
        # Wait for 2 seconds to see if immediate timeout occurs
        await asyncio.sleep(2.0)
        
        # Cleanup
        handler._connected = False
        heartbeat_task.cancel()
        try:
            await heartbeat_task
        except asyncio.CancelledError:
            pass
        
        # Assert
        # Check if _last_pong_time was properly initialized
        time_diff = abs(initial_last_pong_time - current_time)
        
        print(f"\n=== Heartbeat Initialization Check ===")
        print(f"Initial _last_pong_time: {initial_last_pong_time}")
        print(f"Current time: {current_time}")
        print(f"Time difference: {time_diff:.3f} seconds")
        print(f"Close called: {mock_ws.close.called}")
        
        if mock_ws.close.called:
            call_args = mock_ws.close.call_args
            close_code = call_args[1].get('code') if call_args and len(call_args) > 1 else None
            close_reason = call_args[1].get('reason') if call_args and len(call_args) > 1 else None
            print(f"Close code: {close_code}")
            print(f"Close reason: {close_reason}")
        print(f"=====================================\n")
        
        # Verify _last_pong_time was initialized to a recent time (within 1 second of creation)
        assert time_diff < 1.0, (
            f"_last_pong_time not properly initialized. "
            f"Expected: close to current time (within 1 second). "
            f"Actual: {time_diff:.3f} seconds difference. "
            f"This causes immediate heartbeat timeout."
        )
        
        # Verify connection was not closed due to timeout within 2 seconds
        assert not mock_ws.close.called, (
            "Connection should not close within 2 seconds of establishment. "
            "Premature closure indicates heartbeat timeout bug."
        )
