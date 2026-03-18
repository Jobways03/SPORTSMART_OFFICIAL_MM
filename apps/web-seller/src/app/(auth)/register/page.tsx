'use client';

import { useState, FormEvent } from 'react';
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
  getPasswordStrength,
} from '@/lib/validators';
import './register.css';

interface FormErrors {
  sellerName?: string;
  sellerShopName?: string;
  email?: string;
  phoneNumber?: string;
  password?: string;
}

export default function SellerRegisterPage() {
  const router = useRouter();
  const [sellerName, setSellerName] = useState('');
  const [sellerShopName, setSellerShopName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

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

    if (snErr) newErrors.sellerName = snErr;
    if (shErr) newErrors.sellerShopName = shErr;
    if (emErr) newErrors.email = emErr;
    if (phErr) newErrors.phoneNumber = phErr;
    if (pwErr) newErrors.password = pwErr;

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError('');

    if (!validateAll()) {
      const firstErrorField = document.querySelector('[aria-invalid="true"]') as HTMLElement;
      firstErrorField?.focus();
      return;
    }

    setIsSubmitting(true);

    try {
      await sellerAuthService.register({
        sellerName: sellerName.trim(),
        sellerShopName: sellerShopName.trim(),
        email: email.trim().toLowerCase(),
        phoneNumber: phoneNumber.trim().replace(/\D/g, ''),
        password,
      });

      setIsSuccess(true);
      setTimeout(() => router.push('/login'), 2000);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          const msg = err.body.message || '';
          if (msg.toLowerCase().includes('phone')) {
            setErrors((prev) => ({
              ...prev,
              phoneNumber: 'An account with this phone number already exists',
            }));
          } else {
            setErrors((prev) => ({
              ...prev,
              email: 'An account with this email already exists',
            }));
          }
        } else if (err.status === 422 && err.body.errors) {
          const fieldErrors: FormErrors = {};
          for (const e of err.body.errors) {
            (fieldErrors as Record<string, string>)[e.field] = e.message;
          }
          setErrors(fieldErrors);
        } else {
          setServerError(err.message || 'Something went wrong. Please try again.');
        }
      } else {
        setServerError('Something went wrong. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const strength = getPasswordStrength(password);

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-logo">SPORTSMART</h1>
          <p className="auth-badge">Seller Portal</p>
          <h2 className="auth-title">Create your seller account</h2>
          <p className="auth-subtitle">
            Join the marketplace and start selling sports products
          </p>
        </div>

        {isSuccess && (
          <div className="alert alert-success" role="status">
            Account created successfully! Your account is pending admin approval.
            Redirecting to login...
          </div>
        )}

        {serverError && (
          <div className="alert alert-error" role="alert">
            {serverError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="sellerName">Seller Name *</label>
            <input
              id="sellerName"
              type="text"
              placeholder="Enter your full name"
              value={sellerName}
              onChange={(e) => setSellerName(e.target.value)}
              onBlur={() => handleBlur('sellerName', sellerName)}
              aria-invalid={!!errors.sellerName}
              aria-describedby={errors.sellerName ? 'sellerName-error' : undefined}
              disabled={isSubmitting || isSuccess}
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
              placeholder="Enter your shop or business name"
              value={sellerShopName}
              onChange={(e) => setSellerShopName(e.target.value)}
              onBlur={() => handleBlur('sellerShopName', sellerShopName)}
              aria-invalid={!!errors.sellerShopName}
              aria-describedby={errors.sellerShopName ? 'sellerShopName-error' : undefined}
              disabled={isSubmitting || isSuccess}
              autoComplete="organization"
            />
            {errors.sellerShopName && (
              <span id="sellerShopName-error" className="field-error" role="alert">
                {errors.sellerShopName}
              </span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="email">Email Address *</label>
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => handleBlur('email', email)}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'email-error' : undefined}
              disabled={isSubmitting || isSuccess}
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
              placeholder="Enter your phone number"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              onBlur={() => handleBlur('phoneNumber', phoneNumber)}
              aria-invalid={!!errors.phoneNumber}
              aria-describedby={errors.phoneNumber ? 'phoneNumber-error' : undefined}
              disabled={isSubmitting || isSuccess}
              autoComplete="tel"
            />
            {errors.phoneNumber && (
              <span id="phoneNumber-error" className="field-error" role="alert">
                {errors.phoneNumber}
              </span>
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
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => handleBlur('password', password)}
                aria-invalid={!!errors.password}
                aria-describedby="password-strength"
                disabled={isSubmitting || isSuccess}
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
            <div id="password-strength" className="password-strength" aria-live="polite">
              <div className={`rule ${strength.hasMinLength ? 'met' : ''}`}>
                {strength.hasMinLength ? '\u2713' : '\u2717'} At least 8 characters
              </div>
              <div className={`rule ${strength.hasUppercase ? 'met' : ''}`}>
                {strength.hasUppercase ? '\u2713' : '\u2717'} One uppercase letter
              </div>
              <div className={`rule ${strength.hasLowercase ? 'met' : ''}`}>
                {strength.hasLowercase ? '\u2713' : '\u2717'} One lowercase letter
              </div>
              <div className={`rule ${strength.hasDigit ? 'met' : ''}`}>
                {strength.hasDigit ? '\u2713' : '\u2717'} One number
              </div>
              <div className={`rule ${strength.hasSpecial ? 'met' : ''}`}>
                {strength.hasSpecial ? '\u2713' : '\u2717'} One special character
              </div>
            </div>
          </div>

          <button
            type="submit"
            className="btn-submit"
            disabled={isSubmitting || isSuccess}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? 'Creating Account...' : 'Create Account'}
          </button>
        </form>

        <p className="auth-footer">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
