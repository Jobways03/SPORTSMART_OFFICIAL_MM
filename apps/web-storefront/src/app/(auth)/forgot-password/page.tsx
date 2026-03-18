'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authService } from '@/services/auth.service';
import { ApiError } from '@/lib/api-client';
import { validateLoginEmail } from '@/lib/validators';
import './forgot-password.css';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [serverError, setServerError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleBlur = () => {
    const error = validateLoginEmail(email);
    setEmailError(error || '');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError('');

    const error = validateLoginEmail(email);
    if (error) {
      setEmailError(error);
      return;
    }

    setIsSubmitting(true);

    try {
      const trimmedEmail = email.trim().toLowerCase();
      await authService.forgotPassword(trimmedEmail);

      // Always navigate to verify page — server always returns success
      // to prevent email enumeration
      router.push(`/forgot-password/verify?email=${encodeURIComponent(trimmedEmail)}`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          setServerError('Too many requests. Please try again later.');
        } else if (err.status === 422 && err.body.errors) {
          const emailErr = err.body.errors.find((e) => e.field === 'email');
          if (emailErr) setEmailError(emailErr.message);
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

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-logo">SPORTSMART</h1>
          <h2 className="auth-title">Forgot Password</h2>
          <p className="auth-subtitle">
            Enter your email address and we&apos;ll send you a verification code to reset your password.
          </p>
        </div>

        {serverError && (
          <div className="alert alert-error" role="alert">
            {serverError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="email">Email *</label>
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={handleBlur}
              aria-invalid={!!emailError}
              aria-describedby={emailError ? 'email-error' : undefined}
              disabled={isSubmitting}
              autoComplete="email"
              autoFocus
            />
            {emailError && (
              <span id="email-error" className="field-error" role="alert">
                {emailError}
              </span>
            )}
          </div>

          <button
            type="submit"
            className="btn-submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? 'Sending...' : 'Send Reset Code'}
          </button>
        </form>

        <p className="auth-footer">
          Remember your password? <Link href="/login">Sign In</Link>
        </p>
      </div>
    </div>
  );
}
