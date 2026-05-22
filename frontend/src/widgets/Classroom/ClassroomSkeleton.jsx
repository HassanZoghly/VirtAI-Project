import React from 'react';

export default function ClassroomSkeleton() {
  return (
    <div className="classroom-skeleton">
      <div className="skeleton-messages">
        <div className="skeleton-msg skeleton-ai">
          <div className="skeleton-avatar" />
          <div className="skeleton-bubble skeleton-bubble-lg" />
        </div>
        <div className="skeleton-msg skeleton-user">
          <div className="skeleton-bubble skeleton-bubble-md" />
        </div>
        <div className="skeleton-msg skeleton-ai">
          <div className="skeleton-avatar" />
          <div className="skeleton-bubble skeleton-bubble-sm" />
        </div>
      </div>
      <div className="skeleton-input">
        <div className="skeleton-input-bar" />
      </div>
    </div>
  );
}
