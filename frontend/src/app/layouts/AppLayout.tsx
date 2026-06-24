import { Outlet, useLocation } from 'react-router-dom';
import { ClassroomLeftRail } from '@/widgets/Classroom/ClassroomLeftRail';

export default function AppLayout() {
  const location = useLocation();
  const showSidebar = location.pathname.startsWith('/classroom') || location.pathname.startsWith('/help') || location.pathname.startsWith('/setup') || location.pathname.startsWith('/quiz');

  return (
    <div className="flex w-full min-h-screen bg-[#0D0D0D] text-white font-sans">
      {showSidebar && <ClassroomLeftRail />}
      <div className="flex-1 min-w-0 flex flex-col relative bg-[#0D0D0D]">
        <Outlet />
      </div>
    </div>
  );
}
