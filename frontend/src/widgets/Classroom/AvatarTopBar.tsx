import React from 'react';
import { PiWifiSlashFill, PiList } from 'react-icons/pi';
import { FiMonitor, FiShare2, FiEdit3, FiRefreshCw, FiSettings, FiUser } from 'react-icons/fi';
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
  onOpenSettings?: () => void;
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
  onStartExplain,
  onOpenSettings
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
    statusText = 'Assistant Connected';
  } else if (stateGroup === 'connecting') {
    dotColor = 'bg-yellow-500';
    statusText = 'Establishing Connection...';
  } else {
    dotColor = 'bg-red-500';
    statusText = 'Disconnected';
  }

  const isConnecting = stateGroup === 'connecting';
  const pulseClass = (stateGroup === 'ready' || isConnecting) ? 'animate-pulse' : '';

  return (
    <header className="w-full pb-2 relative z-[60]">
      {/* Desktop Header Layout */}
      <div className="hidden lg:flex items-center justify-between w-full">
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
          <span className="text-sm font-semibold text-white/90 tracking-wide font-sans truncate max-w-[150px] lg:max-w-[200px]" title={statusText}>
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
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-transparent border border-white/10 text-white/90 hover:bg-white/10 transition-colors duration-300 ease-in-out shadow-sm cursor-pointer"
            >
              <FiMonitor size={15} />
              <span className="text-[13px] font-semibold tracking-wide font-sans">Explain Slide</span>
            </button>
          )}
          
          <button
            onClick={onGenerateDiagram}
            disabled={!hasDocuments}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-transparent border border-white/10 text-white/90 hover:bg-white/10 transition-colors duration-300 ease-in-out shadow-sm disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer"
            title={!hasDocuments ? "Please upload syllabus or reference materials to generate a diagram" : "Synthesize Relationship Diagram"}
          >
            <FiShare2 size={15} />
            <span className="text-[13px] font-semibold tracking-wide font-sans">Synthesize Diagram</span>
          </button>
          
          <button
            onClick={() => navigate('/quiz')}
            disabled={!hasDocuments}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-transparent border border-white/10 text-white/90 hover:bg-white/10 transition-colors duration-300 ease-in-out shadow-sm disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer"
            title={!hasDocuments ? "Please upload syllabus or reference materials to generate a quiz" : "Start Knowledge Check"}
          >
            <FiEdit3 size={15} />
            <span className="text-[13px] font-semibold tracking-wide font-sans">Start Quiz</span>
          </button>
        </div>
      </div>

      {/* Mobile Header Layout (Strict Requirements for sm/md screens) */}
      <div className="flex lg:hidden items-center justify-between w-full px-2 py-1">
        {/* Far Left: Hamburger Menu Icon */}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('open-sessions'))}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-[#1a1a1a]/80 border border-white/10 text-white/80 active:bg-white/10 active:text-white transition-colors duration-200 cursor-pointer"
          aria-label="Open Sessions Drawer"
        >
          <PiList size={22} />
        </button>

        {/* Center: "AI Tutor Online" status indicator */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-[#1a1a1a]/80 shadow-sm">
          <div className="relative flex items-center justify-center">
            {stateGroup === 'offline' && currentSessionId !== null ? (
              <PiWifiSlashFill size={12} className="text-red-500" />
            ) : (
              <>
                <div className={`w-2 h-2 rounded-full ${dotColor} ${pulseClass}`}></div>
                {(stateGroup === 'ready' || isConnecting) && (
                  <div className={`absolute w-2 h-2 rounded-full ${dotColor} animate-ping opacity-75`}></div>
                )}
              </>
            )}
          </div>
          <span className="text-xs font-semibold text-white/95 tracking-wide font-sans truncate max-w-[120px]" title={statusText}>
            {statusText}
          </span>
          <button
            onClick={reconnect}
            disabled={isConnecting}
            className="flex items-center justify-center text-gray-400 active:text-white transition-colors ml-0.5 cursor-pointer"
          >
            <FiRefreshCw size={12} className={isConnecting ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Far Right: Setup Profile Icon */}
        <button
          onClick={() => navigate('/setup')}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-[#1a1a1a]/80 border border-white/10 text-white/80 active:bg-white/10 active:text-white transition-colors duration-200 cursor-pointer"
          aria-label="Setup Profile"
        >
          <FiUser size={18} />
        </button>
      </div>
    </header>
  );
}
