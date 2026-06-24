import React from 'react';
import { PiWifiSlashFill } from 'react-icons/pi';
import { FiMonitor, FiShare2, FiEdit3, FiRefreshCw } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { ConnectionState } from '@/core/realtime/useWSClient';

interface AvatarTopBarProps {
  avatarName: string;
  connectionState: ConnectionState | string;
  currentSessionId: string | null;
  reconnectError: string | null;
  reconnect: () => void;
  hasDocuments: boolean;
  hasMessages: boolean;
  onGenerateDiagram: () => void;
  onStartExplain: () => void;
}

export function AvatarTopBar({
  avatarName,
  connectionState,
  currentSessionId,
  reconnectError,
  reconnect,
  hasDocuments,
  hasMessages,
  onGenerateDiagram,
  onStartExplain
}: AvatarTopBarProps) {
  const navigate = useNavigate();

  const isOnline = connectionState === ConnectionState.ONLINE;
  const isOffline = connectionState === ConnectionState.OFFLINE;
  const isReconnecting = connectionState === ConnectionState.RECONNECTING;
  const isInitializing = connectionState === ConnectionState.INITIALIZING;

  // Derive unified state group from the single source of truth
  let stateGroup: 'ready' | 'connecting' | 'offline' = 'offline';
  if (!currentSessionId || isOnline) {
    stateGroup = 'ready';
  } else if (isReconnecting || isInitializing) {
    stateGroup = 'connecting';
  } else {
    stateGroup = 'offline';
  }

  // Exact UI mappings as requested
  let dotColor = '';
  let statusText = '';
  if (stateGroup === 'ready') {
    dotColor = 'bg-green-500';
    statusText = `Ready - ${avatarName}`;
  } else if (stateGroup === 'connecting') {
    dotColor = 'bg-yellow-500';
    statusText = 'Connecting...';
  } else {
    dotColor = 'bg-red-500';
    statusText = 'Offline';
  }

  const isConnecting = stateGroup === 'connecting';
  const pulseClass = (stateGroup === 'ready' || isConnecting) ? 'animate-pulse' : '';

  return (
    <div className="flex items-center justify-between w-full pb-2">
      
      {/* Left Section (Status) */}
      <div className="flex items-center gap-2.5 px-4 py-2 rounded-full border border-white/10 bg-[#1a1a1a]/80 shadow-sm transition-colors duration-300">
        <div className="relative flex items-center justify-center">
          {stateGroup === 'offline' && currentSessionId !== null ? (
            <PiWifiSlashFill size={14} className="text-red-500" />
          ) : (
            <>
              <div className={`w-2.5 h-2.5 rounded-full ${dotColor} ${pulseClass}`}></div>
              {(stateGroup === 'ready' || isConnecting) && (
                <div className={`absolute w-2.5 h-2.5 rounded-full ${dotColor} animate-ping opacity-75`}></div>
              )}
            </>
          )}
        </div>
        <span className="text-sm font-semibold text-white/90 tracking-wide font-sans">
          {statusText}
        </span>
        
        {/* Localized Reconnection Button */}
        <button
          onClick={reconnect}
          disabled={isConnecting}
          title="Reconnect"
          className="flex items-center justify-center text-gray-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ml-1"
        >
          <FiRefreshCw size={14} className={isConnecting ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Right Section (Action Buttons) */}
      <div className="flex items-center gap-3">
        {hasDocuments && !hasMessages && (
          <button
            onClick={onStartExplain}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-transparent border border-white/10 text-white/90 hover:bg-white/10 transition-colors duration-300 ease-in-out shadow-sm"
          >
            <FiMonitor size={15} />
            <span className="text-[13px] font-semibold tracking-wide font-sans">Explain</span>
          </button>
        )}
        
        <button
          onClick={onGenerateDiagram}
          disabled={!hasDocuments}
          className="flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-transparent border border-white/10 text-white/90 hover:bg-white/10 transition-colors duration-300 ease-in-out shadow-sm disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
          title={!hasDocuments ? "Upload a document first to generate a diagram" : "Generate Diagram"}
        >
          <FiShare2 size={15} />
          <span className="text-[13px] font-semibold tracking-wide font-sans">Diagram</span>
        </button>
        
        <button
          onClick={() => navigate('/quiz')}
          disabled={!hasDocuments}
          className="flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-transparent border border-white/10 text-white/90 hover:bg-white/10 transition-colors duration-300 ease-in-out shadow-sm disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
          title={!hasDocuments ? "Upload a document first to take a quiz" : "Take Quiz"}
        >
          <FiEdit3 size={15} />
          <span className="text-[13px] font-semibold tracking-wide font-sans">Take Quiz</span>
        </button>
      </div>
      
    </div>
  );
}
