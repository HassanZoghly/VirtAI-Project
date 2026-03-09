import { useSignup } from '@/features/auth/hooks/useAuth';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import GoogleAuthButton from './GoogleAuthButton';
import PasswordStrength from './PasswordStrength';

const signupSchema = z
  .object({
    fullName: z
      .string()
      .min(2, 'Name must be at least 2 characters')
      .regex(/^[a-zA-Z\s'-]+$/, 'Name can only contain letters, spaces, hyphens, and apostrophes'),
    email: z.string().min(1, 'Email is required').email('Please enter a valid email'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain an uppercase letter')
      .regex(/[a-z]/, 'Password must contain a lowercase letter')
      .regex(/[0-9]/, 'Password must contain a number')
      .regex(/[^A-Za-z0-9]/, 'Password must contain a special character'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export default function SignupForm({ onToggleMode }) {
  const { signup, isLoading } = useSignup();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(signupSchema),
    defaultValues: { fullName: '', email: '', password: '', confirmPassword: '' },
  });

  const passwordValue = watch('password');

  const onSubmit = async (data) => {
    await signup({ fullName: data.fullName, email: data.email, password: data.password });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="w-full max-w-md px-6"
    >
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-bold text-[var(--text-primary)]">Create account</h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Sign up to get started with VirtAI
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Full Name */}
        <div>
          <label
            htmlFor="fullName"
            className="mb-1 block text-sm font-medium text-[var(--text-secondary)]"
          >
            Full Name
          </label>
          <input
            id="fullName"
            type="text"
            autoComplete="name"
            placeholder="Eren Yeager"
            disabled={isLoading}
            {...register('fullName')}
            className="w-full rounded-lg border border-[var(--border-color)] bg-white/5 px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none transition-colors focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)] disabled:opacity-50"
          />
          {errors.fullName && (
            <p className="mt-1 text-xs text-red-400">{errors.fullName.message}</p>
          )}
        </div>

        {/* Email */}
        <div>
          <label
            htmlFor="signup-email"
            className="mb-1 block text-sm font-medium text-[var(--text-secondary)]"
          >
            Email
          </label>
          <input
            id="signup-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            disabled={isLoading}
            {...register('email')}
            className="w-full rounded-lg border border-[var(--border-color)] bg-white/5 px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none transition-colors focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)] disabled:opacity-50"
          />
          {errors.email && <p className="mt-1 text-xs text-red-400">{errors.email.message}</p>}
        </div>

        {/* Password */}
        <div>
          <label
            htmlFor="signup-password"
            className="mb-1 block text-sm font-medium text-[var(--text-secondary)]"
          >
            Password
          </label>
          <div className="relative">
            <input
              id="signup-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="••••••••"
              disabled={isLoading}
              {...register('password')}
              className="w-full rounded-lg border border-[var(--border-color)] bg-white/5 px-4 py-2.5 pr-10 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none transition-colors focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)] disabled:opacity-50"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            >
              {showPassword ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-5 0-9.27-3.11-11-7.5a11.72 11.72 0 013.168-4.477M6.343 6.343A9.97 9.97 0 0112 5c5 0 9.27 3.11 11 7.5a11.7 11.7 0 01-4.373 5.157M6.343 6.343L3 3m3.343 3.343l2.829 2.829m4.243 4.243L17.657 17.657M17.657 17.657L21 21m-3.343-3.343l-2.829-2.829a3 3 0 01-4.243-4.243"
                  />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
              )}
            </button>
          </div>
          {errors.password && (
            <p className="mt-1 text-xs text-red-400">{errors.password.message}</p>
          )}
          <PasswordStrength password={passwordValue} />
        </div>

        {/* Confirm Password */}
        <div>
          <label
            htmlFor="confirmPassword"
            className="mb-1 block text-sm font-medium text-[var(--text-secondary)]"
          >
            Confirm Password
          </label>
          <div className="relative">
            <input
              id="confirmPassword"
              type={showConfirm ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="••••••••"
              disabled={isLoading}
              {...register('confirmPassword')}
              className="w-full rounded-lg border border-[var(--border-color)] bg-white/5 px-4 py-2.5 pr-10 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none transition-colors focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)] disabled:opacity-50"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowConfirm((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            >
              {showConfirm ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-5 0-9.27-3.11-11-7.5a11.72 11.72 0 013.168-4.477M6.343 6.343A9.97 9.97 0 0112 5c5 0 9.27 3.11 11 7.5a11.7 11.7 0 01-4.373 5.157M6.343 6.343L3 3m3.343 3.343l2.829 2.829m4.243 4.243L17.657 17.657M17.657 17.657L21 21m-3.343-3.343l-2.829-2.829a3 3 0 01-4.243-4.243"
                  />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
              )}
            </button>
          </div>
          {errors.confirmPassword && (
            <p className="mt-1 text-xs text-red-400">{errors.confirmPassword.message}</p>
          )}
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isLoading}
          className="w-full rounded-lg bg-[var(--accent-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--primary-bg)] transition-colors hover:bg-[var(--accent-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
              Creating account…
            </span>
          ) : (
            'Create account'
          )}
        </button>
      </form>

      {/* Divider */}
      <div className="my-6 flex items-center gap-3">
        <hr className="flex-1 border-[var(--border-color)]" />
        <span className="text-xs text-[var(--text-muted)]">or continue with</span>
        <hr className="flex-1 border-[var(--border-color)]" />
      </div>

      <GoogleAuthButton label="Sign up with Google" />

      {/* Toggle to Login */}
      <p className="mt-6 text-center text-sm text-[var(--text-secondary)]">
        Already have an account?{' '}
        <button
          type="button"
          onClick={onToggleMode}
          className="font-medium text-[var(--accent-primary)] hover:underline"
        >
          Sign in
        </button>
      </p>
    </motion.div>
  );
}
