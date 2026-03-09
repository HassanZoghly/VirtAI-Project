import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock WebSocket for happy-dom environment
// happy-dom doesn't provide WebSocket by default, so we need to ensure it's available
if (typeof globalThis.WebSocket === 'undefined') {
  // Create a basic WebSocket mock that will be overridden by individual tests
  globalThis.WebSocket = class WebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0; // CONNECTING
      this.onopen = null;
      this.onclose = null;
      this.onerror = null;
      this.onmessage = null;
    }
    send() {}
    close() {}
  };
  
  globalThis.WebSocket.CONNECTING = 0;
  globalThis.WebSocket.OPEN = 1;
  globalThis.WebSocket.CLOSING = 2;
  globalThis.WebSocket.CLOSED = 3;
}
