'use client';

import { Suspense, useCallback, useEffect, useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  Truck,
  RefreshCw,
  Star,
} from 'lucide-react';
import { authService } from '@/services/auth.service';
import { ApiError } from '@/lib/api-client';
import { validateLoginEmail, validateLoginPassword } from '@/lib/validators';
import { CaptchaWidget } from '@/components/CaptchaWidget';
import { useSession, broadcastAuthChange } from '@/lib/auth-context';

interface FormErrors {
  email?: string;
  password?: string;
  captchaToken?: string;
}

const CAPTCHA_REQUIRED =
  (process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER ?? 'disabled').toLowerCase() !==
  'disabled';

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status, refresh } = useSession();
  const justVerified = searchParams.get('verified') === '1';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState('');
  const [needsEmailVerification, setNeedsEmailVerification] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaResetKey, setCaptchaResetKey] = useState(0);

  const onCaptchaToken = useCallback((token: string) => {
    setCaptchaToken(token);
  }, []);

  // Phase 17 (2026-05-20) — redirect already-authed visitors away
  // from /login so the back button doesn't loop them through a
  // login page they don't need.
  useEffect(() => {
    if (status === 'authed') {
      router.replace('/');
    }
  }, [status, router]);

  const handleBlur = (field: 'email' | 'password', value: string) => {
    if (!value.trim()) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
      return;
    }
    const error =
      field === 'email' ? validateLoginEmail(value) : validateLoginPassword(value);
    setErrors((prev) => ({ ...prev, [field]: error || undefined }));
  };

  const validateAll = (): boolean => {
    const newErrors: FormErrors = {};
    const emErr = validateLoginEmail(email);
    const pwErr = validateLoginPassword(password);
    if (emErr) newErrors.email = emErr;
    if (pwErr) newErrors.password = pwErr;
    if (CAPTCHA_REQUIRED && !captchaToken) {
      newErrors.captchaToken = 'Please complete the captcha';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError('');
    setNeedsEmailVerification(false);
    setSubmitAttempted(true);
    if (!validateAll()) {
      const firstErrorField = document.querySelector('[aria-invalid="true"]') as HTMLElement;
      firstErrorField?.focus();
      return;
    }
    setIsSubmitting(true);
    try {
      await authService.login({
        email: email.trim().toLowerCase(),
        password,
        captchaToken: captchaToken || undefined,
      });
      // Phase 17 (2026-05-20) — cookie-based session: the server has
      // set httpOnly cookies on the response. The JS layer never
      // sees the tokens. Refreshing the auth context probes
      // /auth/me with the new cookies and updates the navbar.
      await refresh();
      broadcastAuthChange();
      // router.replace so the back button doesn't return to /login.
      router.replace('/');
    } catch (err) {
      // Force a fresh captcha challenge on every failed submit —
      // Turnstile/hCaptcha tokens are single-use, so a 4xx without
      // resetting leaves the form unsubmittable.
      setCaptchaResetKey((k) => k + 1);
      setCaptchaToken('');
      if (err instanceof ApiError) {
        if (err.status === 403 && err.body.code === 'EMAIL_NOT_VERIFIED') {
          setNeedsEmailVerification(true);
        } else if (err.status === 401) {
          setServerError('Invalid email or password');
        } else if (err.status === 403) {
          setServerError(err.message || 'Account is not active. Please contact support.');
        } else if (err.status === 429) {
          setServerError(err.message || 'Too many login attempts. Please try again later.');
        } else if (err.status === 400 && err.body.code?.startsWith('CAPTCHA')) {
          setServerError('Captcha verification failed. Please try again.');
        } else if (err.status === 422 && err.body.errors) {
          const fieldErrors: FormErrors = {};
          for (const e of err.body.errors) (fieldErrors as Record<string, string>)[e.field] = e.message;
          setErrors(fieldErrors);
        } else setServerError('Something went wrong. Please try again.');
      } else setServerError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const visibleEmailError =
    errors.email && (submitAttempted || email.trim()) ? errors.email : undefined;
  const visiblePasswordError =
    errors.password && (submitAttempted || password.trim()) ? errors.password : undefined;

  // While the session probe is running on first mount, render the
  // form so SSR-shape matches CSR. If the probe resolves to 'authed'
  // the useEffect redirect above will navigate away.
  if (status === 'authed') return null;

  return (
    <div className="min-h-screen bg-ink-50 flex justify-center">
      <div className="w-full max-w-[1320px] min-h-screen grid lg:grid-cols-[1fr_540px]">
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
            <img
              src="/SportsMart_Web_Banner.avif"
              alt="SportsMart"
              className="h-14 w-auto"
            />
          </Link>

          <div className="flex-1 flex flex-col justify-center max-w-xl">
            <h2 className="font-display text-[clamp(56px,6vw,96px)] leading-[0.92] tracking-tight text-ink-900">
              Play harder.
              <br />
              <span className="font-brush text-sale text-[0.85em] tracking-normal">
                Move faster.
              </span>
            </h2>
            <p className="mt-6 text-body-lg text-ink-700 max-w-md">
              India&apos;s premium sports marketplace. Sign in to track orders,
              save addresses, and shop faster.
            </p>

            <dl className="mt-10 grid grid-cols-3 gap-4 max-w-lg">
              {[
                { v: '200+', l: 'Brands' },
                { v: '500+', l: 'Sellers' },
                { v: '100%', l: 'Authentic' },
              ].map((s) => (
                <div
                  key={s.l}
                  className="border-l-2 border-ink-900/15 pl-3"
                >
                  <dt className="font-display text-h2 text-ink-900 leading-none tabular">
                    {s.v}
                  </dt>
                  <dd className="mt-1 text-caption uppercase tracking-[0.18em] text-ink-600">
                    {s.l}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="max-w-md bg-white border border-ink-900/10 p-5 rounded-2xl">
            <div className="flex items-center gap-1 text-ink-900" aria-label="5 star rating">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className="size-3.5 fill-current" strokeWidth={0} />
              ))}
            </div>
            <p className="mt-2 text-body text-ink-800 italic">
              &ldquo;Genuine gear, fast delivery, and the after-sales team
              actually responds. Best place to buy kit online.&rdquo;
            </p>
            <div className="mt-3 flex items-center gap-3">
              <span className="size-8 rounded-full bg-accent-dark text-white grid place-items-center text-caption font-semibold">
                RS
              </span>
              <div className="leading-tight">
                <div className="text-body font-semibold text-ink-900">
                  Rohan Shenoy
                </div>
                <div className="text-caption text-ink-600">
                  Verified buyer &middot; Bengaluru
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col">
        <header className="flex items-center justify-between px-6 lg:px-10 py-6">
          <Link href="/" className="lg:hidden font-display text-2xl tracking-wide italic leading-none">
            <span className="text-sale">SPORTSMART</span>
            <span className="text-ink-900">.com</span>
          </Link>
          <span className="ml-auto text-caption text-ink-600">
            New here?{' '}
            <Link href="/register" className="text-accent-dark font-semibold hover:text-ink-900 hover:underline underline-offset-2">
              Create an account
            </Link>
          </span>
        </header>

        <main className="flex-1 px-6 lg:px-10 pt-6 lg:pt-10 pb-10">
          <div className="w-full max-w-md mx-auto">
            <h1 className="font-display text-h1 text-ink-900 leading-none">Sign in</h1>
            <p className="mt-3 text-body-lg text-ink-600">
              Welcome back. Enter your credentials to continue.
            </p>

            {justVerified && (
              <div
                role="status"
                className="mt-6 flex items-start gap-2 p-3 border border-success/30 bg-green-50 text-success text-body rounded-2xl"
              >
                <CheckCircle2 className="size-4 mt-0.5 shrink-0" />
                Email verified! Sign in to get started.
              </div>
            )}
            {needsEmailVerification && (
              <div
                role="alert"
                className="mt-6 flex items-start gap-2 p-3 border border-danger/30 bg-red-50 text-danger text-body rounded-2xl"
              >
                <AlertCircle className="size-4 mt-0.5 shrink-0" />
                <span>
                  Your email isn&apos;t verified yet.{' '}
                  <Link
                    href={`/register/verify?email=${encodeURIComponent(email.trim().toLowerCase())}`}
                    className="underline font-semibold"
                  >
                    Verify now / resend code
                  </Link>
                </span>
              </div>
            )}
            {serverError && (
              <div
                role="alert"
                className="mt-6 flex items-start gap-2 p-3 border border-danger/30 bg-red-50 text-danger text-body rounded-2xl"
              >
                <AlertCircle className="size-4 mt-0.5 shrink-0" />
                {serverError}
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="mt-7 space-y-4">
              <fieldset disabled={isSubmitting} className="space-y-4 border-0 p-0">
              <div>
                <label htmlFor="email" className="block text-caption uppercase tracking-wider font-semibold text-ink-700 mb-2">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  maxLength={255}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => handleBlur('email', email)}
                  aria-invalid={!!visibleEmailError}
                  aria-describedby={visibleEmailError ? 'email-error' : undefined}
                  autoComplete="email"
                  className={`w-full h-12 px-4 border bg-white text-body-lg placeholder:text-ink-400 focus:outline-none transition-colors rounded-full ${
                    visibleEmailError
                      ? 'border-danger focus:border-danger'
                      : 'border-ink-300 hover:border-ink-500 focus:border-ink-900'
                  }`}
                />
                {visibleEmailError && (
                  <p id="email-error" role="alert" className="mt-1.5 text-caption text-danger flex items-center gap-1">
                    <AlertCircle className="size-3" /> {visibleEmailError}
                  </p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="password" className="text-caption uppercase tracking-wider font-semibold text-ink-700">
                    Password
                  </label>
                  <Link href="/forgot-password" className="text-caption text-accent-dark hover:text-ink-900 hover:underline underline-offset-2">
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={password}
                    maxLength={128}
                    onChange={(e) => setPassword(e.target.value)}
                    onBlur={() => handleBlur('password', password)}
                    aria-invalid={!!visiblePasswordError}
                    aria-describedby={visiblePasswordError ? 'password-error' : undefined}
                    autoComplete="current-password"
                    className={`w-full h-12 px-4 pr-12 border bg-white text-body-lg placeholder:text-ink-400 focus:outline-none transition-colors rounded-full ${
                      visiblePasswordError
                        ? 'border-danger focus:border-danger'
                        : 'border-ink-300 hover:border-ink-500 focus:border-ink-900'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    tabIndex={-1}
                    className="absolute right-2 top-1/2 -translate-y-1/2 size-8 grid place-items-center text-ink-500 hover:text-ink-900"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {visiblePasswordError && (
                  <p id="password-error" role="alert" className="mt-1.5 text-caption text-danger flex items-center gap-1">
                    <AlertCircle className="size-3" /> {visiblePasswordError}
                  </p>
                )}
              </div>

              {CAPTCHA_REQUIRED && (
                <div className="pt-2">
                  <CaptchaWidget
                    onToken={onCaptchaToken}
                    resetKey={captchaResetKey}
                    className="flex justify-center"
                  />
                  {errors.captchaToken && submitAttempted && (
                    <p role="alert" className="text-caption text-danger text-center mt-2">
                      {errors.captchaToken}
                    </p>
                  )}
                </div>
              )}

              <button
                type="submit"
                aria-busy={isSubmitting}
                className="w-full h-12 bg-ink-900 text-white font-semibold hover:bg-ink-800 disabled:opacity-50 inline-flex items-center justify-center gap-2 transition-colors rounded-full"
              >
                {isSubmitting ? 'Signing in…' : <>Sign in <ArrowRight className="size-4" /></>}
              </button>
              </fieldset>
            </form>

            <div className="mt-10 grid grid-cols-3 gap-3 pt-6 border-t border-ink-200">
              {[
                { icon: ShieldCheck, label: 'Secure sign-in' },
                { icon: RefreshCw,  label: '7-day returns' },
                { icon: Truck,      label: 'Fast delivery' },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex flex-col items-center text-center gap-1.5">
                  <Icon className="size-4 text-accent-dark" strokeWidth={1.75} />
                  <span className="text-caption text-ink-600 leading-tight">{label}</span>
                </div>
              ))}
            </div>

            <p className="mt-8 text-body text-ink-600 text-center">
              Don&apos;t have an account?{' '}
              <Link href="/register" className="text-accent-dark font-semibold hover:text-ink-900 hover:underline underline-offset-2">
                Register
              </Link>
            </p>
          </div>
        </main>

        <footer className="px-6 py-5 border-t border-ink-200 text-caption text-ink-500 text-center">
          &copy; {new Date().getFullYear()} Sportsmart. All rights reserved.
        </footer>
      </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageContent />
    </Suspense>
  );
}
