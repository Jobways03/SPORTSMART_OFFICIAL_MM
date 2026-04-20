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
import { franchiseAuthService } from '@/services/auth.service';
import { ApiError } from '@/lib/api-client';
import { validateOtp } from '@/lib/validators';
import '../auth.css';

const OTP_LENGTH = 6;

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  if (local.length <= 1) return `${local}***@${domain}`;
  return `${local[0]}${'*'.repeat(Math.min(local.length - 1, 5))}@${domain}`;
}

function VerifyOtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') || '';

  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [otpError, setOtpError] = useState('');
  const [serverError, setServerError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!email) {
      router.replace('/forgot-password');
    }
  }, [email, router]);

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

    const otp = digits.join('');
    const error = validateOtp(otp);
    if (error) {
      setOtpError(error);
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await franchiseAuthService.verifyOtp(email, otp);

      if (result.data?.resetToken) {
        router.push(
          `/reset-password?token=${encodeURIComponent(result.data.resetToken)}`,
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

  if (!email) return null;

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-logo">SPORTSMART</h1>
          <p className="auth-badge">Franchise Portal</p>
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

        <form onSubmit={handleSubmit} noValidate>
          <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>
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

export default function VerifyOtpPage() {
  return (
    <Suspense>
      <VerifyOtpForm />
    </Suspense>
  );
}
