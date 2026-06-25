import { useEffect, useState, startTransition } from 'react';

const INITIAL_PHASES = {
  navbar: false,
  features: false,
  techStack: false,
  demo: false,
  footer: false,
};

type PhaseKey = keyof typeof INITIAL_PHASES;
const PHASE_SEQUENCE: PhaseKey[] = ['navbar', 'features', 'techStack', 'demo', 'footer'];

interface WindowWithIdle extends Window {
  requestIdleCallback: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  cancelIdleCallback: (handle: number) => void;
}

function scheduleIdleTask(task: () => void, { delay = 0, timeout = 1500 } = {}) {
  let idleId: number | null = null;
  let timeoutId: number | null = null;
  let cancelled = false;

  const runTask = () => {
    if (cancelled) return;
    task();
  };

  const queueTask = () => {
    const win = window as WindowWithIdle;
    if (typeof win.requestIdleCallback === 'function') {
      idleId = win.requestIdleCallback(runTask, { timeout });
      return;
    }
    timeoutId = window.setTimeout(runTask, 1);
  };

  if (delay > 0) {
    timeoutId = window.setTimeout(queueTask, delay);
  } else {
    queueTask();
  }

  return () => {
    cancelled = true;
    const win = window as WindowWithIdle;
    if (idleId !== null && typeof win.cancelIdleCallback === 'function') {
      win.cancelIdleCallback(idleId);
    }
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  };
}

export function useProgressivePhases(prefersReducedMotion: boolean, isLowPerformance: boolean) {
  const [phase2, setPhase2] = useState(INITIAL_PHASES);
  const [isAmbientReady, setIsAmbientReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let firstFrameId: number | null = null;
    let secondFrameId: number | null = null;
    const cleanups: (() => void)[] = [];

    const revealStep = (step: PhaseKey) => {
      startTransition(() => {
        setPhase2((currentPhase) => {
          if (currentPhase[step]) {
            return currentPhase;
          }
          return { ...currentPhase, [step]: true };
        });
      });
    };

    const queueStep = (index: number) => {
      if (cancelled || index >= PHASE_SEQUENCE.length) {
        return;
      }

      const cleanup = scheduleIdleTask(
        () => {
          if (cancelled) return;
          revealStep(PHASE_SEQUENCE[index]);
          queueStep(index + 1);
        },
        {
          delay: 0,
          timeout: index === 0 ? 1000 : 1600,
        }
      );

      cleanups.push(cleanup);
    };

    firstFrameId = window.requestAnimationFrame(() => {
      secondFrameId = window.requestAnimationFrame(() => {
        queueStep(0);
      });
    });

    return () => {
      cancelled = true;
      if (firstFrameId !== null) {
        cancelAnimationFrame(firstFrameId);
      }
      if (secondFrameId !== null) {
        cancelAnimationFrame(secondFrameId);
      }
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  useEffect(() => {
    if (!phase2.footer || prefersReducedMotion || isLowPerformance) {
      setIsAmbientReady(false);
      return;
    }

    return scheduleIdleTask(() => setIsAmbientReady(true), { delay: 0, timeout: 2600 });
  }, [phase2.footer, prefersReducedMotion, isLowPerformance]);

  return { phase2, isAmbientReady };
}

export default useProgressivePhases;
