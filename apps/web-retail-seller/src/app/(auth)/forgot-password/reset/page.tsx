'use client';

import { Suspense, useState, useEffect, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { sellerAuthService } from '@/services/auth.service';
import { ApiError } from '@/lib/api-client';
import { validatePassword, validateConfirmPassword, getPasswordStrength } from '@/lib/validators';
import '../forgot-password.css';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface FormErrors {
  newPassword?: string;
  confirmPassword?: string;
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Flow guard: redirect if no valid token
  useEffect(() => {
    if (!token || !UUID_REGEX.test(token)) {
      router.replace('/forgot-password');
    }
  }, [token, router]);

  // Auto-redirect after success
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => {
      router.push('/login');
    }, 3000);
    return () => clearTimeout(timer);
  }, [success, router]);

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
      await sellerAuthService.resetPassword(token, newPassword, confirmPassword);
      setSuccess(true);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          const msg = err.body.message || 'Invalid or expired reset link. Please start over.';
          setServerError(typeof msg === 'string' ? msg : Array.isArray(msg) ? msg[0] : String(msg));
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

  if (success) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-header">
            <h1 className="auth-logo">SPORTSMART</h1>
            <p className="auth-badge">Seller Portal</p>
            <div className="success-icon" aria-hidden="true">&#10003;</div>
            <h2 className="auth-title">Password reset successful</h2>
            <p className="auth-subtitle">
              Your password has been reset. You will be redirected to sign in shortly.
            </p>
          </div>
          <Link href="/login">
            <button type="button" className="btn-submit">Go to Sign In</button>
          </Link>
        </div>
      </div>
    );
  }

  if (!token || !UUID_REGEX.test(token)) return null;

  const strength = getPasswordStrength(newPassword);

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-logo">SPORTSMART</h1>
          <p className="auth-badge">Seller Portal</p>
          <h2 className="auth-title">Set your new password</h2>
          <p className="auth-subtitle">Create a strong password for your seller account.</p>
        </div>

        {serverError && (
          <div className="alert alert-error" role="alert">
            {serverError}
            {(serverError.includes('expired') || serverError.includes('already been used')) && (
              <div style={{ marginTop: 8 }}>
                <Link href="/forgot-password" style={{ fontWeight: 500 }}>
                  Start over
                </Link>
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="newPassword">New Password *</label>
            <div className="password-wrapper">
              <input
                id="newPassword"
                type={showNewPassword ? 'text' : 'password'}
                placeholder="Enter new password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                onBlur={() => handleBlur('newPassword')}
                aria-invalid={!!errors.newPassword}
                aria-describedby="password-strength"
                disabled={isSubmitting}
                autoComplete="new-password"
                autoFocus
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowNewPassword(!showNewPassword)}
                aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showNewPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {errors.newPassword && (
              <span className="field-error" role="alert">
                {errors.newPassword}
              </span>
            )}
            <div id="password-strength" className="password-strength" aria-live="polite">
              <div className={`rule ${strength.hasMinLength ? 'met' : ''}`}>
                {strength.hasMinLength ? '\u2713' : '\u2717'} At least 8 characters
              </div>
              <div className={`rule ${strength.hasUppercase ? 'met' : ''}`}>
                {strength.hasUppercase ? '\u2713' : '\u2717'} One uppercase letter
              </div>
              <div className={`rule ${strength.hasLowercase ? 'met' : ''}`}>
                {strength.hasLowercase ? '\u2713' : '\u2717'} One lowercase letter
              </div>
              <div className={`rule ${strength.hasDigit ? 'met' : ''}`}>
                {strength.hasDigit ? '\u2713' : '\u2717'} One number
              </div>
              <div className={`rule ${strength.hasSpecial ? 'met' : ''}`}>
                {strength.hasSpecial ? '\u2713' : '\u2717'} One special character
              </div>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm Password *</label>
            <div className="password-wrapper">
              <input
                id="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                placeholder="Re-enter your new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onBlur={() => handleBlur('confirmPassword')}
                aria-invalid={!!errors.confirmPassword}
                aria-describedby={errors.confirmPassword ? 'confirmPassword-error' : undefined}
                disabled={isSubmitting}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showConfirmPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {errors.confirmPassword && (
              <span id="confirmPassword-error" className="field-error" role="alert">
                {errors.confirmPassword}
              </span>
            )}
          </div>

          <button
            type="submit"
            className="btn-submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>

        <p className="auth-footer">
          <Link href="/login">Back to Sign In</Link>
        </p>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
