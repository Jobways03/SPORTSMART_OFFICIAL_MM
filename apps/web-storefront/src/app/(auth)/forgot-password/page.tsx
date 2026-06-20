'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AuthMobileHeader } from '@/components/auth/AuthMobileHeader';
import { AlertCircle, ArrowRight, Clock, KeyRound, LifeBuoy, Loader2, ShieldCheck } from 'lucide-react';
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
    <div className="min-h-screen bg-ink-50 flex justify-center">
      <div className="w-full max-w-[1320px] min-h-screen grid lg:grid-cols-2">
        {/* Branded panel — mirrors the login/register split-screen so the whole
            auth flow looks consistent (was a bare single-column form before). */}
        <div
          className="hidden lg:block relative overflow-hidden bg-ink-100"
          style={{
            backgroundImage:
              'radial-gradient(ellipse 80% 60% at 85% 15%, rgba(63, 161, 174, 0.45), transparent 60%), radial-gradient(ellipse 70% 50% at 15% 85%, rgba(220, 38, 38, 0.22), transparent 60%), radial-gradient(ellipse 50% 40% at 50% 50%, rgba(250, 204, 21, 0.18), transparent 60%)',
          }}
        >
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none opacity-[0.04] mix-blend-multiply"
            style={{
              backgroundImage:
                'repeating-linear-gradient(135deg, rgba(26,26,26,1) 0, rgba(26,26,26,1) 1px, transparent 1px, transparent 28px)',
            }}
          />

          <div className="relative h-full flex flex-col p-12 xl:p-16">
            <Link href="/" aria-label="Sportsmart home" className="inline-block w-fit">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/SportsMart_Web_Banner.avif" alt="SportsMart" className="h-14 w-auto" />
            </Link>

            <div className="flex-1 flex flex-col justify-center max-w-xl">
              <h2 className="font-display text-[clamp(56px,6vw,96px)] leading-[0.92] tracking-tight text-ink-900">
                Back in the
                <br />
                <span className="font-brush text-sale text-[0.85em] tracking-normal">
                  game.
                </span>
              </h2>
              <p className="mt-6 text-body-lg text-ink-700 max-w-md">
                Reset your password in two quick steps and pick up right where
                you left off.
              </p>

              <ul className="mt-10 grid sm:grid-cols-2 gap-3 max-w-lg">
                {[
                  { icon: ShieldCheck, title: 'Secure reset', desc: '6-digit code to your email' },
                  { icon: KeyRound, title: 'New password', desc: 'Set it in seconds' },
                  { icon: Clock, title: 'Quick & easy', desc: 'Done in under a minute' },
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
            </div>
          </div>
        </div>

        {/* Form panel */}
        <div className="flex flex-col">
          <AuthMobileHeader switchPrompt="Remember it?" switchLabel="Sign in" switchHref="/login" />

          <main className="flex-1 px-6 lg:px-10 pt-6 lg:pt-10 pb-10 flex items-start sm:items-center">
            <div className="w-full max-w-md mx-auto">
          <h1 className="font-display text-2xl sm:text-3xl text-ink-900 leading-tight">
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
        </div>
      </div>
    </div>
  );
}
