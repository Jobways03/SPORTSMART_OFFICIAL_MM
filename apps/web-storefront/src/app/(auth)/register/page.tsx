'use client';

import { useCallback, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AuthMobileHeader } from '@/components/auth/AuthMobileHeader';
import {
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  Heart,
  Truck,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { authService } from '@/services/auth.service';
import { ApiError } from '@/lib/api-client';
import {
  validateFirstName,
  validateLastName,
  validateEmail,
  validatePassword,
  validateConfirmPassword,
} from '@/lib/validators';
import { CaptchaWidget } from '@/components/CaptchaWidget';

interface FormErrors {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  password?: string;
  confirmPassword?: string;
  acceptTerms?: string;
  acceptPrivacy?: string;
  captchaToken?: string;
}

const CAPTCHA_REQUIRED =
  (process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER ?? 'disabled').toLowerCase() !==
  'disabled';

export default function RegisterPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [acceptMarketing, setAcceptMarketing] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const onCaptchaToken = useCallback((token: string) => {
    setCaptchaToken(token);
  }, []);

  const validateField = (field: string, value: string): string | null => {
    switch (field) {
      case 'firstName': return validateFirstName(value);
      case 'lastName':  return validateLastName(value);
      case 'email':     return validateEmail(value);
      case 'password':  return validatePassword(value);
      default:          return null;
    }
  };

  const handleBlur = (field: keyof FormErrors, value: string) => {
    if (!value.trim()) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
      return;
    }
    const error = validateField(field, value);
    setErrors((prev) => ({ ...prev, [field]: error || undefined }));
  };

  const validateAll = (): boolean => {
    const newErrors: FormErrors = {};
    const fnErr = validateFirstName(firstName);
    const lnErr = validateLastName(lastName);
    const emErr = validateEmail(email);
    const pwErr = validatePassword(password);
    const cpErr = validateConfirmPassword(password, confirmPassword);
    if (fnErr) newErrors.firstName = fnErr;
    if (lnErr) newErrors.lastName = lnErr;
    if (emErr) newErrors.email = emErr;
    // Phone is optional — but if provided, must be a 10-digit India
    // mobile starting with 6/7/8/9 (matches backend DTO regex).
    if (phone && !/^[6-9]\d{9}$/.test(phone)) {
      newErrors.phone =
        'Enter a 10-digit Indian mobile starting with 6, 7, 8, or 9';
    }
    if (pwErr) newErrors.password = pwErr;
    if (cpErr) newErrors.confirmPassword = cpErr;
    if (!acceptTerms) newErrors.acceptTerms = 'You must agree to the Terms of Service';
    if (!acceptPrivacy) newErrors.acceptPrivacy = 'You must agree to the Privacy Policy';
    if (CAPTCHA_REQUIRED && !captchaToken) {
      newErrors.captchaToken = 'Please complete the captcha';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError('');
    setSubmitAttempted(true);
    if (!validateAll()) {
      const firstErrorField = document.querySelector('[aria-invalid="true"]') as HTMLElement;
      firstErrorField?.focus();
      return;
    }
    setIsSubmitting(true);
    try {
      await authService.register({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim() || undefined,
        password,
        confirmPassword,
        acceptTerms,
        acceptPrivacy,
        acceptMarketing,
        captchaToken: captchaToken || undefined,
      });
      setIsSuccess(true);
      // Redirect immediately to the verify page — the API has already
      // dispatched (or absorbed) the OTP email. The verify page
      // accepts ?email=... so the user doesn't have to retype it.
      router.replace(`/register/verify?email=${encodeURIComponent(email.trim().toLowerCase())}`);
    } catch (err) {
      // Force a fresh captcha challenge on every failed submit —
      // Turnstile / hCaptcha tokens are single-use, so a 4xx without
      // resetting would leave the form unsubmittable.
      setCaptchaResetKey((k) => k + 1);
      setCaptchaToken('');
      if (err instanceof ApiError) {
        if (err.status === 422 && err.body.errors) {
          const fieldErrors: FormErrors = {};
          for (const e of err.body.errors) {
            if (!(e.field in fieldErrors)) {
              (fieldErrors as Record<string, string>)[e.field] = e.message;
            }
          }
          setErrors(fieldErrors);
        } else if (err.status === 400) {
          setServerError(err.message || 'Please check the form and try again.');
        } else if (err.status === 429) {
          setServerError('Too many registration attempts. Please try again in a moment.');
        } else {
          setServerError(err.message || 'Something went wrong. Please try again.');
        }
      } else {
        setServerError('Something went wrong. Please try again.');
      }
      setIsSubmitting(false);
    }
  };

  const showErr = (field: keyof FormErrors, value: string) =>
    errors[field] && (submitAttempted || value.trim()) ? errors[field] : undefined;

  const inputClass = (hasError: boolean) =>
    `w-full h-12 px-4 border bg-white text-body-lg placeholder:text-ink-400 focus:outline-none transition-colors rounded-full ${
      hasError
        ? 'border-danger focus:border-danger'
        : 'border-ink-300 hover:border-ink-500 focus:border-ink-900'
    }`;

  const eFirstName        = showErr('firstName', firstName);
  const ePhone            = showErr('phone', phone);
  const eLastName         = showErr('lastName', lastName);
  const eEmail            = showErr('email', email);
  const ePassword         = showErr('password', password);
  const eConfirmPassword  = showErr('confirmPassword', confirmPassword);

  return (
    <div className="min-h-screen bg-ink-50 flex justify-center">
      <div className="w-full max-w-[1320px] min-h-screen grid lg:grid-cols-2">
      {/* Brand panel */}
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
              Join the
              <br />
              <span className="font-brush text-sale text-[0.85em] tracking-normal">
                marketplace.
              </span>
            </h2>
            <p className="mt-6 text-body-lg text-ink-700 max-w-md">
              200+ brands. 500+ verified sellers. Free shipping over ₹999.
              Sign up to track orders, save addresses, and unlock early sale access.
            </p>

            <ul className="mt-10 grid sm:grid-cols-2 gap-3 max-w-lg">
              {[
                { icon: RefreshCw, title: 'Free 7-day returns', desc: 'No-questions easy returns' },
                { icon: Heart, title: 'Wishlist & saved addresses', desc: 'One-tap repeat orders' },
                { icon: Truck, title: 'Free shipping over ₹999', desc: 'Across 19,000+ pincodes' },
                { icon: ShieldCheck, title: '100% authentic gear', desc: 'Direct from brand sellers' },
              ].map(({ icon: Icon, title, desc }) => (
                <li
                  key={title}
                  className="bg-white border border-ink-900/10 p-3"
                >
                  <Icon className="size-4 text-accent-dark" strokeWidth={1.75} />
                  <div className="mt-2 text-body font-semibold text-ink-900">
                    {title}
                  </div>
                  <div className="text-caption text-ink-600">{desc}</div>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-3 gap-4 max-w-lg">
            {[
              { v: '50k+', l: 'Happy buyers' },
              { v: '200+', l: 'Brands' },
              { v: '4.7/5', l: 'Average rating' },
            ].map((s) => (
              <div key={s.l} className="border-l-2 border-ink-900/15 pl-3">
                <div className="font-display text-h3 text-ink-900 leading-none tabular">
                  {s.v}
                </div>
                <div className="mt-1 text-caption uppercase tracking-[0.18em] text-ink-600">
                  {s.l}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex flex-col">
        <AuthMobileHeader switchPrompt="Already have an account?" switchLabel="Sign in" switchHref="/login" />

        <main className="flex-1 px-6 lg:px-10 pt-6 lg:pt-8 pb-10">
          <div className="w-full max-w-md mx-auto">
            <h1 className="font-display text-2xl sm:text-3xl text-ink-900 leading-tight">Create account</h1>
            <p className="mt-3 text-body-lg text-ink-600">
              We&apos;ll send a 6-digit code to verify your email.
            </p>

            {isSuccess && (
              <div role="alert" className="mt-6 flex items-start gap-2 p-3 border border-success/30 bg-green-50 text-success text-body">
                <CheckCircle2 className="size-4 mt-0.5 shrink-0" />
                Account created. Sending you to verify your email…
              </div>
            )}
            {serverError && (
              <div role="alert" className="mt-6 flex items-start gap-2 p-3 border border-danger/30 bg-red-50 text-danger text-body rounded-2xl">
                <AlertCircle className="size-4 mt-0.5 shrink-0" />
                {serverError}
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="mt-7 space-y-4">
              <fieldset disabled={isSubmitting || isSuccess} className="space-y-4 border-0 p-0">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="firstName" className="block text-caption uppercase tracking-wider font-semibold text-ink-700 mb-2">
                    First name
                  </label>
                  <input
                    id="firstName"
                    type="text"
                    placeholder="Riya"
                    value={firstName}
                    maxLength={50}
                    onChange={(e) => setFirstName(e.target.value.replace(/[^A-Za-z .'-]/g, ''))}
                    onBlur={() => handleBlur('firstName', firstName)}
                    aria-invalid={!!eFirstName}
                    autoComplete="given-name"
                    className={inputClass(!!eFirstName)}
                  />
                  {eFirstName && (
                    <p role="alert" className="mt-1.5 text-caption text-danger">{eFirstName}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="lastName" className="block text-caption uppercase tracking-wider font-semibold text-ink-700 mb-2">
                    Last name
                  </label>
                  <input
                    id="lastName"
                    type="text"
                    placeholder="Sharma"
                    value={lastName}
                    maxLength={50}
                    onChange={(e) => setLastName(e.target.value.replace(/[^A-Za-z .'-]/g, ''))}
                    onBlur={() => handleBlur('lastName', lastName)}
                    aria-invalid={!!eLastName}
                    autoComplete="family-name"
                    className={inputClass(!!eLastName)}
                  />
                  {eLastName && (
                    <p role="alert" className="mt-1.5 text-caption text-danger">{eLastName}</p>
                  )}
                </div>
              </div>

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
                  aria-invalid={!!eEmail}
                  autoComplete="email"
                  className={inputClass(!!eEmail)}
                />
                {eEmail && (
                  <p role="alert" className="mt-1.5 text-caption text-danger flex items-center gap-1">
                    <AlertCircle className="size-3" /> {eEmail}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="phone" className="block text-caption uppercase tracking-wider font-semibold text-ink-700 mb-2">
                  Phone Number <span className="text-ink-500 normal-case font-normal">(optional)</span>
                </label>
                <input
                  id="phone"
                  type="tel"
                  placeholder="10-digit Indian mobile starting with 6, 7, 8, or 9"
                  value={phone}
                  inputMode="numeric"
                  maxLength={10}
                  onChange={(e) => {
                    // Strip non-digits, strip a leading 91 if pasted with country code,
                    // refuse leading 0-5, cap at 10 digits.
                    let next = e.target.value.replace(/\D/g, '');
                    if (next.startsWith('91') && next.length > 10) {
                      next = next.slice(2);
                    }
                    next = next.replace(/^[0-5]+/, '');
                    next = next.slice(0, 10);
                    setPhone(next);
                  }}
                  onKeyDown={(e) => {
                    if (['e', 'E', '+', '-', '.', ' '].includes(e.key)) {
                      e.preventDefault();
                    }
                  }}
                  aria-invalid={!!ePhone}
                  autoComplete="tel"
                  pattern="[6-9][0-9]{9}"
                  className={inputClass(!!ePhone)}
                />
                {ePhone && (
                  <p role="alert" className="mt-1.5 text-caption text-danger flex items-center gap-1">
                    <AlertCircle className="size-3" /> {ePhone}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="password" className="block text-caption uppercase tracking-wider font-semibold text-ink-700 mb-2">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Min. 8 characters"
                    value={password}
                    maxLength={128}
                    onChange={(e) => setPassword(e.target.value)}
                    onBlur={() => handleBlur('password', password)}
                    aria-invalid={!!ePassword}
                    autoComplete="new-password"
                    className={`${inputClass(!!ePassword)} pr-12`}
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
                {ePassword ? (
                  <p role="alert" className="mt-1.5 text-caption text-danger flex items-center gap-1">
                    <AlertCircle className="size-3" /> {ePassword}
                  </p>
                ) : (
                  <p className="mt-1.5 text-caption text-ink-500">
                    At least 8 chars with upper-, lower-case, number and special character.
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-caption uppercase tracking-wider font-semibold text-ink-700 mb-2">
                  Confirm password
                </label>
                <div className="relative">
                  <input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="Re-enter password"
                    value={confirmPassword}
                    maxLength={128}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    aria-invalid={!!eConfirmPassword}
                    autoComplete="new-password"
                    className={`${inputClass(!!eConfirmPassword)} pr-12`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                    tabIndex={-1}
                    className="absolute right-2 top-1/2 -translate-y-1/2 size-8 grid place-items-center text-ink-500 hover:text-ink-900"
                  >
                    {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {eConfirmPassword && (
                  <p role="alert" className="mt-1.5 text-caption text-danger flex items-center gap-1">
                    <AlertCircle className="size-3" /> {eConfirmPassword}
                  </p>
                )}
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-start gap-2 text-body text-ink-700">
                  <input
                    type="checkbox"
                    checked={acceptTerms}
                    onChange={(e) => setAcceptTerms(e.target.checked)}
                    aria-invalid={!!errors.acceptTerms && submitAttempted}
                    className="mt-1 size-4 accent-ink-900"
                  />
                  <span>
                    I agree to the{' '}
                    <Link href="/legal/terms" className="text-ink-900 underline hover:text-accent-dark" target="_blank">
                      Terms of Service
                    </Link>
                    <span className="text-danger">*</span>
                  </span>
                </label>
                {errors.acceptTerms && submitAttempted && (
                  <p role="alert" className="text-caption text-danger ml-6">{errors.acceptTerms}</p>
                )}

                <label className="flex items-start gap-2 text-body text-ink-700">
                  <input
                    type="checkbox"
                    checked={acceptPrivacy}
                    onChange={(e) => setAcceptPrivacy(e.target.checked)}
                    aria-invalid={!!errors.acceptPrivacy && submitAttempted}
                    className="mt-1 size-4 accent-ink-900"
                  />
                  <span>
                    I agree to the{' '}
                    <Link href="/legal/privacy" className="text-ink-900 underline hover:text-accent-dark" target="_blank">
                      Privacy Policy
                    </Link>
                    <span className="text-danger">*</span>
                  </span>
                </label>
                {errors.acceptPrivacy && submitAttempted && (
                  <p role="alert" className="text-caption text-danger ml-6">{errors.acceptPrivacy}</p>
                )}

                <label className="flex items-start gap-2 text-body text-ink-700">
                  <input
                    type="checkbox"
                    checked={acceptMarketing}
                    onChange={(e) => setAcceptMarketing(e.target.checked)}
                    className="mt-1 size-4 accent-ink-900"
                  />
                  <span className="text-ink-600">
                    Send me deals, drop alerts and newsletters (optional).
                  </span>
                </label>
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
                {isSubmitting ? 'Creating account…' : <>Create account <ArrowRight className="size-4" /></>}
              </button>
              </fieldset>
            </form>

            <div className="mt-8 grid grid-cols-3 gap-3 pt-6 border-t border-ink-200">
              {[
                { icon: ShieldCheck, label: 'Privacy first' },
                { icon: RefreshCw,  label: '7-day returns' },
                { icon: Truck,      label: 'Fast delivery' },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex flex-col items-center text-center gap-1.5">
                  <Icon className="size-4 text-accent-dark" strokeWidth={1.75} />
                  <span className="text-caption text-ink-600 leading-tight">{label}</span>
                </div>
              ))}
            </div>
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
