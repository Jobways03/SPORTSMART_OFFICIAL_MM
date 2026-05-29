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
import { authService } from '@/services/auth.service';
import { ApiError } from '@/lib/api-client';
import { validateOtp } from '@/lib/validators';
import { CaptchaWidget } from '@/components/CaptchaWidget';
import '../register.css';

const OTP_LENGTH = 6;
const COOLDOWN_SECONDS = 60;
const CAPTCHA_REQUIRED =
  (process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER ?? 'disabled').toLowerCase() !==
  'disabled';

/**
 * Phase 16 (2026-05-20) — Customer registration: OTP verification.
 *
 * Mirror of the forgot-password verify page in shape, but routes to
 * /register/verify-otp and /register/resend-otp on the API. On
 * success, the customer is redirected to /login (we deliberately do
 * NOT auto-log-in here — registration is treated as account
 * provisioning, not session creation).
 */
function VerifyRegistrationOtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') || '';

  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [otpError, setOtpError] = useState('');
  const [serverError, setServerError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  // Start with the cooldown active — the API already sent an OTP on
  // /register, so re-clicking "resend" within 60s would be silently
  // absorbed anyway. Counting down here makes that obvious.
  const [cooldown, setCooldown] = useState(COOLDOWN_SECONDS);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaResetKey, setCaptchaResetKey] = useState(0);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const onCaptchaToken = useCallback((token: string) => {
    setCaptchaToken(token);
  }, []);

  // Redirect to /register if the email is missing — the verify page
  // is only useful when entered from the register form (or from a
  // verify-link in the welcome email, which always carries email=).
  useEffect(() => {
    if (!email) {
      router.replace('/register');
    }
  }, [email, router]);

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
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    if (!pasted) return;
    const next = [...digits];
    for (let i = 0; i < pasted.length; i++) {
      next[i] = pasted[i];
    }
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
    if (CAPTCHA_REQUIRED && !captchaToken) {
      setServerError('Please complete the captcha.');
      return;
    }

    setIsSubmitting(true);
    try {
      await authService.verifyEmailOtp({
        email,
        otp,
        captchaToken: captchaToken || undefined,
      });
      setIsVerified(true);
      setStatusMessage('Email verified. Redirecting to sign in…');
      setTimeout(() => router.replace('/login?verified=1'), 1200);
    } catch (err) {
      // Token is single-use — issue a fresh challenge on every error.
      setCaptchaResetKey((k) => k + 1);
      setCaptchaToken('');
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setServerError(err.body.message || 'Invalid or expired code. Try again.');
        } else if (err.status === 400) {
          // ALREADY_VERIFIED — push to login.
          if (err.body?.code === 'ALREADY_VERIFIED') {
            setStatusMessage('Account already verified. Sending you to sign in…');
            setTimeout(() => router.replace('/login'), 1000);
          } else {
            setServerError(err.message || 'Please check the code and try again.');
          }
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
    if (CAPTCHA_REQUIRED && !captchaToken) {
      setServerError('Please complete the captcha before requesting a new code.');
      return;
    }
    setIsResending(true);
    try {
      await authService.resendVerificationOtp({
        email,
        captchaToken: captchaToken || undefined,
      });
      setCooldown(COOLDOWN_SECONDS);
      setStatusMessage('If your email is awaiting verification, a new code has been sent.');
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

  if (!email) return null;

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-logo">SPORTSMART</h1>
          <h2 className="auth-title">Verify your email</h2>
          <p className="auth-subtitle">
            Enter the 6-digit code we sent to <strong>{email}</strong>.
            <br />
            <span style={{ fontSize: '12px', color: '#6b7280' }}>
              The code expires in 10 minutes.
            </span>
          </p>
        </div>

        {serverError && (
          <div className="alert alert-error" role="alert">
            {serverError}
          </div>
        )}

        {statusMessage && (
          <div className="alert alert-success" role="status">
            {statusMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <fieldset disabled={isSubmitting || isVerified} style={{ border: 0, padding: 0 }}>
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
            <div className="field-error" style={{ textAlign: 'center', marginBottom: 16 }} role="alert">
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
            <div style={{ display: 'flex', justifyContent: 'center', margin: '12px 0' }}>
              <CaptchaWidget onToken={onCaptchaToken} resetKey={captchaResetKey} />
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
          <Link href="/register">Use a different email</Link>
          {' · '}
          <Link href="/login">Already verified? Sign in</Link>
        </p>
      </div>
    </div>
  );
}

export default function VerifyRegistrationOtpPage() {
  return (
    <Suspense>
      <VerifyRegistrationOtpForm />
    </Suspense>
  );
}
