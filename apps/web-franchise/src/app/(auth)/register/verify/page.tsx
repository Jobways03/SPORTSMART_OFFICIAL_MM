'use client';

import {
  Suspense,
  useState,
  useRef,
  useEffect,
  useCallback,
  FormEvent,
  KeyboardEvent,
  ClipboardEvent,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { franchiseAuthService } from '@/services/auth.service';
import { ApiError } from '@/lib/api-client';
import { validateOtp, validateEmail } from '@/lib/validators';
import { CaptchaWidget } from '@/components/CaptchaWidget';
import '../../auth.css';

const OTP_LENGTH = 6;
const COOLDOWN_SECONDS = 60;
const CAPTCHA_REQUIRED =
  (process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER ?? 'disabled').toLowerCase() !==
  'disabled';

/**
 * Phase 20 (2026-05-20) — Franchise registration: OTP verification.
 *
 * Hits the public POST /franchise/auth/verify-email and
 * /franchise/auth/resend-verification-otp endpoints so a brand-new
 * franchise can verify BEFORE logging in. On success the user is sent
 * to /login?verified=1; the login flow then takes them to onboarding.
 */
function VerifyFranchiseRegistrationOtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailFromQuery = searchParams.get('email') || '';

  const [email, setEmail] = useState(emailFromQuery);
  const [editingEmail, setEditingEmail] = useState(!emailFromQuery);
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [otpError, setOtpError] = useState('');
  const [serverError, setServerError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [cooldown, setCooldown] = useState(COOLDOWN_SECONDS);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaResetKey, setCaptchaResetKey] = useState(0);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const onCaptchaToken = useCallback((token: string) => {
    setCaptchaToken(token);
  }, []);

  useEffect(() => {
    if (!emailFromQuery && !email) {
      router.replace('/register');
    }
  }, [emailFromQuery, email, router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    setOtpError('');
    if (digit && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData
      .getData('text')
      .replace(/\D/g, '')
      .slice(0, OTP_LENGTH);
    if (!pasted) return;
    const next = [...digits];
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setDigits(next);
    setOtpError('');
    const focusIndex = Math.min(pasted.length, OTP_LENGTH - 1);
    inputRefs.current[focusIndex]?.focus();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError('');
    setStatusMessage('');

    const otp = digits.join('');
    const error = validateOtp(otp);
    if (error) {
      setOtpError(error);
      return;
    }
    if (!email) {
      setServerError('Please enter the email you registered with.');
      return;
    }
    // The email is editable here ("Use a different email") — validate its
    // format before we send the verify request, mirroring the registration
    // form, so a typo'd address fails fast with a clear message.
    const emailError = validateEmail(email);
    if (emailError) {
      setServerError(emailError);
      return;
    }
    if (CAPTCHA_REQUIRED && !captchaToken) {
      setServerError('Please complete the captcha.');
      return;
    }

    setIsSubmitting(true);
    try {
      await franchiseAuthService.verifyEmail({
        email: email.trim().toLowerCase(),
        otp,
        captchaToken: captchaToken || undefined,
      });
      setStatusMessage('Email verified! Sending you to sign in…');
      setTimeout(() => router.replace('/login?verified=1'), 1200);
    } catch (err) {
      setCaptchaResetKey((k) => k + 1);
      setCaptchaToken('');
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setServerError(err.body.message || 'Invalid or expired code. Try again.');
        } else if (err.status === 400 && err.body?.code === 'ALREADY_VERIFIED') {
          setStatusMessage('Account already verified. Sending you to sign in…');
          setTimeout(() => router.replace('/login'), 1000);
        } else if (err.status === 429) {
          setServerError('Too many attempts. Please try again in a moment.');
        } else {
          setServerError('Something went wrong. Please try again.');
        }
      } else {
        setServerError('Something went wrong. Please try again.');
      }
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || isResending) return;
    setServerError('');
    setStatusMessage('');
    if (!email) {
      setServerError('Please enter the email you registered with.');
      return;
    }
    const emailError = validateEmail(email);
    if (emailError) {
      setServerError(emailError);
      return;
    }
    if (CAPTCHA_REQUIRED && !captchaToken) {
      setServerError('Please complete the captcha before requesting a new code.');
      return;
    }
    setIsResending(true);
    try {
      const res = await franchiseAuthService.resendVerificationOtp({
        email: email.trim().toLowerCase(),
        captchaToken: captchaToken || undefined,
      });
      const retryAfterSeconds = res.data?.retryAfterSeconds;
      setCooldown(retryAfterSeconds ?? COOLDOWN_SECONDS);
      setStatusMessage(
        'If your franchise email is awaiting verification, a new code has been sent.',
      );
      setDigits(Array(OTP_LENGTH).fill(''));
      inputRefs.current[0]?.focus();
    } catch (err) {
      setCaptchaResetKey((k) => k + 1);
      setCaptchaToken('');
      if (err instanceof ApiError && err.status === 429) {
        setServerError('Too many resend requests. Please try again in a minute.');
      } else {
        setServerError('Failed to resend code. Please try again.');
      }
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/SportsMart_Web_Banner.avif"
            alt="SportsMart"
            className="auth-logo"
            style={{ height: 56, width: 'auto', display: 'block' }}
          />
          <p className="auth-badge">Franchise Portal</p>
          <h2 className="auth-title">Verify your email</h2>
          <p className="auth-subtitle">
            Enter the 6-digit code we sent to{' '}
            <strong>{email || '…'}</strong>. It expires in 10 minutes.
          </p>
        </div>

        {statusMessage && (
          <div className="alert alert-success" role="status">
            {statusMessage}
          </div>
        )}
        {serverError && (
          <div className="alert alert-error" role="alert">
            {serverError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <fieldset disabled={isSubmitting} style={{ border: 0, padding: 0 }}>
            {editingEmail ? (
              <div className="form-group">
                <label htmlFor="email">Email Address</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </div>
            ) : (
              <div style={{ textAlign: 'right', marginBottom: 12 }}>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setEditingEmail(true)}
                  style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', padding: 0 }}
                >
                  Use a different email
                </button>
              </div>
            )}

            <div
              role="group"
              aria-label="OTP input"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                marginBottom: 16,
              }}
            >
              {digits.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    inputRefs.current[i] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  onPaste={i === 0 ? handlePaste : undefined}
                  aria-label={`Digit ${i + 1}`}
                  aria-invalid={!!otpError}
                  autoFocus={i === 0}
                  style={{
                    width: 48,
                    height: 56,
                    textAlign: 'center',
                    fontSize: 22,
                    border: `1px solid ${otpError ? '#dc2626' : '#cbd5e1'}`,
                    borderRadius: 8,
                  }}
                />
              ))}
            </div>
            {otpError && (
              <div
                className="field-error"
                style={{ textAlign: 'center', marginBottom: 12 }}
                role="alert"
              >
                {otpError}
              </div>
            )}

            <div style={{ textAlign: 'center', marginBottom: 16, fontSize: 14 }}>
              {cooldown > 0 ? (
                <span style={{ color: '#64748b' }}>
                  Resend code in {cooldown}s
                </span>
              ) : (
                <>
                  Didn&apos;t receive a code?{' '}
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={isResending}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#2563eb',
                      cursor: 'pointer',
                      padding: 0,
                      fontWeight: 600,
                    }}
                  >
                    {isResending ? 'Sending…' : 'Resend'}
                  </button>
                </>
              )}
            </div>

            {CAPTCHA_REQUIRED && (
              <div
                className="form-group"
                style={{ display: 'flex', justifyContent: 'center' }}
              >
                <CaptchaWidget
                  onToken={onCaptchaToken}
                  resetKey={captchaResetKey}
                />
              </div>
            )}

            <button
              type="submit"
              className="btn-submit"
              aria-busy={isSubmitting}
            >
              {isSubmitting ? 'Verifying…' : 'Verify and continue'}
            </button>
          </fieldset>
        </form>

        <p className="auth-footer">
          <Link href="/register">Use a different account</Link>
          {' · '}
          <Link href="/login">Already verified? Sign in</Link>
        </p>
      </div>
    </div>
  );
}

export default function FranchiseVerifyRegistrationOtpPage() {
  return (
    <Suspense>
      <VerifyFranchiseRegistrationOtpForm />
    </Suspense>
  );
}
