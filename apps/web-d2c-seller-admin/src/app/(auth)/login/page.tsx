'use client';

import { useState, FormEvent, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { adminAuthService, isMfaChallenge } from '@/services/admin-auth.service';
import {
  verifyMfaChallenge,
  requestMfaEmailOtp,
  verifyMfaEmailOtp,
} from '@/services/admin-mfa.service';
import { ApiError } from '@/lib/api-client';
import './login.css';

interface FormErrors {
  email?: string;
  password?: string;
}

interface MfaState {
  challengeToken: string;
  email: string;
  expiresAt: number;
}

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState('');
  const [serverErrorType, setServerErrorType] = useState<'error' | 'warning' | 'info'>('error');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Phase 10 (PR 10.6) — MFA challenge state. When the password
  // succeeds but the admin has MFA enrolled, the server returns a
  // short-lived challengeToken instead of a session. We swap into
  // a TOTP-only view; the email/password fields stay mounted but
  // hidden so a "Use a different account" reset works smoothly.
  const [mfa, setMfa] = useState<MfaState | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaSubmitting, setMfaSubmitting] = useState(false);
  // Email-OTP alternative to the authenticator. emailMode=true once the
  // admin has requested a code by email; the verify then targets the
  // email-OTP endpoint instead of the TOTP one.
  const [emailMode, setEmailMode] = useState(false);
  const [emailRequesting, setEmailRequesting] = useState(false);
  const [emailInfo, setEmailInfo] = useState('');
  // Force-render the countdown once a second.
  const [, setTick] = useState(0);
  const mfaInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!mfa) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [mfa]);

  useEffect(() => {
    if (mfa && mfaInputRef.current) {
      mfaInputRef.current.focus();
    }
  }, [mfa]);

  // MFA email OTP is sent ONLY when the admin clicks "Email me a code instead"
  // (handleRequestEmailOtp). The authenticator code is the default; email is an
  // on-demand fallback. Auto-send-on-challenge was removed (2026-06-22) so a
  // code goes out only on an explicit user action.

  const validate = (): boolean => {
    const newErrors: FormErrors = {};
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      newErrors.email = 'Enter a valid email address';
    }
    if (!password) {
      newErrors.password = 'Password is required';
    } else if (password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError('');

    if (!validate()) return;

    setIsSubmitting(true);

    try {
      const result = await adminAuthService.login({
        email: email.trim().toLowerCase(),
        password,
      });

      if (result.data) {
        // Phase 10 (PR 10.6) — branch on the discriminated union.
        // mfaRequired === true means the admin has MFA enrolled and
        // the password was correct, but we still need the second
        // factor before issuing a session.
        if (isMfaChallenge(result.data)) {
          setMfa({
            challengeToken: result.data.challengeToken,
            email: result.data.admin.email,
            expiresAt:
              Date.now() + (result.data.challengeExpiresIn ?? 300) * 1000,
          });
          setPassword('');
          setIsSubmitting(false);
          return;
        }
        try {
          sessionStorage.setItem('adminAccessToken', result.data.accessToken);
          sessionStorage.setItem('adminRefreshToken', result.data.refreshToken);
          sessionStorage.setItem('admin', JSON.stringify(result.data.admin));
        } catch {
          // Storage unavailable
        }
        router.push('/dashboard');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setServerErrorType('error');
          const msg = err.body.message || 'Invalid credentials';
          setServerError(typeof msg === 'string' ? msg : String(msg));
          setPassword('');
        } else if (err.status === 403) {
          setServerErrorType('info');
          setServerError(err.body.message || 'Account is not active');
        } else {
          setServerErrorType('error');
          setServerError('Something went wrong. Please try again.');
        }
      } else {
        setServerErrorType('error');
        setServerError('Something went wrong. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMfaSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!mfa) return;
    const code = mfaCode.replace(/\s+/g, '');
    if (emailMode) {
      if (!/^[0-9]{6}$/.test(code)) {
        setServerError('Enter the 6-digit code from your email.');
        setServerErrorType('error');
        return;
      }
    } else if (!/^[0-9]{6}$/.test(code) && !/^[A-Z0-9-]{8,16}$/i.test(code)) {
      setServerError('Enter the 6-digit code or a backup code.');
      setServerErrorType('error');
      return;
    }
    setServerError('');
    setMfaSubmitting(true);
    try {
      const result = await (emailMode
        ? verifyMfaEmailOtp({
            challengeToken: mfa.challengeToken,
            code,
          })
        : verifyMfaChallenge({
            challengeToken: mfa.challengeToken,
            code,
          }));
      if (result.data) {
        try {
          sessionStorage.setItem('adminAccessToken', result.data.accessToken);
          sessionStorage.setItem('adminRefreshToken', result.data.refreshToken);
          sessionStorage.setItem('admin', JSON.stringify(result.data.admin));
        } catch {
          // Storage unavailable
        }
        router.push('/dashboard');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 400) {
          setServerErrorType('error');
          setServerError(err.body?.message || 'Invalid code, please try again.');
          setMfaCode('');
        } else if (err.status === 403) {
          setServerErrorType('info');
          setServerError(
            err.body?.message ||
              'Your sign-in challenge expired. Please enter your password again.',
          );
          setMfa(null);
          setMfaCode('');
          setEmailMode(false);
          setEmailInfo('');
        } else {
          setServerErrorType('error');
          setServerError('Something went wrong. Please try again.');
        }
      } else {
        setServerErrorType('error');
        setServerError('Something went wrong. Please try again.');
      }
    } finally {
      setMfaSubmitting(false);
    }
  };

  // Email-OTP: ask the API to email a 6-digit code, then switch the
  // form into email-verify mode (the same code box, but submit targets
  // the email-OTP endpoint).
  const handleRequestEmailOtp = async () => {
    if (!mfa) return;
    setServerError('');
    setEmailRequesting(true);
    try {
      await requestMfaEmailOtp(mfa.challengeToken);
      setEmailMode(true);
      setMfaCode('');
      setEmailInfo(`We emailed a 6-digit code to ${mfa.email}. Enter it below.`);
      if (mfaInputRef.current) mfaInputRef.current.focus();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setServerErrorType('info');
          setServerError(
            err.body?.message ||
              'Your sign-in challenge expired. Please enter your password again.',
          );
          setMfa(null);
          setMfaCode('');
          setEmailMode(false);
          setEmailInfo('');
        } else {
          setServerErrorType('error');
          setServerError(
            err.body?.message ||
              'Could not send the email code. Please try again.',
          );
        }
      } else {
        setServerErrorType('error');
        setServerError('Could not send the email code. Please try again.');
      }
    } finally {
      setEmailRequesting(false);
    }
  };

  const handleUseDifferentAccount = () => {
    setMfa(null);
    setMfaCode('');
    setServerError('');
    setPassword('');
    setEmailMode(false);
    setEmailInfo('');
  };

  const alertClass =
    serverErrorType === 'warning'
      ? 'alert alert-warning'
      : serverErrorType === 'info'
        ? 'alert alert-info'
        : 'alert alert-error';

  const mfaSecondsLeft = mfa
    ? Math.max(0, Math.floor((mfa.expiresAt - Date.now()) / 1000))
    : 0;
  const mfaExpired = mfa !== null && mfaSecondsLeft <= 0;

  return (
    <div className="auth-page">
      <div className="auth-card">
        <header className="auth-header">
          <span className="auth-badge">
            <span className="auth-badge-dot" aria-hidden="true" />
            D2C Seller Admin
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/SportsMart_Web_Banner.avif"
            alt="SportsMart"
            className="auth-logo"
            style={{ height: 56, width: 'auto', display: 'block' }}
          />
          <h2 className="auth-title">Sign in to manage your storefront.</h2>
        </header>

        {serverError && (
          <div className={alertClass} role="alert">
            {serverError}
          </div>
        )}

        {mfa ? (
          <form onSubmit={handleMfaSubmit} noValidate>
            <div
              style={{
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: '12px 14px',
                marginBottom: 16,
                fontSize: 13,
                color: '#374151',
              }}
            >
              Signed in as <strong>{mfa.email}</strong>.{' '}
              {emailMode
                ? 'Enter the 6-digit code we emailed you to continue.'
                : 'Enter the 6-digit code from your authenticator app, or a backup code, to continue.'}
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
                  Challenge expired. Use the link below to sign in again.
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

            <div className="form-group">
              <label htmlFor="mfa-code">
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
                          .slice(0, 16),
                  )
                }
                placeholder={emailMode ? '123456' : '123456 or XXXXX-XXXXX'}
                disabled={mfaSubmitting || mfaExpired}
                style={{
                  fontFamily: 'ui-monospace, monospace',
                  letterSpacing: '0.15em',
                  fontSize: 18,
                  textAlign: 'center',
                }}
              />
            </div>

            <button
              type="submit"
              className="btn-submit"
              disabled={mfaSubmitting || mfaExpired || mfaCode.length < 6}
              aria-busy={mfaSubmitting}
            >
              {mfaSubmitting ? (
                <>
                  <span className="btn-spinner" aria-hidden="true" />
                  Verifying
                </>
              ) : (
                'Verify and sign in'
              )}
            </button>

            {!emailMode ? (
              <div style={{ marginTop: 14, textAlign: 'center' }}>
                <button
                  type="button"
                  onClick={handleRequestEmailOtp}
                  disabled={emailRequesting || mfaExpired}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: 13,
                    color: '#2563eb',
                    cursor:
                      emailRequesting || mfaExpired ? 'default' : 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  {emailRequesting
                    ? 'Sending code…'
                    : 'Email me a code instead'}
                </button>
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  gap: 16,
                  justifyContent: 'center',
                  marginTop: 14,
                }}
              >
                <button
                  type="button"
                  onClick={handleRequestEmailOtp}
                  disabled={emailRequesting || mfaExpired}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: 13,
                    color: '#2563eb',
                    cursor:
                      emailRequesting || mfaExpired ? 'default' : 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  {emailRequesting ? 'Sending…' : 'Resend code'}
                </button>
              </div>
            )}

            <div style={{ marginTop: 14, textAlign: 'center' }}>
              <button
                type="button"
                onClick={handleUseDifferentAccount}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: 13,
                  color: '#2563eb',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Use a different account
              </button>
            </div>
          </form>
        ) : (
        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              placeholder="Enter your admin email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'email-error' : undefined}
              disabled={isSubmitting}
              autoComplete="username"
              autoFocus
            />
            {errors.email && (
              <span id="email-error" className="field-error" role="alert">
                {errors.email}
              </span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <div className="password-wrapper">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!errors.password}
                aria-describedby={errors.password ? 'password-error' : undefined}
                disabled={isSubmitting}
                autoComplete="current-password"
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
            {errors.password && (
              <span id="password-error" className="field-error" role="alert">
                {errors.password}
              </span>
            )}
          </div>

          <button
            type="submit"
            className="btn-submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <span className="btn-spinner" aria-hidden="true" />
                Signing in
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </form>
        )}

        <p className="auth-footer">
          Admin access only. Contact your administrator for credentials.
        </p>
      </div>
    </div>
  );
}
