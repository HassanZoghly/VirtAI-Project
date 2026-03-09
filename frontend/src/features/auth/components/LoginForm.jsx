import { useLogin } from '@/features/auth/hooks/useAuth';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import GoogleAuthButton from './GoogleAuthButton';

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Please enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export default function LoginForm({ onToggleMode }) {
  const { login, isLoading } = useLogin();
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = (data) => {
    login(data.email, data.password);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="w-full max-w-md space-y-6"
    >
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-bold text-[var(--text-primary)]">Welcome back</h2>
        <p className="text-sm text-[var(--text-secondary)]">Sign in to continue to VirtAI</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Email */}
        <div className="space-y-1.5">
          <label
            htmlFor="login-email"
            className="block text-sm font-medium text-[var(--text-secondary)]"
          >
            Email
          </label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            disabled={isLoading}
            {...register('email')}
            className="w-full rounded-lg border border-[var(--border-color)] bg-white/5 px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none transition-colors focus:border-[var(--accent-primary)] disabled:opacity-50"
          />
          {errors.email && <p className="text-xs text-[var(--error)]">{errors.email.message}</p>}
        </div>

        {/* Password */}
        <div className="space-y-1.5">
          <label
            htmlFor="login-password"
            className="block text-sm font-medium text-[var(--text-secondary)]"
          >
            Password
          </label>
          <div className="relative">
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••"
              disabled={isLoading}
              {...register('password')}
              className="w-full rounded-lg border border-[var(--border-color)] bg-white/5 px-4 py-2.5 pr-10 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none transition-colors focus:border-[var(--accent-primary)] disabled:opacity-50"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((v) => !v)}
              className="absolute top-1/2 right-3 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                  <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
          {errors.password && (
            <p className="text-xs text-[var(--error)]">{errors.password.message}</p>
          )}
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isLoading}
          className="flex w-full items-center justify-center rounded-lg bg-[var(--accent-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--primary-bg)] transition-colors hover:bg-[var(--accent-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? (
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-current/30 border-t-current" />
          ) : (
            'Sign in'
          )}
        </button>
      </form>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-[var(--border-color)]" />
        <span className="text-xs text-[var(--text-muted)]">or continue with</span>
        <div className="h-px flex-1 bg-[var(--border-color)]" />
      </div>

      <GoogleAuthButton />

      {/* Toggle to signup */}
      <p className="text-center text-sm text-[var(--text-secondary)]">
        Don&apos;t have an account?{' '}
        <button
          type="button"
          onClick={onToggleMode}
          className="font-medium text-[var(--accent-primary)] hover:underline"
        >
          Create one
        </button>
      </p>
    </motion.div>
  );
}
