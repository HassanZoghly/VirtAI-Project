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

  const toggleMode = () => setMode((m) => (m === 'login' ? 'signup' : 'login'));
  const activeMode = AUTH_MODES.find((m) => m.key === mode) ?? AUTH_MODES[0];

  return (
    <>
      <Helmet>
        <title>Sign In — VirtAI</title>
      </Helmet>

      {/* ── Page shell — full screen, no scroll ── */}
      <div
        data-testid="auth-shell"
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          backgroundColor: 'var(--secondary-bg, #1a1a1a)', // Left color: dark secondary
        }}
      >
        {/* ── RIGHT diagonal gold background ── */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background: 'var(--color-gold, #B4AB8B)', // Gold color
            // Diagonal cut exactly anchored relative to center
            clipPath: 'polygon(calc(50vw - 240px) 0, 100% 0, 100% 100%, calc(50vw + 240px) 100%)', 
          }}
        />

        {/* ── VirtAI wordmark — page top-left ── */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          style={{
            position: 'absolute',
            top: 40,
            left: 48,
            zIndex: 30,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-display, "Space Grotesk", system-ui)',
              fontWeight: 800,
              fontSize: '1.5rem',
              letterSpacing: '-0.03em',
              color: 'var(--color-gold, #B4AB8B)',
              textShadow: '0 2px 14px rgba(0,0,0,0.5)',
            }}
          >
            VirtAI
          </span>
        </motion.div>

        {/* ── AUTH CARD — overlapping the diagonal ── */}
        <motion.section
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
          style={{
            position: 'relative',
            zIndex: 20,
            width: '100%',
            maxWidth: '430px', // slightly wider form container if needed, matches compact
            borderRadius: '20px',
            background: 'var(--card-bg, #1e1e1e)', // Form background remains dark card
            border: '1px solid rgba(255,255,255,0.06)',
            boxShadow: '0 32px 64px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.15)',
            padding: '2.5rem 2rem 2rem',
            // Centered perfectly, removing translation ensures our calc(50vw) clips align gracefully
          }}
        >
          {/* Badge */}
          <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                borderRadius: 99,
                border: '1px solid rgba(180, 171, 139, 0.4)',
                background: 'rgba(180, 171, 139, 0.1)',
                padding: '4px 14px',
                fontSize: '0.65rem',
                fontWeight: 700,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: 'var(--color-gold, #B4AB8B)',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--color-gold, #B4AB8B)',
                  display: 'inline-block',
                }}
              />
              VirtAI Secure Access
            </span>
          </div>

          {/* Tab switcher */}
          <div
            role="tablist"
            aria-label="Auth mode"
            style={{
              position: 'relative',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              borderRadius: '0.75rem',
              border: '1px solid rgba(255,255,255,0.05)',
              background: 'rgba(0,0,0,0.4)',
              padding: '6px',
              marginBottom: '1.5rem',
            }}
          >
            <motion.span
              data-testid="auth-tab-indicator"
              data-active-mode={mode}
              layout
              transition={{ type: 'spring', stiffness: 340, damping: 28, mass: 0.85 }}
              style={{
                pointerEvents: 'none',
                position: 'absolute',
                top: 6,
                bottom: 6,
                zIndex: 0,
                width: 'calc(50% - 6px)',
                borderRadius: '0.5rem',
                background: 'var(--color-gold, #B4AB8B)',
                left: mode === 'login' ? 6 : 'calc(50% + 0px)',
              }}
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
                  style={{
                    position: 'relative',
                    zIndex: 1,
                    borderRadius: '0.5rem',
                    padding: '8px 16px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    transition: 'color 0.25s',
                    color: isActive ? '#121212' : 'var(--text-secondary, #b0b0b0)',
                  }}
                >
                  {authMode.label}
                </button>
              );
            })}
          </div>

          {/* Form panel */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={mode}
              role="tabpanel"
              id={activeMode.panelId}
              aria-labelledby={activeMode.tabId}
              initial={{ opacity: 0, y: 10, scale: 0.996 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.996 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              {mode === 'login' ? (
                <LoginForm onToggleMode={toggleMode} />
              ) : (
                <SignupForm onToggleMode={toggleMode} />
              )}
            </motion.div>
          </AnimatePresence>
        </motion.section>
      </div>
    </>
  );
}
