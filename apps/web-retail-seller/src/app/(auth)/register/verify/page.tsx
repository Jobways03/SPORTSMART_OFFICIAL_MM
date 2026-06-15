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
import { sellerAuthService } from '@/services/auth.service';
import { ApiError } from '@/lib/api-client';
import { validateOtp, validateEmail } from '@/lib/validators';
import { CaptchaWidget } from '@/components/CaptchaWidget';
import '../register.css';

const OTP_LENGTH = 6;
const COOLDOWN_SECONDS = 60;
const CAPTCHA_REQUIRED =
  (process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER ?? 'disabled').toLowerCase() !==
  'disabled';

/**
 * Phase 18 (2026-05-20) — Seller registration: OTP verification.
 *
 * Mirror of the storefront verify page in shape. Routes to the public
 * /seller/auth/verify-email + /seller/auth/resend-verification-otp
 * endpoints so a brand-new seller can verify BEFORE logging in. After
 * success the seller is redirected to /login?verified=1; the login
 * page's existing flow then takes them to the onboarding wizard.
 *
 * The page deliberately does NOT auto-log the seller in — registration
 * is account-provisioning, not session-creation. The existing
 * onboarding flow (apps/.../dashboard/onboarding/page.tsx) is reached
 * via login, untouched by this PR.
 */
function VerifyRegistrationOtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailFromQuery = searchParams.get('email') || '';

  const [email, setEmail] = useState(emailFromQuery);
  const [editingEmail, setEditingEmail] = useState(!emailFromQuery);
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [otpError, setOtpError] = useState('');
  const [serverError, setServerError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [warningMessage, setWarningMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [cooldown, setCooldown] = useState(COOLDOWN_SECONDS);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaResetKey, setCaptchaResetKey] = useState(0);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const onCaptchaToken = useCallback((token: string) => {
    setCaptchaToken(token);
  }, []);

  // Redirect if no email param AND user didn't provide one.
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
      await sellerAuthService.verifyEmail({
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
    setWarningMessage('');
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
      const res = await sellerAuthService.resendVerificationOtp({
        email: email.trim().toLowerCase(),
        captchaToken: captchaToken || undefined,
      });
      const retryAfterSeconds = res.data?.retryAfterSeconds;
      setCooldown(retryAfterSeconds ?? COOLDOWN_SECONDS);
      setStatusMessage(
        'If your seller email is awaiting verification, a new code has been sent.',
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
          <p className="auth-badge">Seller Portal</p>
          <h2 className="auth-title">Verify your email</h2>
          <p className="auth-subtitle">
            Enter the 6-digit code we sent to{' '}
            <strong>{email || '…'}</strong>. It expires in 10 minutes.
          </p>
        </div>

        {warningMessage && (
          <div className="alert-warning" role="status">
            {warningMessage}
          </div>
        )}
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
            <div className="resend-row">
              <button
                type="button"
                className="resend-btn"
                onClick={() => setEditingEmail(true)}
              >
                Use a different email
              </button>
            </div>
          )}

          <div className="otp-inputs" role="group" aria-label="OTP input">
            {digits.map((digit, i) => (
              <input
                key={i}
                ref={(el) => { inputRefs.current[i] = el; }}
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
              />
            ))}
          </div>
          {otpError && (
            <div className="field-error" style={{ textAlign: 'center', marginBottom: 12 }} role="alert">
              {otpError}
            </div>
          )}

          <div className="resend-row">
            {cooldown > 0 ? (
              <span>Resend code in {cooldown}s</span>
            ) : (
              <>
                Didn&apos;t receive a code?{' '}
                <button
                  type="button"
                  className="resend-btn"
                  onClick={handleResend}
                  disabled={isResending}
                >
                  {isResending ? 'Sending…' : 'Resend'}
                </button>
              </>
            )}
          </div>

          {CAPTCHA_REQUIRED && (
            <div className="form-group" style={{ display: 'flex', justifyContent: 'center' }}>
              <CaptchaWidget onToken={onCaptchaToken} resetKey={captchaResetKey} />
            </div>
          )}

          <button type="submit" className="btn-submit" aria-busy={isSubmitting}>
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

export default function SellerVerifyRegistrationOtpPage() {
  return (
    <Suspense>
      <VerifyRegistrationOtpForm />
    </Suspense>
  );
}
