import Lottie from 'lottie-react';
import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import './NotFound.css';
import astronautAnimation from '/assets/lottie/error.json?url';

export default function NotFound() {
  const navigate = useNavigate();
  const [animationData, setAnimationData] = useState(null);

  useEffect(() => {
    fetch(astronautAnimation)
      .then((res) => res.json())
      .then(setAnimationData);
  }, []);

  return (
    <>
      <Helmet>
        <title>404 – Page Not Found | VirtAI</title>
      </Helmet>

      <div className="notfound-page">
        <div className="notfound-content">
          <div className="notfound-animation">
            {animationData && <Lottie animationData={animationData} loop autoplay />}
          </div>

          <p className="notfound-title">Lost in Space</p>
          <p className="notfound-text">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>

          <div className="notfound-actions">
            <button className="notfound-btn primary" onClick={() => navigate('/')}>
              Go Home
            </button>
            <button className="notfound-btn secondary" onClick={() => navigate(-1)}>
              Go Back
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
