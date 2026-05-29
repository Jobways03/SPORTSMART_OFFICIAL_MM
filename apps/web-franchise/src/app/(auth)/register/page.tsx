'use client';

import { useCallback, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { franchiseAuthService } from '@/services/auth.service';
import { ApiError } from '@/lib/api-client';
import {
  validateOwnerName,
  validateBusinessName,
  validateEmail,
  validatePhoneNumber,
  validatePassword,
  validateConfirmPassword,
  getPasswordStrength,
} from '@/lib/validators';
import { CaptchaWidget } from '@/components/CaptchaWidget';
import '../auth.css';

interface FormErrors {
  ownerName?: string;
  businessName?: string;
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

export default function FranchiseRegisterPage() {
  const router = useRouter();
  const [ownerName, setOwnerName] = useState('');
  const [businessName, setBusinessName] = useState('');
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
      case 'ownerName': return validateOwnerName(value);
      case 'businessName': return validateBusinessName(value);
      case 'email': return validateEmail(value);
      case 'phoneNumber': return validatePhoneNumber(value);
      case 'password': return validatePassword(value);
      default: return null;
    }
  };

  const handleBlur = (field: string, value: string) => {
    const error = validateField(field, value);
    setErrors((prev) => ({ ...prev, [field]: error || undefined }));
  };

  const validateAll = (): boolean => {
    const newErrors: FormErrors = {};
    const onErr = validateOwnerName(ownerName);
    const bnErr = validateBusinessName(businessName);
    const emErr = validateEmail(email);
    const phErr = validatePhoneNumber(phoneNumber);
    const pwErr = validatePassword(password);
    const cpErr = validateConfirmPassword(password, confirmPassword);

    if (onErr) newErrors.ownerName = onErr;
    if (bnErr) newErrors.businessName = bnErr;
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
      await franchiseAuthService.register({
        ownerName: ownerName.trim(),
        businessName: businessName.trim(),
        email: normalizedEmail,
        phoneNumber: phoneNumber.trim().replace(/\D/g, ''),
        password,
        confirmPassword,
        acceptTerms,
        acceptPrivacy,
        acceptMarketing,
        captchaToken: captchaToken || undefined,
      });
      router.replace(`/register/verify?email=${encodeURIComponent(normalizedEmail)}`);
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
      <div className="auth-card auth-card-wide">
        <div className="auth-header">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/SportsMart_Web_Banner.avif"
            alt="SportsMart"
            className="auth-logo"
            style={{ height: 56, width: 'auto', display: 'block' }}
          />
          <p className="auth-badge">Franchise Portal</p>
          <h2 className="auth-title">Create your franchise account</h2>
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
          <div className="form-group">
            <label htmlFor="ownerName">Owner Name *</label>
            <input
              id="ownerName"
              type="text"
              placeholder="Enter the owner's full name"
              value={ownerName}
              maxLength={100}
              onChange={(e) => setOwnerName(e.target.value)}
              onBlur={() => handleBlur('ownerName', ownerName)}
              aria-invalid={!!errors.ownerName}
              autoComplete="name"
              autoFocus
            />
            {errors.ownerName && (
              <span className="field-error" role="alert">{errors.ownerName}</span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="businessName">Business Name *</label>
            <input
              id="businessName"
              type="text"
              placeholder="Enter your business or franchise name"
              value={businessName}
              maxLength={150}
              onChange={(e) => setBusinessName(e.target.value)}
              onBlur={() => handleBlur('businessName', businessName)}
              aria-invalid={!!errors.businessName}
              autoComplete="organization"
            />
            {errors.businessName && (
              <span className="field-error" role="alert">{errors.businessName}</span>
            )}
          </div>

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
              autoComplete="email"
            />
            {errors.email && (
              <span className="field-error" role="alert">{errors.email}</span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="phoneNumber">Phone Number *</label>
            <input
              id="phoneNumber"
              type="tel"
              placeholder="10-digit mobile starting with 6, 7, 8, or 9"
              value={phoneNumber}
              onChange={(e) => {
                let next = e.target.value.replace(/\D/g, '');
                next = next.replace(/^[0-5]+/, '');
                next = next.slice(0, 10);
                setPhoneNumber(next);
              }}
              onKeyDown={(e) => {
                if (['e', 'E', '+', '-', '.', ' '].includes(e.key)) {
                  e.preventDefault();
                }
              }}
              onBlur={() => handleBlur('phoneNumber', phoneNumber)}
              inputMode="numeric"
              pattern="[6-9][0-9]{9}"
              maxLength={10}
              aria-invalid={!!errors.phoneNumber}
              autoComplete="tel"
            />
            {errors.phoneNumber && (
              <span className="field-error" role="alert">{errors.phoneNumber}</span>
            )}
          </div>

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
              <span className="field-error" role="alert">{errors.password}</span>
            )}
            <div className="password-strength" aria-live="polite">
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
              <span className="field-error" role="alert">{errors.confirmPassword}</span>
            )}
          </div>

          <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, fontWeight: 400 }}>
              <input
                type="checkbox"
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
                aria-invalid={!!errors.acceptTerms && submitAttempted}
                style={{ marginTop: 3 }}
              />
              <span>
                I agree to the{' '}
                <Link href="/legal/terms" target="_blank">Terms of Service</Link> *
              </span>
            </label>
            {errors.acceptTerms && submitAttempted && (
              <span className="field-error" role="alert">{errors.acceptTerms}</span>
            )}

            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, fontWeight: 400 }}>
              <input
                type="checkbox"
                checked={acceptPrivacy}
                onChange={(e) => setAcceptPrivacy(e.target.checked)}
                aria-invalid={!!errors.acceptPrivacy && submitAttempted}
                style={{ marginTop: 3 }}
              />
              <span>
                I agree to the{' '}
                <Link href="/legal/privacy" target="_blank">Privacy Policy</Link> *
              </span>
            </label>
            {errors.acceptPrivacy && submitAttempted && (
              <span className="field-error" role="alert">{errors.acceptPrivacy}</span>
            )}

            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, fontWeight: 400 }}>
              <input
                type="checkbox"
                checked={acceptMarketing}
                onChange={(e) => setAcceptMarketing(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span style={{ color: '#64748b' }}>
                Send me product updates (optional).
              </span>
            </label>
          </div>

          {CAPTCHA_REQUIRED && (
            <div className="form-group">
              <CaptchaWidget onToken={onCaptchaToken} resetKey={captchaResetKey} />
              {errors.captchaToken && submitAttempted && (
                <span className="field-error" role="alert">{errors.captchaToken}</span>
              )}
            </div>
          )}

          <button
            type="submit"
            className="btn-submit"
            aria-busy={isSubmitting}
          >
            {isSubmitting ? 'Creating Account…' : 'Create Account'}
          </button>
          </fieldset>
        </form>

        <p className="auth-footer">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
