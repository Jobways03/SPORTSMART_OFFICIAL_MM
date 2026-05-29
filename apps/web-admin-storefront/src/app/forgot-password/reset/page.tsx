'use client';

import { FormEvent, Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { adminAuthService } from '@/services/admin-auth.service';
import { ApiError } from '@/lib/api-client';
import '../../login/login.css';

/**
 * Phase 26 (2026-05-20) — Admin password recovery, step 3.
 *
 * Validates the new password client-side against the same policy the
 * backend AdminResetPasswordDto enforces (12+ chars, lowercase,
 * uppercase, digit, special). Calls /admin/auth/reset-password with
 * the resetToken stashed from step 2.
 *
 * The backend reset use case revokes all admin sessions in the same
 * transaction, so a stolen session token dies on reset.
 */

const POLICY = {
  minLength: 12,
  lower: /(?=.*[a-z])/,
  upper: /(?=.*[A-Z])/,
  digit: /(?=.*\d)/,
  // eslint-disable-next-line no-useless-escape
  special: /(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/,
};

function policyErrors(pwd: string): string[] {
  const errs: string[] = [];
  if (pwd.length < POLICY.minLength)
    errs.push(`At least ${POLICY.minLength} characters`);
  if (!POLICY.lower.test(pwd)) errs.push('A lowercase letter');
  if (!POLICY.upper.test(pwd)) errs.push('An uppercase letter');
  if (!POLICY.digit.test(pwd)) errs.push('A number');
  if (!POLICY.special.test(pwd)) errs.push('A special character');
  return errs;
}

function ResetInner() {
  const router = useRouter();
  const params = useSearchParams();
  const tokenFromUrl = params.get('token') ?? '';

  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Prefer sessionStorage (stashed at verify step), fall back to URL.
  useEffect(() => {
    let token = '';
    try {
      token = sessionStorage.getItem('adminResetToken') ?? '';
    } catch {
      // ignore — fall back to URL
    }
    setResetToken(token || tokenFromUrl);
    if (!token && !tokenFromUrl) {
      router.replace('/forgot-password');
    }
  }, [tokenFromUrl, router]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!resetToken) {
      setError(
        'Reset session missing or expired. Restart the recovery flow.',
      );
      return;
    }
    const errs = policyErrors(newPassword);
    if (errs.length > 0) {
      setError(`Password must include: ${errs.join(', ')}`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await adminAuthService.resetPassword(resetToken, newPassword);
      try {
        sessionStorage.removeItem('adminResetToken');
        sessionStorage.removeItem('adminResetEmail');
      } catch {
        // ignore
      }
      router.replace('/login?reset=success');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not reset password. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  const checklist = policyErrors(newPassword);

  return (
    <div className="login-page">
      <main className="login-card" aria-labelledby="reset-title">
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
          <p className="login-subtitle" id="reset-title">
            Set a new password for your admin account.
          </p>
        </header>

        {error && (
          <div className="login-error" role="alert">
            <span>{error}</span>
          </div>
        )}

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="login-field">
            <label htmlFor="reset-newpwd">New password</label>
            <div className="login-input-wrap">
              <input
                id="reset-newpwd"
                type={showPwd ? 'text' : 'password'}
                autoComplete="new-password"
                autoFocus
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                required
                disabled={loading}
              />
              <button
                type="button"
                className="login-input-toggle"
                onClick={() => setShowPwd((s) => !s)}
                aria-label={showPwd ? 'Hide password' : 'Show password'}
                aria-pressed={showPwd}
              >
                {showPwd ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div className="login-field">
            <label htmlFor="reset-confirm">Confirm new password</label>
            <input
              id="reset-confirm"
              type={showPwd ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
              required
              disabled={loading}
            />
          </div>

          {newPassword.length > 0 && checklist.length > 0 && (
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: '6px 10px',
                background: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: 8,
                fontSize: 12,
                color: '#92400e',
                lineHeight: 1.55,
              }}
            >
              {checklist.map((c) => (
                <li key={c}>• {c}</li>
              ))}
            </ul>
          )}

          <button
            className="login-btn"
            type="submit"
            disabled={loading || checklist.length > 0 || !confirmPassword}
          >
            {loading ? (
              <>
                <span className="login-spinner" aria-hidden="true" />
                Resetting
              </>
            ) : (
              'Reset password'
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
          Resetting your password will sign out every active admin session
          for your account. You will need to sign in again with the new
          password.
        </p>
      </main>
    </div>
  );
}

export default function AdminForgotPasswordResetPage() {
  return (
    <Suspense fallback={null}>
      <ResetInner />
    </Suspense>
  );
}
