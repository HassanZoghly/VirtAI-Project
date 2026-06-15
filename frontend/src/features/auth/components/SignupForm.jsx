import { useSignup } from '@/features/auth/hooks/useAuth';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'motion/react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import GoogleAuthButton from './GoogleAuthButton';
import PasswordStrength from './PasswordStrength';
import PasswordInput from './PasswordInput';

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
  const inputClass =
    'w-full rounded-xl border border-(--border-color)/80 bg-black/[0.22] px-4 py-2.5 text-sm text-(--text-primary) placeholder-(--text-muted) shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] outline-none transition-[border-color,box-shadow,background-color,transform] duration-200 focus:scale-[1.005] focus:border-(--accent-primary) focus:bg-black/30 focus:shadow-[0_0_0_3px_rgba(255,255,255,0.1)] disabled:cursor-not-allowed disabled:border-(--border-color)/55 disabled:bg-black/[0.16] disabled:opacity-60';
  const labelClass =
    'mb-1 block text-xs font-semibold text-(--text-secondary) uppercase tracking-wide';

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(signupSchema),
    defaultValues: { fullName: '', email: '', password: '', confirmPassword: '' },
  });

  const passwordValue = useWatch({ control, name: 'password' });

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
          <input id="signup-email" type="email" autoComplete="email" placeholder="you@example.com" disabled={isLoading} {...register('email')} className={inputClass} />
          {errors.email && <p className="mt-1.5 text-xs font-medium text-(--error)">{errors.email.message}</p>}
        </div>

        {/* Password */}
        <div>
          <label htmlFor="signup-password" className={labelClass}>
            Password
          </label>
          <PasswordInput
            id="signup-password"
            placeholder="••••••••"
            disabled={isLoading}
            register={register('password')}
            className={inputClass}
          />
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
          <PasswordInput
            id="confirmPassword"
            placeholder="••••••••"
            disabled={isLoading}
            register={register('confirmPassword')}
            className={inputClass}
          />
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
