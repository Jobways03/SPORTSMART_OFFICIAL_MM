'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AuthMobileHeader } from '@/components/auth/AuthMobileHeader';
import { Eye, EyeOff, AlertCircle, CheckCircle2, ArrowRight, KeyRound, LifeBuoy, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { AuthBrandPanel } from '@/components/auth/AuthBrandPanel';
import { authService } from '@/services/auth.service';
import { ApiError } from '@/lib/api-client';
import { validatePassword, validateConfirmPassword } from '@/lib/validators';

interface FormErrors {
  newPassword?: string;
  confirmPassword?: string;
}

/**
 * Shared shell for the reset page's two states (form + success).
 * Declared at MODULE scope, not inside the component — a component
 * defined inside another is a new type on every render, which would
 * remount this subtree (and drop input focus) on each keystroke.
 * Split-screen layout mirrors the rest of the customer auth flow via
 * the shared AuthBrandPanel.
 */
function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ink-50 flex justify-center">
      <div className="w-full max-w-[1320px] min-h-screen grid lg:grid-cols-2">
        {/* Branded panel */}
        <AuthBrandPanel>
          <h2 className="font-display text-[clamp(56px,6vw,96px)] leading-[0.92] tracking-tight text-ink-900">
            Almost
            <br />
            <span className="font-brush text-sale text-[0.85em] tracking-normal">there.</span>
          </h2>
          <p className="mt-6 text-body-lg text-ink-700 max-w-md">
            Choose a strong new password and you&apos;re back in the game.
          </p>
          <ul className="mt-10 grid sm:grid-cols-2 gap-3 max-w-lg">
            {[
              { icon: ShieldCheck, title: 'Strong & secure', desc: '8+ chars, mixed case' },
              { icon: Lock, title: 'Encrypted', desc: 'Your data stays safe' },
              { icon: KeyRound, title: 'Fresh start', desc: 'New password, new login' },
              { icon: LifeBuoy, title: 'Need a hand?', desc: 'Support is one click away' },
            ].map(({ icon: Icon, title, desc }) => (
              <li key={title} className="bg-white border border-ink-900/10 p-3">
                <Icon className="size-4 text-accent-dark" strokeWidth={1.75} />
                <div className="mt-2 text-body font-semibold text-ink-900">{title}</div>
                <div className="text-caption text-ink-600">{desc}</div>
              </li>
            ))}
          </ul>
        </AuthBrandPanel>

        {/* Form panel */}
        <div className="flex flex-col">
          <AuthMobileHeader switchPrompt="Remember it?" switchLabel="Sign in" switchHref="/login" />

          <main className="flex-1 px-6 lg:px-10 pt-6 lg:pt-10 pb-10 flex items-start sm:items-center">
            <div className="w-full max-w-md mx-auto">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    try {
      const token = sessionStorage.getItem('resetToken');
      if (!token) {
        router.replace('/forgot-password');
        return;
      }
      setResetToken(token);
    } catch {
      router.replace('/forgot-password');
    }
  }, [router]);

  const handleBlur = (field: string) => {
    let error: string | null = null;
    if (field === 'newPassword') error = validatePassword(newPassword);
    if (field === 'confirmPassword') error = validateConfirmPassword(newPassword, confirmPassword);
    setErrors((prev) => ({ ...prev, [field]: error || undefined }));
  };

  const validateAll = (): boolean => {
    const newErrors: FormErrors = {};
    const pwErr = validatePassword(newPassword);
    const cpErr = validateConfirmPassword(newPassword, confirmPassword);
    if (pwErr) newErrors.newPassword = pwErr;
    if (cpErr) newErrors.confirmPassword = cpErr;
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError('');

    if (!validateAll()) {
      const firstErrorField = document.querySelector('[aria-invalid="true"]') as HTMLElement;
      firstErrorField?.focus();
      return;
    }

    setIsSubmitting(true);

    try {
      await authService.resetPassword(resetToken, newPassword);

      // Clear stored token
      try {
        sessionStorage.removeItem('resetToken');
        sessionStorage.removeItem('resetEmail');
      } catch {
        // Storage unavailable
      }

      setSuccess(true);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setServerError(err.body.message || 'Invalid or expired reset token. Please start over.');
        } else if (err.status === 422 && err.body.errors) {
          const fieldErrors: FormErrors = {};
          for (const e of err.body.errors) {
            (fieldErrors as Record<string, string>)[e.field] = e.message;
          }
          setErrors(fieldErrors);
        } else if (err.status === 429) {
          setServerError('Too many attempts. Please try again later.');
        } else {
          setServerError('Something went wrong. Please try again.');
        }
      } else {
        setServerError('Something went wrong. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass = (hasError: boolean, extra = '') =>
    `w-full h-12 px-4 ${extra} border bg-white text-body-lg placeholder:text-ink-400 focus:outline-none transition-colors rounded-full ${
      hasError
        ? 'border-danger focus:border-danger'
        : 'border-ink-300 hover:border-ink-500 focus:border-ink-900'
    }`;

  if (success) {
    return (
      <AuthShell>
        <h1 className="font-display text-2xl sm:text-3xl text-ink-900 leading-tight">
          Password reset
        </h1>
        <div
          role="status"
          className="mt-6 flex items-start gap-2 p-3 border border-success/30 bg-green-50 text-[#15803D] text-body rounded-2xl"
        >
          <CheckCircle2 className="size-4 mt-0.5 shrink-0" />
          Your password has been reset. You can now sign in with your new
          password.
        </div>
        <Link
          href="/login"
          className="mt-6 w-full h-12 bg-ink-900 text-white font-semibold hover:bg-ink-800 inline-flex items-center justify-center gap-2 transition-colors rounded-full"
        >
          Go to sign in <ArrowRight className="size-4" />
        </Link>
      </AuthShell>
    );
  }

  if (!resetToken) return null;

  return (
    <AuthShell>
      <h1 className="font-display text-2xl sm:text-3xl text-ink-900 leading-tight">
        Set a new password
      </h1>
      <p className="mt-3 text-body-lg text-ink-600">
        Create a strong password for your account.
      </p>

      {serverError && (
        <div
          role="alert"
          className="mt-6 flex items-start gap-2 p-3 border border-danger/30 bg-red-50 text-[#B91C1C] text-body rounded-2xl"
        >
          <AlertCircle className="size-4 mt-0.5 shrink-0" />
          {serverError}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="mt-7 space-y-4">
        <fieldset disabled={isSubmitting} className="space-y-4 border-0 p-0 m-0">
          <div>
            <label
              htmlFor="newPassword"
              className="block text-caption uppercase tracking-wider font-semibold text-ink-700 mb-2"
            >
              New password
            </label>
            <div className="relative">
              <input
                id="newPassword"
                type={showPassword ? 'text' : 'password'}
                placeholder="Create a password"
                value={newPassword}
                maxLength={128}
                onChange={(e) => setNewPassword(e.target.value)}
                onBlur={() => handleBlur('newPassword')}
                aria-invalid={!!errors.newPassword}
                aria-describedby={
                  errors.newPassword ? 'newPassword-error' : 'newPassword-hint'
                }
                autoComplete="new-password"
                autoFocus
                className={inputClass(!!errors.newPassword, 'pr-12')}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
                className="absolute right-2 top-1/2 -translate-y-1/2 size-8 grid place-items-center text-ink-500 hover:text-ink-900"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {errors.newPassword ? (
              <p
                id="newPassword-error"
                role="alert"
                className="mt-1.5 text-caption text-danger flex items-center gap-1"
              >
                <AlertCircle className="size-3" /> {errors.newPassword}
              </p>
            ) : (
              <p id="newPassword-hint" className="mt-1.5 text-caption text-ink-600">
                Use 8+ characters with upper &amp; lower case, a number and a symbol.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-caption uppercase tracking-wider font-semibold text-ink-700 mb-2"
            >
              Confirm password
            </label>
            <input
              id="confirmPassword"
              type={showPassword ? 'text' : 'password'}
              placeholder="Re-enter your new password"
              value={confirmPassword}
              maxLength={128}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onBlur={() => handleBlur('confirmPassword')}
              aria-invalid={!!errors.confirmPassword}
              aria-describedby={
                errors.confirmPassword ? 'confirmPassword-error' : undefined
              }
              autoComplete="new-password"
              className={inputClass(!!errors.confirmPassword)}
            />
            {errors.confirmPassword && (
              <p
                id="confirmPassword-error"
                role="alert"
                className="mt-1.5 text-caption text-danger flex items-center gap-1"
              >
                <AlertCircle className="size-3" /> {errors.confirmPassword}
              </p>
            )}
          </div>

          <button
            type="submit"
            aria-busy={isSubmitting}
            className="w-full h-12 bg-ink-900 text-white font-semibold hover:bg-ink-800 disabled:opacity-50 inline-flex items-center justify-center gap-2 transition-colors rounded-full"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Resetting…
              </>
            ) : (
              <>
                Reset password <ArrowRight className="size-4" />
              </>
            )}
          </button>
        </fieldset>
      </form>

      <p className="mt-8 text-body text-ink-600 text-center">
        <Link
          href="/login"
          className="text-accent-dark hover:text-ink-900 hover:underline underline-offset-2"
        >
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
