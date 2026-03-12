import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import LoginForm from './LoginForm';
import SignupForm from './SignupForm';
import WelcomePanel from './WelcomePanel';

export default function AuthPage() {
  const [mode, setMode] = useState('login');

  const toggleMode = () => setMode((m) => (m === 'login' ? 'signup' : 'login'));

  return (
    <>
      <Helmet>
        <title>Sign In — VirtAI</title>
      </Helmet>
      <div className="grid min-h-screen bg-(--primary-bg) lg:grid-cols-2">
        {/* Left — branding panel (hidden on mobile via WelcomePanel's own classes) */}
        <WelcomePanel />

        {/* Right — auth form */}
        <div className="flex items-center justify-center overflow-y-auto px-6 py-12">
          <div className="w-full max-w-md">
            <AnimatePresence mode="wait">
              {mode === 'login' ? (
                <motion.div
                  key="login"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                >
                  <LoginForm onToggleMode={toggleMode} />
                </motion.div>
              ) : (
                <motion.div
                  key="signup"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                >
                  <SignupForm onToggleMode={toggleMode} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </>
  );
}
