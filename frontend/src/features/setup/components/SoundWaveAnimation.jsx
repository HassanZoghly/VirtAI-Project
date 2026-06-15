import { useEffect, useState } from 'react';

const BAR_COUNT = 20;

export default function SoundWaveAnimation({ active }) {
  const [stopping, setStopping] = useState(false);
  const [visible, setVisible] = useState(active);

  const [prevActive, setPrevActive] = useState(active);

  if (active !== prevActive) {
    setPrevActive(active);
    if (active) {
      setStopping(false);
      setVisible(true);
    } else if (visible) {
      setStopping(true);
    }
  }

  useEffect(() => {
    if (!active && visible) {
      const timer = setTimeout(() => setVisible(false), 800);
      return () => clearTimeout(timer);
    }
  }, [active, visible]);

  if (!visible) {
    return null;
  }

  return (
    <div className={`sound-wave-bars${stopping ? ' stopping' : ''}`} aria-hidden="true">
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <span key={i} className="sound-bar" />
      ))}
    </div>
  );
}
