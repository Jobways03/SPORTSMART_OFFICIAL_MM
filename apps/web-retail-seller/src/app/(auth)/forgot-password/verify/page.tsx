'use client';

import {
  Suspense,
  useState,
  useRef,
  useEffect,
  FormEvent,
  KeyboardEvent,
  ClipboardEvent,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { sellerAuthService } from '@/services/auth.service';
import { ApiError } from '@/lib/api-client';
import { validateOtp } from '@/lib/validators';
import '../forgot-password.css';

const OTP_LENGTH = 6;
const COOLDOWN_SECONDS = 60;

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  if (local.length <= 1) return `${local}***@${domain}`;
  return `${local[0]}${'*'.repeat(Math.min(local.length - 1, 5))}@${domain}`;
}

function VerifyResetOtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') || '';

  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [otpError, setOtpError] = useState('');
  const [serverError, setServerError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(COOLDOWN_SECONDS);
  const [resendMessage, setResendMessage] = useState('');

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Redirect if no email
  useEffect(() => {
    if (!email) {
      router.replace('/forgot-password');
    }
  }, [email, router]);

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);
    setOtpError('');

    if (digit && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      const newDigits = [...digits];
      newDigits[index - 1] = '';
      setDigits(newDigits);
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    if (!pasted) return;

    const newDigits = [...digits];
    for (let i = 0; i < pasted.length; i++) {
      newDigits[i] = pasted[i];
    }
    setDigits(newDigits);
    setOtpError('');

    const focusIndex = Math.min(pasted.length, OTP_LENGTH - 1);
    inputRefs.current[focusIndex]?.focus();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError('');
    setResendMessage('');

    const otp = digits.join('');
    const error = validateOtp(otp);
    if (error) {
      setOtpError(error);
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await sellerAuthService.verifyResetOtp(email, otp);

      if (result.data?.resetToken) {
        router.push(
          `/forgot-password/reset?token=${encodeURIComponent(result.data.resetToken)}`,
        );
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          const msg = err.body.message || 'Invalid or expired code';
          setServerError(typeof msg === 'string' ? msg : Array.isArray(msg) ? msg[0] : String(msg));
          setDigits(Array(OTP_LENGTH).fill(''));
          inputRefs.current[0]?.focus();
        } else if (err.status === 429) {
          setServerError('Too many attempts. Please request a new code.');
        } else {
          setServerError('Something went wrong. Please try again.');
        }
      } else {
        setServerError('Something went wrong. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;

    setResendMessage('');
    setServerError('');

    try {
      await sellerAuthService.resendResetOtp(email);
      setCooldown(COOLDOWN_SECONDS);
      setResendMessage('A new code has been sent to your email.');
      setDigits(Array(OTP_LENGTH).fill(''));
      inputRefs.current[0]?.focus();
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setServerError('Too many requests. Please try again later.');
      } else {
        setServerError('Failed to resend code. Please try again.');
      }
    }
  };

  if (!email) return null;

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-logo">SPORTSMART</h1>
          <p className="auth-badge">Seller Portal</p>
          <h2 className="auth-title">Enter verification code</h2>
          <p className="auth-subtitle">
            We&apos;ve sent a 6-digit code to <strong>{maskEmail(email)}</strong>
          </p>
        </div>

        {serverError && (
          <div className="alert alert-error" role="alert">
            {serverError}
          </div>
        )}

        {resendMessage && (
          <div className="alert alert-success" role="status">
            {resendMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>
              Verification code
            </legend>
            <div className="otp-inputs" role="group" aria-label="Verification code">
              {digits.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    inputRefs.current[i] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  onPaste={i === 0 ? handlePaste : undefined}
                  aria-label={`Digit ${i + 1} of ${OTP_LENGTH}`}
                  aria-invalid={!!otpError}
                  disabled={isSubmitting}
                  autoFocus={i === 0}
                />
              ))}
            </div>
          </fieldset>

          {otpError && (
            <div
              className="field-error"
              style={{ textAlign: 'center', marginBottom: 16 }}
              role="alert"
            >
              {otpError}
            </div>
          )}

          <div className="resend-row">
            {cooldown > 0 ? (
              <span>Resend code in {cooldown}s</span>
            ) : (
              <>
                Didn&apos;t receive a code?{' '}
                <button type="button" className="resend-btn" onClick={handleResend}>
                  Resend
                </button>
              </>
            )}
          </div>

          <button
            type="submit"
            className="btn-submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? 'Verifying...' : 'Verify Code'}
          </button>
        </form>

        <p className="auth-footer">
          <Link href="/forgot-password">Use a different email</Link>
        </p>
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
