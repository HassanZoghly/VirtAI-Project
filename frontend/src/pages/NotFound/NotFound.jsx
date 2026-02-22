import { useNavigate } from "react-router-dom";
import { useTransition } from "react";
import { LiquidButton } from '../../components/buttons/liquid';
import "./NotFound.css";

function NotFound() {
  const navigate = useNavigate();
  const [, startTransition] = useTransition();
  const go = (path) => startTransition(() => navigate(path));
  return (
    <main className="nf" role="main">
      {/* Card */}
      <div className="nf__card">
        <p className="nf__code" aria-label="Error code 404">404</p>
        <h1 className="nf__heading">Page not found</h1>
        <p className="nf__desc">
          The page you are looking for does not exist or has been moved.
        </p>
        <div className="nf__actions">
          <LiquidButton
            onClick={() => go("/")}
            type="button"
            size="md"
          >
            Back to Overview
          </LiquidButton>
          <button
            className="nf__btn nf__btn--secondary"
            onClick={() => go("/classroom")}
            type="button"
          >
            Go to Classroom
          </button>
        </div>
      </div>

      {/* Footer tag */}
      <p className="nf__brand" aria-label="VirtAI — AI Avatar System">
        VirtAI — AI Avatar System
      </p>
    </main>
  );
}

export default NotFound;