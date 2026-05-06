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
  const inputClass =
    'w-full rounded-xl border border-(--border-color)/80 bg-black/[0.22] px-4 py-2.5 text-sm text-(--text-primary) placeholder-(--text-muted) shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] outline-none transition-[border-color,box-shadow,background-color,transform] duration-200 focus:scale-[1.005] focus:border-(--accent-primary) focus:bg-black/30 focus:shadow-[0_0_0_3px_rgba(255,255,255,0.1)] disabled:cursor-not-allowed disabled:border-(--border-color)/55 disabled:bg-black/[0.16] disabled:opacity-60';
  const labelClass =
    'mb-1 block text-xs font-semibold text-(--text-secondary) uppercase tracking-wide';

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
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="w-full space-y-3"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        {/* Full Name */}
        <div>
          <label htmlFor="fullName" className={labelClass}>
            Full Name
          </label>
          <input
            id="fullName"
            type="text"
            autoComplete="name"
            placeholder="Eren Yeager"
            disabled={isLoading}
            {...register('fullName')}
            className={inputClass}
          />
          {errors.fullName && (
            <p className="mt-1.5 text-xs font-medium text-(--error)">{errors.fullName.message}</p>
          )}
        </div>

        {/* Email */}
        <div>
          <label htmlFor="signup-email" className={labelClass}>
            Work email
          </label>
          <input
            id="signup-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            disabled={isLoading}
            {...register('email')}
            className={inputClass}
          />
          {errors.email && (
            <p className="mt-1.5 text-xs font-medium text-(--error)">{errors.email.message}</p>
          )}
        </div>

        {/* Password */}
        <div>
          <label htmlFor="signup-password" className={labelClass}>
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
              className={`${inputClass} pr-11`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-1 text-(--text-muted) transition-[color,transform] duration-200 hover:text-(--text-secondary) active:scale-95 focus-visible:text-(--text-primary)"
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
            <p className="mt-1.5 text-xs font-medium text-(--error)">{errors.password.message}</p>
          )}
          <PasswordStrength password={passwordValue} />
        </div>

        {/* Confirm Password */}
        <div>
          <label htmlFor="confirmPassword" className={labelClass}>
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
              className={`${inputClass} pr-11`}
            />
            <button
              type="button"
              onClick={() => setShowConfirm((v) => !v)}
              className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-1 text-(--text-muted) transition-[color,transform] duration-200 hover:text-(--text-secondary) active:scale-95 focus-visible:text-(--text-primary)"
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
            <p className="mt-1.5 text-xs font-medium text-(--error)">
              {errors.confirmPassword.message}
            </p>
          )}
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isLoading}
          className="w-full rounded-xl bg-(--accent-primary) px-4 py-3 text-sm font-semibold text-[#121212] shadow-md transition-colors transition-transform transition-shadow duration-200 hover:-translate-y-0.5 hover:bg-(--accent-secondary) hover:shadow-lg active:scale-[0.985] active:translate-y-0 disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-(--accent-primary)/55 disabled:text-[#121212]/80 disabled:opacity-100 disabled:shadow-none"
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
      <div className="flex items-center gap-3">
        <hr className="flex-1 border-(--border-color)/70" />
        <span className="text-xs text-(--text-muted)">or</span>
        <hr className="flex-1 border-(--border-color)/70" />
      </div>

      <GoogleAuthButton label="Sign up with Google" />

      {/* Toggle to Login */}
      <p className="text-center text-xs text-(--text-secondary)">
        Already have an account?{' '}
        <button
          type="button"
          onClick={onToggleMode}
          className="font-semibold text-(--accent-primary) transition-colors hover:text-(--accent-secondary) hover:underline"
        >
          Sign in
        </button>
      </p>
    </motion.div>
  );
}
