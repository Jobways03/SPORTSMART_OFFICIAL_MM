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
import { AuthMobileHeader } from '@/components/auth/AuthMobileHeader';
import { AlertCircle, ArrowRight, CheckCircle2, Clock, KeyRound, LifeBuoy, Loader2, MailCheck } from 'lucide-react';
import { AuthBrandPanel } from '@/components/auth/AuthBrandPanel';
import { authService } from '@/services/auth.service';
import { ApiError } from '@/lib/api-client';
import { validateOtp } from '@/lib/validators';

const OTP_LENGTH = 6;
const COOLDOWN_SECONDS = 60;

function VerifyResetOtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') || '';

  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [otpError, setOtpError] = useState('');
  const [boxesInvalid, setBoxesInvalid] = useState(false);
  const [serverError, setServerError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [cooldown, setCooldown] = useState(COOLDOWN_SECONDS);
  const [resendMessage, setResendMessage] = useState('');

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Redirect if no email
  useEffect(() => {
    if (!email) {
      router.replace('/forgot-password');
    }
  }, [email, router]);

  // Focus the first box on mount.
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const verifyOtp = useCallback(
    async (otp: string) => {
      if (isSubmitting || isResending) return;
      setServerError('');
      setResendMessage('');

      const error = validateOtp(otp);
      if (error) {
        setOtpError(error);
        setBoxesInvalid(true);
        return;
      }

      setIsSubmitting(true);
      try {
        const result = await authService.verifyResetOtp(email, otp);
        if (result.data?.resetToken) {
          try {
            sessionStorage.setItem('resetToken', result.data.resetToken);
            sessionStorage.setItem('resetEmail', email);
          } catch {
            // Storage unavailable
          }
          router.push('/forgot-password/reset');
          return;
        }
        // No token returned — treat as a generic failure.
        setServerError('Something went wrong. Please try again.');
        setIsSubmitting(false);
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 401) {
            setServerError(err.body.message || 'Invalid or expired code. Try again.');
            setBoxesInvalid(true);
            setDigits(Array(OTP_LENGTH).fill(''));
            setTimeout(() => inputRefs.current[0]?.focus(), 0);
          } else if (err.status === 429) {
            setServerError('Too many attempts. Please try again later.');
          } else {
            setServerError('Something went wrong. Please try again.');
          }
        } else {
          setServerError('Something went wrong. Please try again.');
        }
        setIsSubmitting(false);
      }
    },
    [email, router, isSubmitting, isResending],
  );

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
    const joined = next.join('');
    if (joined.length === OTP_LENGTH && !next.includes('')) {
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
    if (joined.length === OTP_LENGTH && !next.includes('')) {
      void verifyOtp(joined);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void verifyOtp(digits.join(''));
  };

  const handleResend = async () => {
    if (cooldown > 0 || isResending) return;
    setResendMessage('');
    setServerError('');
    setIsResending(true);
    try {
      await authService.resendResetOtp(email);
      setCooldown(COOLDOWN_SECONDS);
      setResendMessage('If an account exists, a new code has been sent.');
      setDigits(Array(OTP_LENGTH).fill(''));
      setBoxesInvalid(false);
      inputRefs.current[0]?.focus();
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setServerError('Too many requests. Please try again later.');
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
    <div className="min-h-screen bg-ink-50 flex justify-center">
      <div className="w-full max-w-[1320px] min-h-screen grid lg:grid-cols-2">
        {/* Branded panel */}
        <AuthBrandPanel>
          <h2 className="font-display text-[clamp(56px,6vw,96px)] leading-[0.92] tracking-tight text-ink-900">
            Check your
            <br />
            <span className="font-brush text-sale text-[0.85em] tracking-normal">
              inbox.
            </span>
          </h2>
          <p className="mt-6 text-body-lg text-ink-700 max-w-md">
            We&apos;ve sent a 6-digit code to your email. Enter it to continue
            resetting your password.
          </p>
          <ul className="mt-10 grid sm:grid-cols-2 gap-3 max-w-lg">
            {[
              { icon: MailCheck, title: 'Code sent', desc: 'Check your inbox & spam' },
              { icon: Clock, title: 'Expires soon', desc: 'Use it within ~10 minutes' },
              { icon: KeyRound, title: 'Next: new password', desc: 'One more step to go' },
              { icon: LifeBuoy, title: 'Need a hand?', desc: 'Support is one click away' },
            ].map(({ icon: Icon, title, desc }) => (
              <li key={title} className="bg-white border border-ink-900/10 p-3">
                <Icon className="size-4 text-accent-dark" strokeWidth={1.75} />
                <div className="mt-2 text-body font-semibold text-ink-900">
                  {title}
                </div>
                <div className="text-caption text-ink-600">{desc}</div>
              </li>
            ))}
          </ul>
        </AuthBrandPanel>

        {/* Form panel */}
        <div className="flex flex-col">
          <AuthMobileHeader switchPrompt="Remember it?" switchLabel="Sign in" switchHref="/login" />

          <main className="flex-1 px-6 lg:px-10 pt-6 lg:pt-10 pb-10 flex items-start sm:items-center">
            <div className="w-full max-w-md mx-auto">
          <h1 className="font-display text-2xl sm:text-3xl text-ink-900 leading-tight">
            Verify code
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

          {resendMessage && (
            <div
              role="status"
              className="mt-6 flex items-start gap-2 p-3 border border-success/30 bg-green-50 text-[#15803D] text-body rounded-2xl"
            >
              <CheckCircle2 className="size-4 mt-0.5 shrink-0" />
              {resendMessage}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="mt-7">
            <fieldset disabled={isSubmitting} className="border-0 p-0 m-0">
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
                    className={`size-11 sm:size-14 text-center text-h3 font-semibold bg-white border-2 rounded-md focus:outline-none transition-colors ${
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

              <button
                type="submit"
                disabled={isSubmitting}
                aria-busy={isSubmitting}
                className="mt-6 w-full h-12 bg-ink-900 text-white font-semibold hover:bg-ink-800 disabled:opacity-50 inline-flex items-center justify-center gap-2 transition-colors rounded-full"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Verifying…
                  </>
                ) : (
                  <>
                    Verify code <ArrowRight className="size-4" />
                  </>
                )}
              </button>
            </fieldset>
          </form>

          <p className="mt-8 text-body text-ink-600 text-center">
            <Link
              href="/forgot-password"
              className="text-accent-dark hover:text-ink-900 hover:underline underline-offset-2"
            >
              Use a different email
            </Link>
          </p>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

export default function VerifyResetOtpPage() {
  return (
    <Suspense>
      <VerifyResetOtpForm />
    </Suspense>
  );
}
