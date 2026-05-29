'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { adminAuthService } from '@/services/admin-auth.service';
import { ApiError } from '@/lib/api-client';
import '../login/login.css';

/**
 * Phase 26 (2026-05-20) — Admin password recovery, step 1.
 *
 * The /admin/auth/forgot-password endpoint has existed since Phase 23
 * but there was no UI consumer. Mirrors the customer / seller flow:
 *
 *   1. Admin enters email → POST /admin/auth/forgot-password
 *   2. Backend always returns success (enumeration-safe). UI navigates
 *      to /forgot-password/verify with the email pre-filled.
 *   3. Verify page collects the 6-digit OTP → resetToken in session.
 *   4. Reset page sets the new password.
 *
 * Captcha token: passed as undefined for now. The backend captcha
 * verifier short-circuits when CAPTCHA_PROVIDER=disabled, and the
 * admin login form itself didn't have a captcha widget until Phase 23
 * either — wiring a real captcha component is tracked separately.
 */
export default function AdminForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError('Enter your admin email address.');
      return;
    }
    setLoading(true);
    try {
      await adminAuthService.forgotPassword(trimmed);
      // The backend always succeeds; navigate forward with the email
      // in the URL so the verify page can show "code sent to X".
      router.push(
        `/forgot-password/verify?email=${encodeURIComponent(trimmed)}`,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Too many requests. Please wait a moment and try again.');
      } else {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Could not start password recovery. Please try again.',
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <main className="login-card" aria-labelledby="forgot-title">
        <header className="login-header">
          <span className="login-role">
            <span className="login-role-dot" aria-hidden="true" />
            Super Admin
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/SportsMart_Web_Banner.avif"
            alt="SportsMart"
            className="login-brand"
            style={{ height: 56, width: 'auto', display: 'block' }}
          />
          <p className="login-subtitle" id="forgot-title">
            Enter your admin email to receive a reset code.
          </p>
        </header>

        {error && (
          <div className="login-error" role="alert">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path
                d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 4.5a.9.9 0 01.9.9v3.6a.9.9 0 11-1.8 0V7.4a.9.9 0 01.9-.9zm0 8.4a1.05 1.05 0 110-2.1 1.05 1.05 0 010 2.1z"
                fill="currentColor"
              />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="login-field">
            <label htmlFor="forgot-email">Email</label>
            <input
              id="forgot-email"
              type="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@sportsmart.com"
              required
              disabled={loading}
            />
          </div>

          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? (
              <>
                <span className="login-spinner" aria-hidden="true" />
                Sending
              </>
            ) : (
              'Send reset code'
            )}
          </button>

          <Link
            href="/login"
            style={{
              alignSelf: 'center',
              marginTop: 8,
              fontSize: 13,
              color: '#2563eb',
              textDecoration: 'underline',
            }}
          >
            Back to sign in
          </Link>
        </form>

        <p className="login-footnote">
          A reset code is sent only if an admin account exists for that
          email. Codes expire after 10 minutes.
        </p>
      </main>
    </div>
  );
}
