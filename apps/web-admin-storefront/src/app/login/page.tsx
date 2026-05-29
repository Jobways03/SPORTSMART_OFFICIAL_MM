'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  adminAuthService,
  isMfaChallenge,
} from '@/services/admin-auth.service';
import { ApiError } from '@/lib/api-client';
import './login.css';

interface MfaState {
  challengeToken: string;
  email: string;
  expiresAt: number;
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Phase 26 (2026-05-20) — surfaced when the reset-password flow
  // bounces back to /login?reset=success. Cleared on dismiss.
  const [resetSuccess, setResetSuccess] = useState(
    params.get('reset') === 'success',
  );
  // Phase 10 (PR 10.6) — MFA challenge state. Set after a successful
  // password if the admin has MFA enrolled.
  const [mfa, setMfa] = useState<MfaState | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [, setTick] = useState(0);
  const mfaInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!mfa) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [mfa]);

  useEffect(() => {
    if (mfa && mfaInputRef.current) mfaInputRef.current.focus();
  }, [mfa]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await adminAuthService.login(email, password);
      if (res.data) {
        if (isMfaChallenge(res.data)) {
          setMfa({
            challengeToken: res.data.challengeToken,
            email: res.data.admin.email,
            expiresAt:
              Date.now() + (res.data.challengeExpiresIn ?? 300) * 1000,
          });
          setPassword('');
          return;
        }
        // Phase 23 (2026-05-20) — tokens are still written to
        // sessionStorage for backward compatibility with the
        // dashboard layout + ~10 service readers that pull
        // adminAccessToken via apiClient/getString. The API ALSO sets
        // sm_access_admin / sm_refresh_admin httpOnly cookies in the
        // same response, so XSS exfiltration of the token from
        // sessionStorage no longer hands an attacker a working
        // session by itself — refresh rotation + AdminAuthGuard's
        // session row check tie the token to a still-alive
        // AdminSession. Removing the sessionStorage writes is a
        // coordinated frontend migration tracked separately; once the
        // dashboard layout switches to /admin/auth/me probe + the
        // service files read the cookie via credentials:'include',
        // these three lines go away.
        sessionStorage.setItem('adminAccessToken', res.data.accessToken);
        sessionStorage.setItem('adminRefreshToken', res.data.refreshToken);
        sessionStorage.setItem('admin', JSON.stringify(res.data.admin));
        router.replace('/dashboard');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfa) return;
    const code = mfaCode.replace(/\s+/g, '');
    if (!/^[0-9]{6}$/.test(code) && !/^[A-Z0-9-]{8,16}$/i.test(code)) {
      setError('Enter the 6-digit code or a backup code.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await adminAuthService.verifyMfaChallenge({
        challengeToken: mfa.challengeToken,
        code,
      });
      if (res.data) {
        // Phase 23 (2026-05-20) — tokens are still written to
        // sessionStorage for backward compatibility with the
        // dashboard layout + ~10 service readers that pull
        // adminAccessToken via apiClient/getString. The API ALSO sets
        // sm_access_admin / sm_refresh_admin httpOnly cookies in the
        // same response, so XSS exfiltration of the token from
        // sessionStorage no longer hands an attacker a working
        // session by itself — refresh rotation + AdminAuthGuard's
        // session row check tie the token to a still-alive
        // AdminSession. Removing the sessionStorage writes is a
        // coordinated frontend migration tracked separately; once the
        // dashboard layout switches to /admin/auth/me probe + the
        // service files read the cookie via credentials:'include',
        // these three lines go away.
        sessionStorage.setItem('adminAccessToken', res.data.accessToken);
        sessionStorage.setItem('adminRefreshToken', res.data.refreshToken);
        sessionStorage.setItem('admin', JSON.stringify(res.data.admin));
        router.replace('/dashboard');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          // Challenge expired — drop back to the password form.
          setError(
            err.body?.message ||
              'Your sign-in challenge expired. Please enter your password again.',
          );
          setMfa(null);
          setMfaCode('');
        } else {
          setError(err.body?.message || 'Invalid code, please try again.');
          setMfaCode('');
        }
      } else {
        setError('Verification failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const mfaSecondsLeft = mfa
    ? Math.max(0, Math.floor((mfa.expiresAt - Date.now()) / 1000))
    : 0;
  const mfaExpired = mfa !== null && mfaSecondsLeft <= 0;

  return (
    <div className="login-page">
      <main className="login-card" aria-labelledby="login-title">
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
          <p className="login-subtitle" id="login-title">
            {mfa
              ? 'Enter the code from your authenticator app to continue.'
              : 'Sign in to the marketplace control center.'}
          </p>
        </header>

        {resetSuccess && !mfa && (
          <div
            role="status"
            style={{
              background: '#ecfdf5',
              border: '1px solid #a7f3d0',
              color: '#065f46',
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 13,
              marginBottom: 12,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <span>
              Password reset. Sign in below with your new password — every
              previous admin session has been signed out.
            </span>
            <button
              type="button"
              onClick={() => setResetSuccess(false)}
              aria-label="Dismiss"
              style={{
                background: 'none',
                border: 'none',
                color: '#065f46',
                fontSize: 14,
                cursor: 'pointer',
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        )}

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

        {mfa ? (
          <form className="login-form" onSubmit={handleMfaSubmit} noValidate>
            <div
              style={{
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: '10px 12px',
                fontSize: 13,
                color: '#374151',
              }}
            >
              Signed in as <strong>{mfa.email}</strong>.
              {!mfaExpired && (
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                  Challenge expires in{' '}
                  <strong>
                    {Math.floor(mfaSecondsLeft / 60)}:
                    {String(mfaSecondsLeft % 60).padStart(2, '0')}
                  </strong>
                </div>
              )}
              {mfaExpired && (
                <div
                  style={{
                    fontSize: 12,
                    color: '#991b1b',
                    marginTop: 4,
                    fontWeight: 600,
                  }}
                >
                  Challenge expired — use the link below to sign in again.
                </div>
              )}
            </div>

            <div className="login-field">
              <label htmlFor="mfa-code">Verification code</label>
              <input
                id="mfa-code"
                ref={mfaInputRef}
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                value={mfaCode}
                onChange={(e) =>
                  setMfaCode(
                    e.target.value
                      .toUpperCase()
                      .replace(/[^0-9A-Z-]/g, '')
                      .slice(0, 16),
                  )
                }
                placeholder="123456 or XXXXX-XXXXX"
                disabled={loading || mfaExpired}
                style={{
                  fontFamily: 'ui-monospace, monospace',
                  letterSpacing: '0.15em',
                  fontSize: 18,
                  textAlign: 'center',
                }}
              />
            </div>

            <button
              className="login-btn"
              type="submit"
              disabled={loading || mfaExpired || mfaCode.length < 6}
            >
              {loading ? (
                <>
                  <span className="login-spinner" aria-hidden="true" />
                  Verifying
                </>
              ) : (
                'Verify and sign in'
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setMfa(null);
                setMfaCode('');
                setError('');
              }}
              style={{
                background: 'none',
                border: 'none',
                fontSize: 13,
                color: '#2563eb',
                cursor: 'pointer',
                textDecoration: 'underline',
                marginTop: 6,
                alignSelf: 'center',
              }}
            >
              Use a different account
            </button>
          </form>
        ) : (
          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <div className="login-field">
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
                type="email"
                autoComplete="username"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@sportsmart.com"
                required
              />
            </div>

            <div className="login-field">
              <label htmlFor="login-password">Password</label>
              <div className="login-input-wrap">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                />
                <button
                  type="button"
                  className="login-input-toggle"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <button className="login-btn" type="submit" disabled={loading}>
              {loading ? (
                <>
                  <span className="login-spinner" aria-hidden="true" />
                  Signing in
                </>
              ) : (
                'Sign in'
              )}
            </button>

            <Link
              href="/forgot-password"
              style={{
                alignSelf: 'center',
                marginTop: 8,
                fontSize: 13,
                color: '#2563eb',
                textDecoration: 'underline',
              }}
            >
              Forgot password?
            </Link>
          </form>
        )}

        <p className="login-footnote">
          Restricted access. All sign-ins are logged for audit.
        </p>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
