'use client';

import { FormEvent, Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { adminAuthService } from '@/services/admin-auth.service';
import { ApiError } from '@/lib/api-client';
import { validateOtp } from '@/lib/validators';
import '../../login/login.css';

/**
 * Phase 26 (2026-05-20) — Admin password recovery, step 2.
 *
 * Collects the 6-digit OTP and exchanges it for a resetToken via
 * /admin/auth/verify-reset-otp. Stores the resetToken in
 * sessionStorage so the reset page can use it; cleared on
 * navigation away. Includes a resend button that calls
 * /admin/auth/resend-reset-otp with the per-account hourly cap
 * enforced server-side.
 */
function VerifyInner() {
  const router = useRouter();
  const params = useSearchParams();
  const emailParam = params.get('email')?.trim().toLowerCase() ?? '';

  const [email, setEmail] = useState(emailParam);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resentMessage, setResentMessage] = useState('');

  // Defensive: if someone deep-linked here without an email, push back
  // to step 1 so the form can be filled in.
  useEffect(() => {
    if (!emailParam) {
      router.replace('/forgot-password');
    }
  }, [emailParam, router]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setResentMessage('');
    const trimmed = code.trim();
    const otpErr = validateOtp(trimmed);
    if (otpErr) {
      setError(otpErr);
      return;
    }
    setLoading(true);
    try {
      const res = await adminAuthService.verifyResetOtp(email, trimmed);
      if (res.data?.resetToken) {
        try {
          sessionStorage.setItem('adminResetToken', res.data.resetToken);
          sessionStorage.setItem('adminResetEmail', email);
        } catch {
          // sessionStorage write failed (private mode, full disk): fall
          // through to URL-based handoff so the reset page can still
          // operate. Less secure (token in URL history) but recoverable.
        }
        router.push(`/forgot-password/reset?token=${encodeURIComponent(res.data.resetToken)}`);
      } else {
        setError('Verification did not return a reset token. Please try again.');
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not verify the code. Please try again.',
      );
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!email) return;
    setError('');
    setResentMessage('');
    setResending(true);
    try {
      await adminAuthService.resendResetOtp(email);
      setResentMessage(
        'If an account exists for that email, a fresh code has been sent.',
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not resend the code. Please try again.',
      );
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="login-page">
      <main className="login-card" aria-labelledby="verify-title">
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
          <p className="login-subtitle" id="verify-title">
            Enter the 6-digit code we sent to <strong>{email}</strong>.
          </p>
        </header>

        {error && (
          <div className="login-error" role="alert">
            <span>{error}</span>
          </div>
        )}
        {resentMessage && (
          <div
            role="status"
            style={{
              background: '#ecfdf5',
              border: '1px solid #a7f3d0',
              color: '#065f46',
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 13,
              marginBottom: 8,
            }}
          >
            {resentMessage}
          </div>
        )}

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="login-field">
            <label htmlFor="verify-code">Verification code</label>
            <input
              id="verify-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
              }
              placeholder="123456"
              disabled={loading}
              style={{
                fontFamily: 'ui-monospace, monospace',
                fontSize: 18,
                letterSpacing: '0.3em',
                textAlign: 'center',
              }}
            />
          </div>

          <button
            className="login-btn"
            type="submit"
            disabled={loading || code.length < 6}
          >
            {loading ? (
              <>
                <span className="login-spinner" aria-hidden="true" />
                Verifying
              </>
            ) : (
              'Verify code'
            )}
          </button>

          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 13,
              color: '#2563eb',
              cursor: resending ? 'not-allowed' : 'pointer',
              textDecoration: 'underline',
              marginTop: 6,
              alignSelf: 'center',
            }}
          >
            {resending ? 'Resending…' : 'Resend code'}
          </button>

          <Link
            href="/forgot-password"
            style={{
              alignSelf: 'center',
              marginTop: 4,
              fontSize: 13,
              color: '#6b7280',
            }}
          >
            Use a different email
          </Link>
        </form>

        <p className="login-footnote">
          Codes expire after 10 minutes. You can resend up to 5 times per hour.
        </p>
      </main>
    </div>
  );
}

export default function AdminForgotPasswordVerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyInner />
    </Suspense>
  );
}
