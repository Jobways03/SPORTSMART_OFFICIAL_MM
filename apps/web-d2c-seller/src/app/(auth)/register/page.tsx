'use client';

import { useCallback, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { sellerAuthService } from '@/services/auth.service';
import { ApiError } from '@/lib/api-client';
import {
  validateSellerName,
  validateShopName,
  validateEmail,
  validatePhoneNumber,
  validatePassword,
  validateConfirmPassword,
  getPasswordStrength,
  filterPersonName,
  filterBusinessName,
  filterIndianMobile,
} from '@/lib/validators';
import { CaptchaWidget } from '@/components/CaptchaWidget';
import './register.css';

interface FormErrors {
  sellerName?: string;
  sellerShopName?: string;
  email?: string;
  phoneNumber?: string;
  password?: string;
  confirmPassword?: string;
  acceptTerms?: string;
  acceptPrivacy?: string;
  captchaToken?: string;
}

const CAPTCHA_REQUIRED =
  (process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER ?? 'disabled').toLowerCase() !==
  'disabled';

export default function SellerRegisterPage() {
  const router = useRouter();
  const [sellerName, setSellerName] = useState('');
  const [sellerShopName, setSellerShopName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
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
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const onCaptchaToken = useCallback((token: string) => {
    setCaptchaToken(token);
  }, []);

  const validateField = (field: string, value: string): string | null => {
    switch (field) {
      case 'sellerName': return validateSellerName(value);
      case 'sellerShopName': return validateShopName(value);
      case 'email': return validateEmail(value);
      case 'phoneNumber': return validatePhoneNumber(value);
      case 'password': return validatePassword(value);
      default: return null;
    }
  };

  const handleBlur = (field: string, value: string) => {
    if (!value.trim() && field !== 'confirmPassword') {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
      return;
    }
    const error = validateField(field, value);
    setErrors((prev) => ({ ...prev, [field]: error || undefined }));
  };

  const validateAll = (): boolean => {
    const newErrors: FormErrors = {};
    const snErr = validateSellerName(sellerName);
    const shErr = validateShopName(sellerShopName);
    const emErr = validateEmail(email);
    const phErr = validatePhoneNumber(phoneNumber);
    const pwErr = validatePassword(password);
    const cpErr = validateConfirmPassword(password, confirmPassword);

    if (snErr) newErrors.sellerName = snErr;
    if (shErr) newErrors.sellerShopName = shErr;
    if (emErr) newErrors.email = emErr;
    if (phErr) newErrors.phoneNumber = phErr;
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
      const normalizedEmail = email.trim().toLowerCase();
      await sellerAuthService.register({
        sellerName: sellerName.trim(),
        sellerShopName: sellerShopName.trim(),
        email: normalizedEmail,
        phoneNumber: phoneNumber.trim().replace(/\D/g, ''),
        password,
        confirmPassword,
        acceptTerms,
        acceptPrivacy,
        acceptMarketing,
        captchaToken: captchaToken || undefined,
      });
      router.replace(
        `/register/verify?email=${encodeURIComponent(normalizedEmail)}`,
      );
    } catch (err) {
      setCaptchaResetKey((k) => k + 1);
      setCaptchaToken('');
      if (err instanceof ApiError) {
        if (err.status === 422 && err.body.errors) {
          const fieldErrors: FormErrors = {};
          for (const e of err.body.errors) {
            (fieldErrors as Record<string, string>)[e.field] = e.message;
          }
          setErrors(fieldErrors);
        } else if (err.status === 409) {
          setServerError(
            err.message ||
              'An account with this email or phone number already exists. Please sign in instead.',
          );
        } else if (err.status === 429) {
          setServerError('Too many registration attempts. Please try again in a moment.');
        } else if (err.status === 400) {
          setServerError(err.message || 'Please check the form and try again.');
        } else {
          setServerError(err.message || 'Something went wrong. Please try again.');
        }
      } else {
        setServerError('Something went wrong. Please try again.');
      }
      setIsSubmitting(false);
    }
  };

  const strength = getPasswordStrength(password);

  return (
    <div className="auth-page">
      <div className="auth-split">
        {/* Left — branded panel */}
        <aside className="auth-brand">
          <div className="auth-brand-content">
            <div className="auth-brand-logo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/SportsMart_Web_Banner.avif" alt="Sportsmart" />
            </div>
            <h1 className="auth-brand-headline">
              Sell to millions of sports fans across India.
            </h1>
            <p className="auth-brand-text">
              Join the Sportsmart marketplace and turn your sports business into a
              nationwide brand.
            </p>
            <ul className="auth-brand-points">
              <li><span className="tick">✓</span> Fast, transparent payouts</li>
              <li><span className="tick">✓</span> Powerful catalog &amp; inventory tools</li>
              <li><span className="tick">✓</span> Pan-India fulfilment reach</li>
            </ul>
          </div>
        </aside>

        {/* Right — form panel */}
        <div className="auth-form-panel">
          <div className="auth-header">
            <p className="auth-badge">D2C Seller Portal</p>
            <h2 className="auth-title">Create your seller account</h2>
            <p className="auth-subtitle">
              We&apos;ll email you a 6-digit code to verify your address.
            </p>
          </div>

          {serverError && (
            <div className="alert alert-error" role="alert">
              {serverError}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <fieldset disabled={isSubmitting} style={{ border: 0, padding: 0 }}>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="sellerName">Seller Name *</label>
                  <input
                    id="sellerName"
                    type="text"
                    placeholder="Enter your full name"
                    value={sellerName}
                    maxLength={100}
                    onChange={(e) => setSellerName(filterPersonName(e.target.value))}
                    onBlur={() => handleBlur('sellerName', sellerName)}
                    aria-invalid={!!errors.sellerName}
                    aria-describedby={errors.sellerName ? 'sellerName-error' : undefined}
                    autoComplete="name"
                    autoFocus
                  />
                  {errors.sellerName && (
                    <span id="sellerName-error" className="field-error" role="alert">
                      {errors.sellerName}
                    </span>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="sellerShopName">Shop Name *</label>
                  <input
                    id="sellerShopName"
                    type="text"
                    placeholder="Your shop or business name"
                    value={sellerShopName}
                    maxLength={150}
                    onChange={(e) => setSellerShopName(filterBusinessName(e.target.value))}
                    onBlur={() => handleBlur('sellerShopName', sellerShopName)}
                    aria-invalid={!!errors.sellerShopName}
                    aria-describedby={errors.sellerShopName ? 'sellerShopName-error' : undefined}
                    autoComplete="organization"
                  />
                  {errors.sellerShopName && (
                    <span id="sellerShopName-error" className="field-error" role="alert">
                      {errors.sellerShopName}
                    </span>
                  )}
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="email">Email Address *</label>
                  <input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    maxLength={255}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={() => handleBlur('email', email)}
                    aria-invalid={!!errors.email}
                    aria-describedby={errors.email ? 'email-error' : undefined}
                    autoComplete="email"
                  />
                  {errors.email && (
                    <span id="email-error" className="field-error" role="alert">
                      {errors.email}
                    </span>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="phoneNumber">Phone Number *</label>
                  <input
                    id="phoneNumber"
                    type="tel"
                    placeholder="10-digit mobile"
                    value={phoneNumber}
                    maxLength={10}
                    onChange={(e) => setPhoneNumber(filterIndianMobile(e.target.value))}
                    onBlur={() => handleBlur('phoneNumber', phoneNumber)}
                    aria-invalid={!!errors.phoneNumber}
                    aria-describedby={errors.phoneNumber ? 'phoneNumber-error' : undefined}
                    autoComplete="tel"
                  />
                  {errors.phoneNumber && (
                    <span id="phoneNumber-error" className="field-error" role="alert">
                      {errors.phoneNumber}
                    </span>
                  )}
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="password">Password *</label>
                  <div className="password-wrapper">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Create a strong password"
                      value={password}
                      maxLength={128}
                      onChange={(e) => setPassword(e.target.value)}
                      onBlur={() => handleBlur('password', password)}
                      aria-invalid={!!errors.password}
                      aria-describedby="password-strength"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      tabIndex={-1}
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {errors.password && (
                    <span className="field-error" role="alert">
                      {errors.password}
                    </span>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="confirmPassword">Confirm Password *</label>
                  <div className="password-wrapper">
                    <input
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="Re-enter your password"
                      value={confirmPassword}
                      maxLength={128}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      onBlur={() => handleBlur('confirmPassword', confirmPassword)}
                      aria-invalid={!!errors.confirmPassword}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                      tabIndex={-1}
                    >
                      {showConfirmPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {errors.confirmPassword && (
                    <span className="field-error" role="alert">
                      {errors.confirmPassword}
                    </span>
                  )}
                </div>
              </div>

              <div id="password-strength" className="password-strength" aria-live="polite">
                <div className={`rule ${strength.hasMinLength ? 'met' : ''}`}>
                  {strength.hasMinLength ? '✓' : '✗'} At least 8 characters
                </div>
                <div className={`rule ${strength.hasUppercase ? 'met' : ''}`}>
                  {strength.hasUppercase ? '✓' : '✗'} One uppercase letter
                </div>
                <div className={`rule ${strength.hasLowercase ? 'met' : ''}`}>
                  {strength.hasLowercase ? '✓' : '✗'} One lowercase letter
                </div>
                <div className={`rule ${strength.hasDigit ? 'met' : ''}`}>
                  {strength.hasDigit ? '✓' : '✗'} One number
                </div>
                <div className={`rule ${strength.hasSpecial ? 'met' : ''}`}>
                  {strength.hasSpecial ? '✓' : '✗'} One special character
                </div>
              </div>

              <div className="form-group consent-group">
                <label className="consent-row">
                  <input
                    type="checkbox"
                    checked={acceptTerms}
                    onChange={(e) => setAcceptTerms(e.target.checked)}
                    aria-invalid={!!errors.acceptTerms && submitAttempted}
                  />
                  <span>
                    I agree to the{' '}
                    <Link href="/legal/terms" target="_blank" rel="noopener noreferrer">
                      Terms of Service
                    </Link>
                    {' '}*
                  </span>
                </label>
                {errors.acceptTerms && submitAttempted && (
                  <span className="field-error" role="alert">
                    {errors.acceptTerms}
                  </span>
                )}

                <label className="consent-row">
                  <input
                    type="checkbox"
                    checked={acceptPrivacy}
                    onChange={(e) => setAcceptPrivacy(e.target.checked)}
                    aria-invalid={!!errors.acceptPrivacy && submitAttempted}
                  />
                  <span>
                    I agree to the{' '}
                    <Link href="/legal/privacy" target="_blank" rel="noopener noreferrer">
                      Privacy Policy
                    </Link>
                    {' '}*
                  </span>
                </label>
                {errors.acceptPrivacy && submitAttempted && (
                  <span className="field-error" role="alert">
                    {errors.acceptPrivacy}
                  </span>
                )}

                <label className="consent-row">
                  <input
                    type="checkbox"
                    checked={acceptMarketing}
                    onChange={(e) => setAcceptMarketing(e.target.checked)}
                  />
                  <span>Send me product updates and newsletters (optional).</span>
                </label>
              </div>

              {CAPTCHA_REQUIRED && (
                <div className="form-group">
                  <CaptchaWidget onToken={onCaptchaToken} resetKey={captchaResetKey} />
                  {errors.captchaToken && submitAttempted && (
                    <span className="field-error" role="alert">
                      {errors.captchaToken}
                    </span>
                  )}
                </div>
              )}

              <button type="submit" className="btn-submit" aria-busy={isSubmitting}>
                {isSubmitting ? 'Creating Account…' : 'Create Account'}
              </button>
            </fieldset>
          </form>

          <p className="auth-footer">
            Already have an account? <Link href="/login">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
