import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import LoginForm from './LoginForm';
import SignupForm from './SignupForm';

const AUTH_MODES = [
  { key: 'login', label: 'Sign in', tabId: 'auth-tab-login', panelId: 'auth-panel-login' },
  { key: 'signup', label: 'Sign up', tabId: 'auth-tab-signup', panelId: 'auth-panel-signup' },
];

export default function AuthPage() {
  const [mode, setMode] = useState('login');

  const toggleMode = () => setMode((currentMode) => (currentMode === 'login' ? 'signup' : 'login'));
  const activeMode = AUTH_MODES.find((authMode) => authMode.key === mode) ?? AUTH_MODES[0];

  return (
    <>
      <Helmet>
        <title>Sign In — VirtAI</title>
      </Helmet>
      <div
        data-testid="auth-shell"
        className="relative flex min-h-screen items-center justify-center overflow-hidden bg-(--primary-bg) px-4 py-12 sm:px-6"
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[#0d0d10]" />
        <div
          data-testid="auth-background-wash"
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(240,200,82,0.08),transparent_42%),radial-gradient(circle_at_88%_8%,rgba(109,0,26,0.12),transparent_30%),linear-gradient(180deg,rgba(18,18,22,0.82)_0%,rgba(13,13,16,0.96)_100%)]"
        />
        <motion.section
          initial={{ opacity: 0, y: 22, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="relative w-full max-w-[35rem] rounded-[1.75rem] border border-white/10 bg-[linear-gradient(165deg,rgba(255,255,255,0.055)_0%,rgba(255,255,255,0.018)_100%)] p-6 shadow-[0_38px_78px_-44px_rgba(0,0,0,0.88)] backdrop-blur-2xl sm:p-10"
        >
          <div className="text-center">
            <span className="inline-flex items-center rounded-full border border-(--color-gold)/35 bg-(--color-gold)/10 px-3 py-1 text-[11px] font-semibold tracking-[0.16em] text-(--color-gold) uppercase">
              VirtAI Secure Access
            </span>
            <h1 className="mt-6 text-[2rem] leading-[1.12] font-semibold tracking-tight text-(--text-primary) sm:text-[2.3rem]">
              Welcome back to VirtAI
            </h1>
            <p className="mx-auto mt-3 max-w-[30rem] text-sm leading-relaxed text-(--text-secondary) sm:text-[0.96rem]">
              Secure access to your classroom, sessions, and AI tutor experience.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Auth mode"
            className="relative mt-8 grid grid-cols-2 rounded-xl border border-white/12 bg-black/20 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
          >
            <motion.span
              data-testid="auth-tab-indicator"
              data-active-mode={mode}
              layout
              transition={{ type: 'spring', stiffness: 340, damping: 28, mass: 0.85 }}
              className={`pointer-events-none absolute top-1.5 bottom-1.5 z-0 w-[calc(50%_-_0.5rem)] rounded-[0.7rem] bg-[linear-gradient(135deg,#f0c852_0%,#d4af37_100%)] shadow-[0_16px_28px_-18px_rgba(240,200,82,0.92)] ring-1 ring-[#f5d77f]/45 ${
                mode === 'login' ? 'left-1.5' : 'left-[calc(50%_+_0.25rem)]'
              }`}
            />
            {AUTH_MODES.map((authMode) => {
              const isActive = mode === authMode.key;
              return (
                <button
                  key={authMode.key}
                  id={authMode.tabId}
                  type="button"
                  role="tab"
                  data-active={isActive ? 'true' : 'false'}
                  aria-controls={authMode.panelId}
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setMode(authMode.key)}
                  className={`relative z-10 rounded-[0.7rem] px-4 py-2.5 text-sm font-semibold transition-[color,opacity,transform] duration-300 active:scale-[0.985] ${
                    isActive
                      ? 'text-[#191919] drop-shadow-[0_1px_0_rgba(255,255,255,0.2)]'
                      : 'text-(--text-secondary) hover:text-(--text-primary) hover:opacity-100'
                  }`}
                >
                  {authMode.label}
                </button>
              );
            })}
          </div>

          <div className="mt-8">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={mode}
                role="tabpanel"
                id={activeMode.panelId}
                aria-labelledby={activeMode.tabId}
                initial={{ opacity: 0, y: 12, scale: 0.995 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.995 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                {mode === 'login' ? (
                  <LoginForm onToggleMode={toggleMode} />
                ) : (
                  <SignupForm onToggleMode={toggleMode} />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.section>
      </div>
    </>
  );
}
