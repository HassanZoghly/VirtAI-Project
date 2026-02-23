import { lazy, Suspense } from "react";
import './Classroom.css';

const ClassroomShell = lazy(() => import("./components/ClassroomShell.jsx"));

export default function Classroom() {
    return (
        <div className="classroom-page">
            <Suspense fallback={null}>
                <ClassroomShell />
            </Suspense>
        </div>
    );
}
