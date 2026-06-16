'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { authService } from '@/services/auth.service';
import { ApiError } from '@/lib/api-client';
import { validateLoginEmail } from '@/lib/validators';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [serverError, setServerError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleBlur = () => {
    const error = validateLoginEmail(email);
    setEmailError(error || '');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError('');

    const error = validateLoginEmail(email);
    if (error) {
      setEmailError(error);
      return;
    }

    setIsSubmitting(true);

    try {
      const trimmedEmail = email.trim().toLowerCase();
      await authService.forgotPassword(trimmedEmail);

      // Always navigate to verify page — server always returns success
      // to prevent email enumeration
      router.push(`/forgot-password/verify?email=${encodeURIComponent(trimmedEmail)}`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          setServerError('Too many requests. Please try again later.');
        } else if (err.status === 422 && err.body.errors) {
          const emailErr = err.body.errors.find((e) => e.field === 'email');
          if (emailErr) setEmailError(emailErr.message);
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
          Remember it?{' '}
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
            Forgot password?
          </h1>
          <p className="mt-3 text-body-lg text-ink-600">
            Enter your email and we&apos;ll send you a 6-digit code to reset it.
          </p>

          {serverError && (
            <div
              role="alert"
              className="mt-6 flex items-start gap-2 p-3 border border-danger/30 bg-red-50 text-[#B91C1C] text-body rounded-2xl"
            >
              <AlertCircle className="size-4 mt-0.5 shrink-0" />
              {serverError}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="mt-7 space-y-4">
            <fieldset disabled={isSubmitting} className="space-y-4 border-0 p-0 m-0">
              <div>
                <label
                  htmlFor="email"
                  className="block text-caption uppercase tracking-wider font-semibold text-ink-700 mb-2"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  maxLength={255}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={handleBlur}
                  aria-invalid={!!emailError}
                  aria-describedby={emailError ? 'email-error' : undefined}
                  autoComplete="email"
                  autoFocus
                  className={`w-full h-12 px-4 border bg-white text-body-lg placeholder:text-ink-400 focus:outline-none transition-colors rounded-full ${
                    emailError
                      ? 'border-danger focus:border-danger'
                      : 'border-ink-300 hover:border-ink-500 focus:border-ink-900'
                  }`}
                />
                {emailError && (
                  <p
                    id="email-error"
                    role="alert"
                    className="mt-1.5 text-caption text-danger flex items-center gap-1"
                  >
                    <AlertCircle className="size-3" /> {emailError}
                  </p>
                )}
              </div>

              <button
                type="submit"
                aria-busy={isSubmitting}
                className="w-full h-12 bg-ink-900 text-white font-semibold hover:bg-ink-800 disabled:opacity-50 inline-flex items-center justify-center gap-2 transition-colors rounded-full"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Sending…
                  </>
                ) : (
                  <>
                    Send reset code <ArrowRight className="size-4" />
                  </>
                )}
              </button>
            </fieldset>
          </form>

          <p className="mt-8 text-body text-ink-600 text-center">
            Remember your password?{' '}
            <Link
              href="/login"
              className="text-accent-dark font-semibold hover:text-ink-900 hover:underline underline-offset-2"
            >
              Sign in
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
