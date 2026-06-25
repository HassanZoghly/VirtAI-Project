import React from 'react';
import { PiWifiSlashFill } from 'react-icons/pi';
import { FiRefreshCw } from 'react-icons/fi';

export interface ConnectionBadgeProps {
  stateGroup: 'ready' | 'connecting' | 'offline';
  currentSessionId: string | null;
  statusText: string;
  onReconnect: () => void;
  size?: 'sm' | 'md';
}

export function ConnectionBadge({
  stateGroup,
  currentSessionId,
  statusText,
  onReconnect,
  size = 'md'
}: ConnectionBadgeProps) {
  const isConnecting = stateGroup === 'connecting';
  const pulseClass = (stateGroup === 'ready' || isConnecting) ? 'animate-pulse' : '';
  
  let dotColor = '';
  if (stateGroup === 'ready') dotColor = 'bg-green-500';
  else if (stateGroup === 'connecting') dotColor = 'bg-yellow-500';
  else dotColor = 'bg-red-500';

  const isSmall = size === 'sm';
  const containerClasses = isSmall 
    ? "flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-dark-tertiary/80 shadow-sm"
    : "flex items-center gap-2.5 px-4 py-2 rounded-full border border-white/10 bg-dark-tertiary/80 shadow-sm transition-colors duration-300";
    
  const dotWrapperClasses = "relative flex items-center justify-center";
  const iconSize = isSmall ? 12 : 14;
  const dotClasses = isSmall ? `w-2 h-2 rounded-full ${dotColor} ${pulseClass}` : `w-2.5 h-2.5 rounded-full ${dotColor} ${pulseClass}`;
  const pingClasses = isSmall ? `absolute w-2 h-2 rounded-full ${dotColor} animate-ping opacity-75` : `absolute w-2.5 h-2.5 rounded-full ${dotColor} animate-ping opacity-75`;
  const textClasses = isSmall 
    ? "text-xs font-semibold text-white/95 tracking-wide font-sans truncate max-w-[120px]"
    : "text-sm font-semibold text-white/90 tracking-wide font-sans truncate max-w-[150px] lg:max-w-[200px]";
  const buttonClasses = isSmall
    ? "flex items-center justify-center text-gray-400 active:text-white transition-colors ml-0.5 cursor-pointer"
    : "flex items-center justify-center text-gray-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ml-1";

  return (
    <div className={containerClasses}>
      <div className={dotWrapperClasses}>
        {stateGroup === 'offline' && currentSessionId !== null ? (
          <PiWifiSlashFill size={iconSize} className="text-red-500" />
        ) : (
          <>
            <div className={dotClasses}></div>
            {(stateGroup === 'ready' || isConnecting) && (
              <div className={pingClasses}></div>
            )}
          </>
        )}
      </div>
      <span className={textClasses} title={statusText}>
        {statusText}
      </span>
      
      <button
        onClick={onReconnect}
        disabled={isConnecting}
        title="Reconnect"
        className={buttonClasses}
      >
        <FiRefreshCw size={iconSize} className={isConnecting ? 'animate-spin' : ''} />
      </button>
    </div>
  );
}
