'use client';

import { useState, useEffect, FormEvent } from 'react';
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

export default function FranchiseAdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState('');
  const [serverErrorType, setServerErrorType] = useState<'error' | 'warning' | 'info'>('error');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // MFA challenge step — shown when an MFA-enrolled admin signs in.
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState('');
  // Email-OTP alternative to the authenticator on the MFA challenge step.
  const [emailOtpMode, setEmailOtpMode] = useState(false);
  const [emailOtpSending, setEmailOtpSending] = useState(false);
  const [emailOtpInfo, setEmailOtpInfo] = useState('');

  // Email-first MFA: auto-email the code as soon as the challenge appears so no
  // authenticator app is needed. The authenticator path stays in the backend.
  useEffect(() => {
    if (challengeToken && !emailOtpMode && !emailOtpInfo && !emailOtpSending) {
      void handleRequestEmailOtp();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challengeToken]);

  const persistSession = (data: {
    accessToken: string;
    refreshToken: string;
    admin: unknown;
  }) => {
    try {
      sessionStorage.setItem('adminAccessToken', data.accessToken);
      sessionStorage.setItem('adminRefreshToken', data.refreshToken);
      sessionStorage.setItem('admin', JSON.stringify(data.admin));
    } catch {
      // Storage unavailable
    }
    router.push('/dashboard');
  };

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
        if (isMfaChallenge(result.data)) {
          // MFA-enrolled admin — switch to the 6-digit verification step.
          setChallengeToken(result.data.challengeToken);
          setMfaCode('');
          setMfaError('');
        } else {
          persistSession(result.data);
        }
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

  const handleMfaVerify = async (e: FormEvent) => {
    e.preventDefault();
    if (!challengeToken) return;
    const code = mfaCode.trim();
    if (emailOtpMode) {
      // Emailed login OTP is always a 6-digit code.
      if (!/^\d{6}$/.test(code)) {
        setMfaError('Enter the 6-digit code we emailed you.');
        return;
      }
    } else {
      const isTotp = /^\d{6}$/.test(code);
      const isBackup = /^[A-Za-z0-9]{5}-?[A-Za-z0-9]{5}$/.test(code);
      if (!isTotp && !isBackup) {
        setMfaError('Enter your 6-digit authenticator code (or a backup code).');
        return;
      }
    }
    setIsSubmitting(true);
    setMfaError('');
    try {
      const res = emailOtpMode
        ? await verifyMfaEmailOtp({ challengeToken, code })
        : await verifyMfaChallenge({ challengeToken, code });
      if (res.data) persistSession(res.data);
    } catch (err) {
      if (err instanceof ApiError) {
        const msg = err.body?.message;
        setMfaError(
          (typeof msg === 'string' && msg) ||
            'Invalid or expired code. Please try again.',
        );
      } else {
        setMfaError('Something went wrong. Please try again.');
      }
      setMfaCode('');
    } finally {
      setIsSubmitting(false);
    }
  };

  // "Email me a code" — asks the backend to email a 6-digit login OTP, then
  // flips the challenge step into email-OTP mode so the same input redeems it.
  const handleRequestEmailOtp = async () => {
    if (!challengeToken) return;
    setEmailOtpSending(true);
    setMfaError('');
    setEmailOtpInfo('');
    try {
      await requestMfaEmailOtp(challengeToken);
      setEmailOtpMode(true);
      setMfaCode('');
      setEmailOtpInfo('We emailed you a 6-digit code. Enter it below (valid 5 minutes).');
    } catch (err) {
      if (err instanceof ApiError) {
        const msg = err.body?.message;
        setMfaError(
          (typeof msg === 'string' && msg) ||
            'Could not email a code. Please try again.',
        );
      } else {
        setMfaError('Something went wrong. Please try again.');
      }
    } finally {
      setEmailOtpSending(false);
    }
  };

  const alertClass =
    serverErrorType === 'warning'
      ? 'alert alert-warning'
      : serverErrorType === 'info'
        ? 'alert alert-info'
        : 'alert alert-error';

  return (
    <div className="auth-page">
      <div className="auth-card">
        <header className="auth-header">
          <span className="auth-badge">
            <span className="auth-badge-dot" aria-hidden="true" />
            Franchise Admin
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/SportsMart_Web_Banner.avif"
            alt="SportsMart"
            className="auth-logo"
            style={{ height: 56, width: 'auto', display: 'block', margin: '0 auto' }}
          />
          <h2 className="auth-title">Sign in to manage franchise operations.</h2>
        </header>

        {serverError && (
          <div className={alertClass} role="alert">
            {serverError}
          </div>
        )}

        {!challengeToken && (
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

        {challengeToken && (
          <form onSubmit={handleMfaVerify} noValidate>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
              {emailOtpMode
                ? 'Enter the 6-digit code we emailed you to finish signing in.'
                : 'Two-factor authentication is enabled. Enter the 6-digit code from your authenticator app (or a backup code).'}
            </p>
            <div className="form-group">
              <label htmlFor="mfaCode">
                {emailOtpMode ? 'Emailed code' : 'Authenticator code'}
              </label>
              <input
                id="mfaCode"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                disabled={isSubmitting}
                autoFocus
              />
              {emailOtpInfo && !mfaError && (
                <span
                  className="field-info"
                  style={{ color: '#0b8457', fontSize: 13 }}
                >
                  {emailOtpInfo}
                </span>
              )}
              {mfaError && (
                <span className="field-error" role="alert">
                  {mfaError}
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
                  Verifying
                </>
              ) : (
                'Verify & sign in'
              )}
            </button>
            <button
              type="button"
              onClick={handleRequestEmailOtp}
              disabled={isSubmitting || emailOtpSending}
              style={{
                marginTop: 12,
                background: 'none',
                border: 'none',
                color: '#2563eb',
                cursor: isSubmitting || emailOtpSending ? 'not-allowed' : 'pointer',
                opacity: isSubmitting || emailOtpSending ? 0.6 : 1,
                fontSize: 13,
                fontWeight: 600,
                display: 'block',
              }}
            >
              {emailOtpSending
                ? 'Sending…'
                : emailOtpMode
                  ? 'Resend code to my email'
                  : 'No authenticator? Email me a code'}
            </button>
            <button
              type="button"
              onClick={() => {
                setChallengeToken(null);
                setMfaCode('');
                setMfaError('');
                setPassword('');
                setEmailOtpMode(false);
                setEmailOtpInfo('');
                setEmailOtpSending(false);
              }}
              style={{
                marginTop: 12,
                background: 'none',
                border: 'none',
                color: '#2563eb',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              ← Back to sign in
            </button>
          </form>
        )}

        <p className="auth-footer">
          Franchise admin access only. Contact your administrator for credentials.
        </p>
      </div>
    </div>
  );
}
