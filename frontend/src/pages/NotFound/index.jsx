import LottieLib from 'lottie-react';
const Lottie = LottieLib.default ?? LottieLib;
import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import './NotFound.css';

const ANIMATION_URL = '/assets/lottie/error.json';

export default function NotFound() {
  const navigate = useNavigate();
  const [animationData, setAnimationData] = useState(null);

  useEffect(() => {
    fetch(ANIMATION_URL)
      .then((res) => res.json())
      .then(setAnimationData)
      .catch(() => {}); // silently ignore — animation is decorative
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
