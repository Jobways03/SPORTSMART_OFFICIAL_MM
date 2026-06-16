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
import { AlertCircle, CheckCircle2, ArrowRight, Loader2 } from 'lucide-react';
import { authService } from '@/services/auth.service';
import { ApiError } from '@/lib/api-client';
import { validateOtp } from '@/lib/validators';
import { CaptchaWidget } from '@/components/CaptchaWidget';

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
 *
 * UI rebuilt 2026-06-15 to the storefront's editorial design language
 * (Tailwind ink scale, display headings, pill CTA, black focus) so it
 * matches the login/register pages. The OTP interaction logic is
 * unchanged except for added auto-submit + invalid-code recovery.
 */
function VerifyRegistrationOtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') || '';

  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [otpError, setOtpError] = useState('');
  const [boxesInvalid, setBoxesInvalid] = useState(false);
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

  // Focus the first box on mount (replaces the React autoFocus prop,
  // which is unreliable after Suspense hydration).
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Core verify path — shared by explicit submit and auto-submit on the
  // 6th digit. `otp` is passed in so callers never read stale `digits`.
  const verifyOtp = useCallback(
    async (otp: string) => {
      if (isSubmitting || isVerified || isResending) return;
      setServerError('');
      setStatusMessage('');

      const error = validateOtp(otp);
      if (error) {
        setOtpError(error);
        setBoxesInvalid(true);
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
        setStatusMessage('Email verified — redirecting to sign in…');
        setTimeout(() => router.replace('/login?verified=1'), 1200);
      } catch (err) {
        // Token is single-use — issue a fresh challenge on every error.
        setCaptchaResetKey((k) => k + 1);
        setCaptchaToken('');
        if (err instanceof ApiError) {
          if (err.status === 401) {
            setServerError(err.body.message || 'Invalid or expired code. Try again.');
            // Make the failure visible on the boxes (not colour-only via a
            // banner), clear them, and refocus so retry is one keystroke away.
            setBoxesInvalid(true);
            setDigits(Array(OTP_LENGTH).fill(''));
            setTimeout(() => inputRefs.current[0]?.focus(), 0);
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
    },
    [captchaToken, email, router, isSubmitting, isVerified, isResending],
  );

  // Auto-submit only when we won't immediately dead-end on a pending captcha.
  const canAutoSubmit = !(CAPTCHA_REQUIRED && !captchaToken);

  const handleChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    setOtpError('');
    setBoxesInvalid(false);
    if (digit && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
    // Auto-submit the moment all six are filled (unless a captcha is pending).
    const joined = next.join('');
    if (joined.length === OTP_LENGTH && !next.includes('') && canAutoSubmit) {
      void verifyOtp(joined);
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
    setBoxesInvalid(false);
    const focusIndex = Math.min(pasted.length, OTP_LENGTH - 1);
    inputRefs.current[focusIndex]?.focus();
    const joined = next.join('');
    if (joined.length === OTP_LENGTH && !next.includes('') && canAutoSubmit) {
      void verifyOtp(joined);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void verifyOtp(digits.join(''));
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
      setStatusMessage('If an account is awaiting verification, a new code has been sent.');
      setDigits(Array(OTP_LENGTH).fill(''));
      setBoxesInvalid(false);
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

  const showInvalid = boxesInvalid || !!otpError;

  return (
    <div className="min-h-screen bg-ink-50 flex flex-col">
      <header className="flex items-center justify-between px-6 lg:px-10 py-6">
        <Link
          href="/"
          className="font-display text-2xl tracking-wide italic leading-none"
        >
          <span className="text-sale">SPORTSMART</span>
          <span className="text-ink-900">.com</span>
        </Link>
        <span className="ml-auto text-caption text-ink-600">
          Already verified?{' '}
          <Link
            href="/login"
            className="text-accent-dark font-semibold hover:text-ink-900 hover:underline underline-offset-2"
          >
            Sign in
          </Link>
        </span>
      </header>

      <main className="flex-1 px-6 lg:px-10 py-8 flex items-start sm:items-center justify-center">
        <div className="w-full max-w-md">
          <h1 className="font-display text-h1 text-ink-900 leading-none">
            Verify your email
          </h1>
          <p className="mt-3 text-body-lg text-ink-600">
            Enter the 6-digit code we sent to{' '}
            <span className="font-semibold text-ink-900 break-all">{email}</span>.
          </p>
          <p className="mt-1 text-caption text-ink-600">
            The code expires in 10 minutes.
          </p>

          {serverError && (
            <div
              id="otp-server-error"
              role="alert"
              className="mt-6 flex items-start gap-2 p-3 border border-danger/30 bg-red-50 text-[#B91C1C] text-body rounded-2xl"
            >
              <AlertCircle className="size-4 mt-0.5 shrink-0" />
              {serverError}
            </div>
          )}

          {statusMessage && (
            <div
              role="status"
              className="mt-6 flex items-start gap-2 p-3 border border-success/30 bg-green-50 text-[#15803D] text-body rounded-2xl"
            >
              <CheckCircle2 className="size-4 mt-0.5 shrink-0" />
              {statusMessage}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="mt-7">
            <fieldset
              disabled={isSubmitting || isVerified}
              className="border-0 p-0 m-0"
            >
              <div
                role="group"
                aria-label="Enter the 6-digit verification code"
                aria-describedby={
                  [otpError && 'otp-error', serverError && 'otp-server-error']
                    .filter(Boolean)
                    .join(' ') || undefined
                }
                className="flex justify-center gap-1.5 sm:gap-3"
              >
                {digits.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      inputRefs.current[i] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleChange(i, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    onPaste={i === 0 ? handlePaste : undefined}
                    aria-label={`Digit ${i + 1}`}
                    aria-invalid={showInvalid}
                    className={`w-10 sm:w-12 h-14 text-center text-h3 font-semibold bg-white border-2 rounded-xl focus:outline-none transition-colors ${
                      showInvalid
                        ? 'border-danger focus:border-danger'
                        : 'border-ink-300 hover:border-ink-500 focus:border-ink-900'
                    }`}
                  />
                ))}
              </div>

              {otpError && (
                <p
                  id="otp-error"
                  role="alert"
                  className="mt-2 text-caption text-danger flex items-center justify-center gap-1"
                >
                  <AlertCircle className="size-3" /> {otpError}
                </p>
              )}

              <p className="mt-5 text-center text-body text-ink-600">
                {cooldown > 0 ? (
                  <span>
                    Resend code in{' '}
                    <span className="tabular font-semibold text-ink-900">
                      {cooldown}s
                    </span>
                  </span>
                ) : (
                  <>
                    Didn&apos;t receive a code?{' '}
                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={isResending}
                      className="font-semibold text-accent-dark hover:text-ink-900 hover:underline underline-offset-2 disabled:text-ink-400 disabled:no-underline"
                    >
                      {isResending ? 'Sending…' : 'Resend code'}
                    </button>
                  </>
                )}
              </p>
              {/* Announce the cooldown→available transition once, instead of
                  letting a live region read the per-second countdown aloud. */}
              <span className="sr-only" role="status" aria-live="polite">
                {cooldown === 0 ? 'You can now request a new code.' : ''}
              </span>

              {CAPTCHA_REQUIRED && (
                <div className="mt-4">
                  <CaptchaWidget
                    onToken={onCaptchaToken}
                    resetKey={captchaResetKey}
                    className="flex justify-center"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting || isVerified}
                aria-busy={isSubmitting}
                className="mt-6 w-full h-12 bg-ink-900 text-white font-semibold hover:bg-ink-800 disabled:opacity-50 inline-flex items-center justify-center gap-2 transition-colors rounded-full"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Verifying…
                  </>
                ) : (
                  <>
                    Verify and continue <ArrowRight className="size-4" />
                  </>
                )}
              </button>
            </fieldset>
          </form>

          <p className="mt-8 text-body text-ink-600 text-center">
            <Link
              href="/register"
              className="text-accent-dark hover:text-ink-900 hover:underline underline-offset-2"
            >
              Use a different email
            </Link>
            <span className="mx-2 text-ink-300">·</span>
            <Link
              href="/login"
              className="text-accent-dark hover:text-ink-900 hover:underline underline-offset-2"
            >
              Already verified? Sign in
            </Link>
          </p>
        </div>
      </main>

      <footer className="px-6 py-5 border-t border-ink-200 text-caption text-ink-500 text-center">
        &copy; {new Date().getFullYear()} Sportsmart. All rights reserved.
      </footer>
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
