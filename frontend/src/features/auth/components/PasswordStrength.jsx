import { cn } from '@/shared/utils/cn';

const rules = [
  { label: 'At least 8 characters', test: (v) => v.length >= 8 },
  { label: 'One uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { label: 'One lowercase letter', test: (v) => /[a-z]/.test(v) },
  { label: 'One number', test: (v) => /\d/.test(v) },
  { label: 'One special character', test: (v) => /[^A-Za-z0-9]/.test(v) },
];

const strengthConfig = [
  { label: 'Very weak', color: 'bg-red-500' },
  { label: 'Weak', color: 'bg-orange-500' },
  { label: 'Fair', color: 'bg-yellow-500' },
  { label: 'Good', color: 'bg-lime-500' },
  { label: 'Strong', color: 'bg-green-500' },
];

export default function PasswordStrength({ password = '' }) {
  const passed = rules.filter((r) => r.test(password)).length;

  if (!password) {
    return null;
  }

  const config = strengthConfig[passed - 1] ?? strengthConfig[0];

  return (
    <div className="mt-2 space-y-2">
      {/* Strength bar */}
      <div className="flex gap-1">
        {strengthConfig.map((_, i) => (
          <div
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-300',
              i < passed ? config.color : 'bg-white/10'
            )}
          />
        ))}
      </div>

      <p className="text-xs text-(--text-secondary)">
        Strength: <span className="font-medium text-(--text-primary)">{config.label}</span>
      </p>

      {/* Rule checklist */}
      <ul className="space-y-1">
        {rules.map((rule, i) => {
          const ok = rule.test(password);
          return (
            <li
              key={i}
              className={cn(
                'flex items-center gap-1.5 text-xs transition-colors',
                ok ? 'text-green-400' : 'text-(--text-muted)'
              )}
            >
              {ok ? (
                <svg className="h-3 w-3 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              ) : (
                <svg className="h-3 w-3 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <circle cx="10" cy="10" r="3" />
                </svg>
              )}
              {rule.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
