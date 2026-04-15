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
  const inputClass =
    'w-full rounded-xl border border-(--border-color)/80 bg-black/[0.22] px-4 py-3 text-sm text-(--text-primary) placeholder-(--text-muted) shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] outline-none transition-[border-color,box-shadow,background-color,transform] duration-200 focus:scale-[1.005] focus:border-(--accent-primary) focus:bg-black/30 focus:shadow-[0_0_0_3px_rgba(240,200,82,0.16)] disabled:cursor-not-allowed disabled:border-(--border-color)/55 disabled:bg-black/[0.16] disabled:opacity-60';
  const labelClass = 'mb-1.5 block text-sm font-medium text-(--text-secondary)';

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
      transition={{ duration: 0.26 }}
      className="w-full space-y-5"
    >
      <div className="space-y-1.5 text-center">
        <h2 className="text-[1.45rem] leading-tight font-semibold tracking-tight text-(--text-primary)">
          Sign in
        </h2>
        <p className="text-sm leading-relaxed text-(--text-secondary)">
          Continue with your existing VirtAI account.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Email */}
        <div>
          <label htmlFor="login-email" className={labelClass}>
            Work email
          </label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            disabled={isLoading}
            {...register('email')}
            className={inputClass}
          />
          {errors.email && <p className="mt-1.5 text-xs font-medium text-(--error)">{errors.email.message}</p>}
        </div>

        {/* Password */}
        <div>
          <label htmlFor="login-password" className={labelClass}>
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
              className={`${inputClass} pr-11`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-1 text-(--text-muted) transition-[color,transform] duration-200 hover:text-(--text-secondary) active:scale-95 focus-visible:text-(--text-primary)"
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
            <p className="mt-1.5 text-xs font-medium text-(--error)">{errors.password.message}</p>
          )}
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isLoading}
          className="flex w-full items-center justify-center rounded-xl bg-(--accent-primary) px-4 py-3.5 text-sm font-semibold text-(--primary-bg) shadow-[0_22px_34px_-24px_rgba(240,200,82,0.9)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-(--accent-secondary) hover:shadow-[0_24px_36px_-20px_rgba(240,200,82,0.9)] active:scale-[0.985] active:translate-y-0 disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-(--accent-primary)/55 disabled:text-(--primary-bg)/80 disabled:opacity-100 disabled:shadow-none"
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
        <div className="h-px flex-1 bg-(--border-color)/70" />
        <span className="text-xs text-(--text-muted)">or continue with</span>
        <div className="h-px flex-1 bg-(--border-color)/70" />
      </div>

      <GoogleAuthButton />

      {/* Toggle to signup */}
      <p className="text-center text-sm text-(--text-secondary)">
        Don&apos;t have an account?{' '}
        <button
          type="button"
          onClick={onToggleMode}
          className="font-medium text-(--accent-primary) transition-colors hover:text-(--accent-secondary) hover:underline"
        >
          Create one
        </button>
      </p>
    </motion.div>
  );
}
