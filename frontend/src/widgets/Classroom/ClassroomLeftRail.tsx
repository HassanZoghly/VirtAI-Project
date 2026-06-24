import React from 'react';
import { PiList, PiUserCircleFill } from 'react-icons/pi';
import { FiHelpCircle } from 'react-icons/fi';
import { useNavigate, useLocation } from 'react-router-dom';

interface ClassroomLeftRailProps {
  className?: string;
}

export function ClassroomLeftRail({ className }: ClassroomLeftRailProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleSessionsClick = () => {
    if (location.pathname.startsWith('/classroom') || location.pathname === '/') {
      window.dispatchEvent(new CustomEvent('open-sessions'));
    } else {
      navigate('/classroom');
    }
  };

  return (
    <div className={`w-16 min-w-[4rem] max-w-[4rem] flex-shrink-0 sticky top-0 h-screen flex flex-col items-center gap-6 pt-6 pb-6 bg-[#0D0D0D] border-r border-white/10 z-[100] ${className || ''}`}>
      <button 
        className="p-3 flex items-center justify-center rounded-xl bg-transparent hover:bg-white/10 text-white/70 hover:text-white transition-colors duration-300"
        onClick={handleSessionsClick}
        aria-label="Open sessions drawer"
        title="Chats"
      >
        <PiList size={28} />
      </button>

      <button 
        className="p-3 flex items-center justify-center rounded-xl bg-transparent hover:bg-white/10 text-white/70 hover:text-white transition-colors duration-300"
        onClick={() => navigate('/setup')}
        aria-label="Go to setup"
        title="Setup Profile"
      >
        <PiUserCircleFill size={30} />
      </button>

      <button
        className="p-3 flex items-center justify-center rounded-xl bg-transparent hover:bg-white/10 text-white/70 hover:text-white transition-colors duration-300 mt-auto"
        onClick={() => navigate('/help')}
        aria-label="Feature Tour"
        title="Help & Tour"
      >
        <FiHelpCircle size={26} />
      </button>
    </div>
  );
}
