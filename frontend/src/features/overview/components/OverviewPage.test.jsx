// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { Suspense } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AppRoutes from '@/app/routes';
import PageLoader from '@/shared/components/PageLoader';

import OverviewPage from './OverviewPage';

vi.mock('motion/react', async () => {
  const React = await import('react');
  const componentCache = new Map();
  const blockedProps = new Set([
    'animate',
    'exit',
    'initial',
    'layoutId',
    'transition',
    'viewport',
    'whileHover',
    'whileInView',
  ]);

  const getMotionComponent = (tag) => {
    if (!componentCache.has(tag)) {
      const Component = React.forwardRef(({ children, ...props }, ref) => {
        const filteredProps = Object.fromEntries(
          Object.entries(props).filter(([key]) => !blockedProps.has(key))
        );

        return React.createElement(tag, { ...filteredProps, ref }, children);
      });
      Component.displayName = `MockMotion(${tag})`;
      componentCache.set(tag, Component);
    }

    return componentCache.get(tag);
  };

  return {
    AnimatePresence: ({ children }) => <>{children}</>,
    motion: new Proxy(
      {},
      {
        get: (_, tag) => getMotionComponent(tag),
      }
    ),
    useReducedMotion: () => false,
  };
});

function createScheduler() {
  const animationFrames = [];
  const idleCallbacks = [];

  vi.stubGlobal('requestAnimationFrame', (callback) => {
    animationFrames.push(callback);
    return animationFrames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());

  vi.stubGlobal('requestIdleCallback', (callback) => {
    idleCallbacks.push(callback);
    return idleCallbacks.length;
  });
  vi.stubGlobal('cancelIdleCallback', vi.fn());

  return {
    flushNextAnimationFrame() {
      const callback = animationFrames.shift();
      callback?.(16);
    },
    flushAllAnimationFrames() {
      while (animationFrames.length) {
        this.flushNextAnimationFrame();
      }
    },
    flushNextIdle() {
      const callback = idleCallbacks.shift();
      callback?.({
        didTimeout: false,
        timeRemaining: () => 50,
      });
    },
    flushIdleCallbacks(count = Number.POSITIVE_INFINITY) {
      let remaining = count;
      while (idleCallbacks.length && remaining > 0) {
        this.flushNextIdle();
        remaining -= 1;
      }
    },
  };
}

function installBrowserMocks({ reducedMotion = false, lowPower = false } = {}) {
  const scheduler = createScheduler();

  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query) => ({
      matches:
        query === '(prefers-reduced-motion: reduce)'
          ? reducedMotion
          : query === '(min-width: 1024px)'
            ? !lowPower
            : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  );

  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  );

  Object.defineProperty(navigator, 'connection', {
    configurable: true,
    value: {
      saveData: false,
      effectiveType: lowPower ? '2g' : '4g',
    },
  });
  Object.defineProperty(navigator, 'deviceMemory', {
    configurable: true,
    value: lowPower ? 2 : 8,
  });
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    configurable: true,
    value: lowPower ? 2 : 8,
  });

  sessionStorage.clear();
  sessionStorage.setItem('virtai:overview-splash-seen', '1');

  return scheduler;
}

function renderOverviewPage() {
  return render(
    <HelmetProvider>
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    </HelmetProvider>
  );
}

function renderAppRoutes() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/']}>
        <Suspense fallback={<PageLoader />}>
          <AppRoutes />
        </Suspense>
      </MemoryRouter>
    </HelmetProvider>
  );
}

describe('landing page rendering strategy', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('renders the hero on the landing route without waiting for the route suspense fallback', () => {
    installBrowserMocks();

    renderAppRoutes();

    expect(screen.queryByRole('status', { name: /loading/i })).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /deploy an ai teaching assistant your institution can rely on/i,
      })
    ).toBeInTheDocument();
  });

  it('hydrates non-critical landing sections progressively after the first paint', async () => {
    const scheduler = installBrowserMocks();

    renderOverviewPage();

    expect(
      screen.getAllByRole('heading', {
        level: 1,
        name: /deploy an ai teaching assistant your institution can rely on/i,
      })[0]
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /core features/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /how it works/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /tech stack/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /meet the team/i })).not.toBeInTheDocument();
    expect(document.querySelector('canvas')).toBeNull();

    scheduler.flushAllAnimationFrames();
    scheduler.flushNextIdle();

    expect(screen.queryByRole('heading', { name: /core features/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /meet the team/i })).not.toBeInTheDocument();
    expect(document.querySelector('canvas')).toBeNull();

    scheduler.flushNextIdle();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /core features/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('heading', { name: /meet the team/i })).not.toBeInTheDocument();

    scheduler.flushIdleCallbacks();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /how it works/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /tech stack/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /meet the team/i })).toBeInTheDocument();
    });
  });
});
