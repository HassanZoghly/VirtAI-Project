import React from 'react';
import { PiList, PiUserCircleFill } from 'react-icons/pi';
import { FiHelpCircle } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';

interface ClassroomLeftRailProps {
  onOpenSessions: () => void;
  className?: string;
}

export function ClassroomLeftRail({ onOpenSessions, className }: ClassroomLeftRailProps) {
  const navigate = useNavigate();

  const handleProfileClick = () => {
    navigate('/setup');
  };

  return (
    <div className={`classroom-left-rail ${className || ''}`}>
      <button 
        className="left-rail-btn" 
        onClick={onOpenSessions}
        aria-label="Open sessions drawer"
        title="Sessions"
      >
        <PiList />
      </button>

      <button 
        className="left-rail-btn" 
        onClick={handleProfileClick}
        aria-label="Go to setup"
        title="Setup Profile"
      >
        <PiUserCircleFill />
      </button>

      <button
        className="left-rail-btn"
        onClick={() => navigate('/help')}
        aria-label="Feature Tour"
        title="Help & Tour"
        style={{ marginTop: 'auto' }}
      >
        <FiHelpCircle />
      </button>
    </div>
  );
}
