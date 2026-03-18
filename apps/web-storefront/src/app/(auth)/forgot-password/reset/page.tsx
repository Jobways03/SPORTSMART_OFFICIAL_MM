'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authService } from '@/services/auth.service';
import { ApiError } from '@/lib/api-client';
import { validatePassword, validateConfirmPassword } from '@/lib/validators';
import '../forgot-password.css';

interface FormErrors {
  newPassword?: string;
  confirmPassword?: string;
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

  if (success) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-header">
            <h1 className="auth-logo">SPORTSMART</h1>
            <h2 className="auth-title">Password Reset</h2>
          </div>
          <div className="alert alert-success" role="status">
            Your password has been reset successfully. You can now sign in with your new password.
          </div>
          <Link href="/login">
            <button className="btn-submit">Go to Sign In</button>
          </Link>
        </div>
      </div>
    );
  }

  if (!resetToken) return null;

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-logo">SPORTSMART</h1>
          <h2 className="auth-title">Set New Password</h2>
          <p className="auth-subtitle">
            Create a strong password for your account.
          </p>
        </div>

        {serverError && (
          <div className="alert alert-error" role="alert">
            {serverError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="newPassword">New Password *</label>
            <div className="password-wrapper">
              <input
                id="newPassword"
                type={showPassword ? 'text' : 'password'}
                placeholder="At least 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                onBlur={() => handleBlur('newPassword')}
                aria-invalid={!!errors.newPassword}
                aria-describedby={errors.newPassword ? 'newPassword-error' : undefined}
                disabled={isSubmitting}
                autoComplete="new-password"
                autoFocus
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {errors.newPassword && (
              <span id="newPassword-error" className="field-error" role="alert">
                {errors.newPassword}
              </span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm Password *</label>
            <div className="password-wrapper">
              <input
                id="confirmPassword"
                type={showPassword ? 'text' : 'password'}
                placeholder="Re-enter your new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onBlur={() => handleBlur('confirmPassword')}
                aria-invalid={!!errors.confirmPassword}
                aria-describedby={errors.confirmPassword ? 'confirmPassword-error' : undefined}
                disabled={isSubmitting}
                autoComplete="new-password"
              />
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
