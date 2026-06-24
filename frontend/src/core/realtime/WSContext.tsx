import React, { createContext, useContext } from 'react';
import { ConnectionState } from './wsConstants';

interface WSContextType {
  connectionState: ConnectionState;
  isConnected: boolean;
  send: (message: any) => void;
  reconnect: () => void;
  disconnect: () => void;
  currentSessionId: string | null;
  onMessage: (event: string, callback: (data: any) => void) => () => void;
}

export const WSContext = createContext<WSContextType | null>(null);

export function useWS() {
  const context = useContext(WSContext);
  if (!context) {
    throw new Error('useWS must be used within a WSProvider');
  }
  return context;
}
