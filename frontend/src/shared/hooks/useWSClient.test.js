import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useWSClient from './useWSClient';

/**
 * Bug Condition Exploration Test - Unknown Message Types
 * 
 * **Validates: Requirements 2.1, 2.2**
 * 
 * This test verifies that the WebSocket client handles "ready" and "pong" 
 * message types gracefully without logging warnings in production mode.
 * 
 * Bug Description:
 * - WHEN the backend sends a "ready" message with type ServerMessageType.READY
 * - THEN the frontend logs "[WS] Unknown message type: ready"
 * - WHEN the backend sends a "pong" message with type ServerMessageType.PONG
 * - THEN the frontend logs "[WS] Unknown message type: pong"
 * 
 * Expected Behavior (After Fix):
 * - ready/pong messages should be handled silently in production
 * - No console warnings should be logged
 * - Connection should remain stable
 */

describe('Bug Condition Exploration - Unknown Message Types', () => {
  let mockWebSocket;
  let consoleWarnSpy;
  let consoleDebugSpy;
  let consoleErrorSpy;
  const TEST_URL = 'ws://localhost:8000/test';

  beforeEach(() => {
    // Create a mock WebSocket with event handler storage
    const eventHandlers = {};
    
    mockWebSocket = {
      send: vi.fn(),
      close: vi.fn(),
      readyState: 1, // OPEN
      // Store event handlers for later triggering
      set onopen(handler) {
        eventHandlers.open = handler;
      },
      get onopen() {
        return eventHandlers.open;
      },
      set onmessage(handler) {
        eventHandlers.message = handler;
      },
      get onmessage() {
        return eventHandlers.message;
      },
      set onerror(handler) {
        eventHandlers.error = handler;
      },
      get onerror() {
        return eventHandlers.error;
      },
      set onclose(handler) {
        eventHandlers.close = handler;
      },
      get onclose() {
        return eventHandlers.close;
      },
      _eventHandlers: eventHandlers,
    };

    // Spy on console methods
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock WebSocket constructor
    global.WebSocket = vi.fn(() => mockWebSocket);
    global.WebSocket.OPEN = 1;
    global.WebSocket.CLOSED = 3;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Property 1: Fault Condition - Ready and Pong Messages Log Warnings
   * 
   * Test that receiving "ready" or "pong" messages does not log warnings
   * in production mode.
   * 
   * This is a scoped property-based test focusing on the concrete failing
   * cases identified in the bug report: ready and pong message types.
   */
  it('should handle ready message without logging warnings in production', () => {
    // Arrange: Set up production environment
    const originalEnv = import.meta.env.DEV;
    import.meta.env.DEV = false;

    renderHook(() => useWSClient(TEST_URL));

    // Simulate WebSocket connection opening
    act(() => {
      if (mockWebSocket._eventHandlers.open) {
        mockWebSocket._eventHandlers.open();
      }
    });

    // Clear any setup-related console calls
    consoleWarnSpy.mockClear();
    consoleDebugSpy.mockClear();
    consoleErrorSpy.mockClear();

    // Act: Simulate receiving a "ready" message from backend
    const readyMessage = {
      type: 'ready',
      data: {
        session_id: 'test-session-123',
        message: 'Connected and ready',
      },
    };

    act(() => {
      if (mockWebSocket._eventHandlers.message) {
        mockWebSocket._eventHandlers.message({
          data: JSON.stringify(readyMessage),
        });
      }
    });

    // Assert: No warnings should be logged in production
    expect(consoleWarnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('[WS] Unknown message type: ready')
    );
    expect(consoleWarnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('[WS] Unknown message type')
    );

    // Cleanup
    import.meta.env.DEV = originalEnv;
  });

  it('should handle pong message without logging warnings in production', () => {
    // Arrange: Set up production environment
    const originalEnv = import.meta.env.DEV;
    import.meta.env.DEV = false;

    renderHook(() => useWSClient(TEST_URL));

    // Simulate WebSocket connection opening
    act(() => {
      if (mockWebSocket._eventHandlers.open) {
        mockWebSocket._eventHandlers.open();
      }
    });

    // Clear any setup-related console calls
    consoleWarnSpy.mockClear();
    consoleDebugSpy.mockClear();
    consoleErrorSpy.mockClear();

    // Act: Simulate receiving a "pong" message from backend (heartbeat)
    const pongMessage = {
      type: 'pong',
      data: {
        timestamp: Date.now(),
      },
    };

    act(() => {
      if (mockWebSocket._eventHandlers.message) {
        mockWebSocket._eventHandlers.message({
          data: JSON.stringify(pongMessage),
        });
      }
    });

    // Assert: No warnings should be logged in production
    expect(consoleWarnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('[WS] Unknown message type: pong')
    );
    expect(consoleWarnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('[WS] Unknown message type')
    );

    // Cleanup
    import.meta.env.DEV = originalEnv;
  });

  it('should handle multiple ready/pong messages without warnings', () => {
    // Arrange: Set up production environment
    const originalEnv = import.meta.env.DEV;
    import.meta.env.DEV = false;

    renderHook(() => useWSClient(TEST_URL));

    // Simulate WebSocket connection opening
    act(() => {
      if (mockWebSocket._eventHandlers.open) {
        mockWebSocket._eventHandlers.open();
      }
    });

    // Clear any setup-related console calls
    consoleWarnSpy.mockClear();
    consoleDebugSpy.mockClear();
    consoleErrorSpy.mockClear();

    // Act: Simulate receiving multiple ready and pong messages (heartbeat scenario)
    act(() => {
      if (mockWebSocket._eventHandlers.message) {
        // Simulate initial ready message
        mockWebSocket._eventHandlers.message({
          data: JSON.stringify({ type: 'ready', data: { session_id: 'test' } }),
        });

        // Simulate periodic pong messages (heartbeat)
        for (let i = 0; i < 5; i++) {
          mockWebSocket._eventHandlers.message({
            data: JSON.stringify({ type: 'pong', data: { timestamp: Date.now() } }),
          });
        }
      }
    });

    // Assert: No warnings should be logged for any of the messages
    expect(consoleWarnSpy).not.toHaveBeenCalled();

    // Cleanup
    import.meta.env.DEV = originalEnv;
  });
});
