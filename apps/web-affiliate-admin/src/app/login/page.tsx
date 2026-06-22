'use client';

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { validateOtp } from '@/lib/validators';
import { adminAuthService } from '@/services/admin-mfa.service';

/**
 * Affiliate-admin login. Reuses the existing /api/v1/admin/auth/login
 * endpoint — this panel is for SportsMart admins who happen to be
 * managing affiliates. No separate "affiliate admin" identity; the
 * AdminAuthGuard on /admin/affiliates/* enforces access.
 *
 * MFA (2026-06-08): when login returns mfaRequired: true, the form swaps
 * to a challenge step. The admin enters their authenticator/backup code
 * (/admin/auth/mfa-verify) OR taps "Email me a code"
 * (/admin/auth/mfa-email/request then /admin/auth/mfa-email/verify).
 */

interface MfaState {
  challengeToken: string;
  email: string;
  expiresAt: number;
}

// The session shape returned by login / mfa verify. Token storage stays on
// the single-token `adminToken` convention this app already uses (AppShell
// reads it). Accept `token` and `accessToken` for forward/backward compat.
function extractToken(data: any): string | null {
  return data?.token || data?.accessToken || null;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // MFA challenge state — set after a correct password if MFA is enrolled.
  const [mfa, setMfa] = useState<MfaState | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  // emailMode=true once the admin requested a code by email; the verify
  // then targets the email-OTP endpoint instead of the TOTP one.
  const [emailMode, setEmailMode] = useState(false);
  const [emailRequesting, setEmailRequesting] = useState(false);
  const [emailInfo, setEmailInfo] = useState('');
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

  useEffect(() => {
    // Email-first MFA: auto-email the code as soon as the challenge appears so
    // no authenticator app is needed. The authenticator path stays in the
    // backend; this just stops surfacing it at login.
    if (mfa && !emailMode && !emailInfo && !emailRequesting) {
      void handleRequestEmailOtp();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mfa]);

  const completeLogin = (data: any) => {
    const token = extractToken(data);
    if (!token) {
      setError('Login response missing token. Check API version.');
      return;
    }
    sessionStorage.setItem('adminToken', token);
    sessionStorage.setItem('adminProfile', JSON.stringify(data.admin || {}));
    router.push('/dashboard');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const apiBase =
        process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
      const res = await fetch(`${apiBase}/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // portalType lets the API reject a non-affiliate portal-specific admin
        // role signing in here; SUPER_ADMIN + generic roles pass through.
        body: JSON.stringify({ email, password, portalType: 'AFFILIATE' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.message || 'Invalid email or password');
        return;
      }
      const data = body?.data ?? {};
      // MFA enrolled — stop here and switch to the challenge step.
      if (data.mfaRequired === true && data.challengeToken) {
        setMfa({
          challengeToken: data.challengeToken,
          email: data.admin?.email ?? email,
          expiresAt: Date.now() + (data.challengeExpiresIn ?? 300) * 1000,
        });
        setPassword('');
        setEmailMode(false);
        setEmailInfo('');
        setMfaCode('');
        return;
      }
      // The admin auth controller returns { data: { token, ... } }
      // — same shape every other admin panel uses.
      completeLogin(data);
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!mfa) return;
    const code = mfaCode.replace(/\s+/g, '');
    if (emailMode) {
      // Email OTP is a pure 6-digit code.
      if (validateOtp(code) !== null) {
        setError('Enter the 6-digit code from your email.');
        return;
      }
    } else if (validateOtp(code) !== null && !/^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/.test(code)) {
      setError('Enter the 6-digit code or a backup code (xxxxx-xxxxx).');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const data = await (emailMode
        ? adminAuthService.verifyMfaEmailOtp({
            challengeToken: mfa.challengeToken,
            code,
          })
        : adminAuthService.verifyMfaChallenge({
            challengeToken: mfa.challengeToken,
            code,
          }));
      completeLogin(data);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          // Challenge expired — drop back to the password form.
          setError(
            err.message ||
              'Your sign-in challenge expired. Please enter your password again.',
          );
          setMfa(null);
          setMfaCode('');
          setEmailMode(false);
          setEmailInfo('');
        } else {
          setError(err.message || 'Invalid code, please try again.');
          setMfaCode('');
        }
      } else {
        setError('Verification failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Email-OTP: ask the API to email a 6-digit code, then switch the form
  // into email-verify mode (the same code box, but submit targets the
  // email-OTP endpoint).
  const handleRequestEmailOtp = async () => {
    if (!mfa) return;
    setError('');
    setEmailRequesting(true);
    try {
      await adminAuthService.requestMfaEmailOtp(mfa.challengeToken);
      setEmailMode(true);
      setMfaCode('');
      setEmailInfo(`We emailed a 6-digit code to ${mfa.email}. Enter it below.`);
      if (mfaInputRef.current) mfaInputRef.current.focus();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError(
          err.message ||
            'Your sign-in challenge expired. Please enter your password again.',
        );
        setMfa(null);
        setMfaCode('');
        setEmailMode(false);
        setEmailInfo('');
      } else {
        setError(
          (err instanceof ApiError && err.message) ||
            'Could not send the email code. Please try again.',
        );
      }
    } finally {
      setEmailRequesting(false);
    }
  };

  const mfaSecondsLeft = mfa
    ? Math.max(0, Math.floor((mfa.expiresAt - Date.now()) / 1000))
    : 0;
  const mfaExpired = mfa !== null && mfaSecondsLeft <= 0;

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <form
        onSubmit={mfa ? handleMfaSubmit : handleSubmit}
        style={{
          width: '100%',
          maxWidth: 400,
          background: '#fff',
          padding: 32,
          borderRadius: 12,
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/SportsMart_Web_Banner.avif"
          alt="SportsMart"
          style={{ height: 48, width: 'auto', display: 'block', margin: '0 auto 16px' }}
        />
        <span
          style={{
            display: 'inline-block',
            padding: '3px 10px',
            background: '#dbeafe',
            color: '#1d4ed8',
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
            marginBottom: 12,
          }}
        >
          Affiliate Admin
        </span>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.3px' }}>
          {mfa ? 'Verify your identity' : 'Admin sign in'}
        </h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 24px' }}>
          {mfa
            ? emailMode
              ? 'Enter the 6-digit code we emailed you.'
              : 'Enter the code from your authenticator app — or get one by email.'
            : 'Use your SportsMart admin credentials.'}
        </p>

        {error && (
          <div role="alert" style={{
            padding: '10px 12px',
            marginBottom: 16,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 8,
            fontSize: 12,
            color: '#991b1b',
          }}>
            {error}
          </div>
        )}

        {mfa ? (
          <>
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: '10px 12px',
                fontSize: 13,
                color: '#334155',
                marginBottom: 16,
              }}
            >
              Signed in as <strong>{mfa.email}</strong>.
              {!mfaExpired && (
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
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
                  Challenge expired — use a different account to sign in again.
                </div>
              )}
            </div>

            {emailMode && emailInfo && (
              <div
                role="status"
                style={{
                  background: '#ecfdf5',
                  border: '1px solid #a7f3d0',
                  color: '#065f46',
                  borderRadius: 8,
                  padding: '10px 12px',
                  fontSize: 13,
                  marginBottom: 16,
                }}
              >
                {emailInfo}
              </div>
            )}

            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
              {emailMode ? 'Email code' : 'Verification code'}
            </label>
            <input
              id="mfa-code"
              ref={mfaInputRef}
              type="text"
              inputMode="text"
              autoComplete="one-time-code"
              value={mfaCode}
              onChange={(e) =>
                setMfaCode(
                  emailMode
                    ? e.target.value.replace(/[^0-9]/g, '').slice(0, 6)
                    : e.target.value
                        .toUpperCase()
                        .replace(/[^0-9A-Z-]/g, '')
                        .slice(0, 11),
                )
              }
              placeholder={emailMode ? '123456' : '123456 or XXXXX-XXXXX'}
              disabled={loading || mfaExpired}
              style={{
                ...inputStyle,
                fontFamily: 'ui-monospace, monospace',
                letterSpacing: '0.15em',
                fontSize: 18,
                textAlign: 'center',
              }}
            />

            <button
              type="submit"
              disabled={loading || mfaExpired || mfaCode.length < 6}
              style={{
                width: '100%',
                marginTop: 20,
                padding: '11px 16px',
                background: loading || mfaExpired || mfaCode.length < 6 ? '#475569' : '#0f172a',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontWeight: 600,
                fontSize: 14,
                cursor: loading || mfaExpired || mfaCode.length < 6 ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Verifying…' : 'Verify and sign in'}
            </button>

            <div
              style={{
                display: 'flex',
                gap: 16,
                justifyContent: 'center',
                flexWrap: 'wrap',
                marginTop: 14,
              }}
            >
              {!emailMode ? (
                <button
                  type="button"
                  onClick={handleRequestEmailOtp}
                  disabled={emailRequesting || mfaExpired}
                  style={linkBtnStyle(emailRequesting || mfaExpired)}
                >
                  {emailRequesting ? 'Sending code…' : 'Email me a code instead'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleRequestEmailOtp}
                    disabled={emailRequesting || mfaExpired}
                    style={linkBtnStyle(emailRequesting || mfaExpired)}
                  >
                    {emailRequesting ? 'Sending…' : 'Resend code'}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  setMfa(null);
                  setMfaCode('');
                  setError('');
                  setEmailMode(false);
                  setEmailInfo('');
                }}
                style={linkBtnStyle(false)}
              >
                Use a different account
              </button>
            </div>
          </>
        ) : (
          <>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
              Email
            </label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              style={inputStyle}
            />

            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', margin: '14px 0 6px' }}>
              Password
            </label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              style={inputStyle}
            />

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                marginTop: 20,
                padding: '11px 16px',
                background: loading ? '#475569' : '#0f172a',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontWeight: 600,
                fontSize: 14,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </>
        )}
      </form>
    </main>
  );
}

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  fontSize: 14,
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box' as const,
};

function linkBtnStyle(disabled: boolean): CSSProperties {
  return {
    background: 'none',
    border: 'none',
    fontSize: 13,
    color: '#2563eb',
    cursor: disabled ? 'default' : 'pointer',
    textDecoration: 'underline',
    padding: 0,
  };
}
