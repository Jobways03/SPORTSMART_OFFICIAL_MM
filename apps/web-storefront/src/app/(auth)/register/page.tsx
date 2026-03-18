'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authService } from '@/services/auth.service';
import { ApiError } from '@/lib/api-client';
import {
  validateFirstName,
  validateLastName,
  validateEmail,
  validatePassword,
} from '@/lib/validators';
import './register.css';

interface FormErrors {
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
}

export default function RegisterPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const validateField = (field: string, value: string): string | null => {
    switch (field) {
      case 'firstName': return validateFirstName(value);
      case 'lastName': return validateLastName(value);
      case 'email': return validateEmail(value);
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
    const fnErr = validateFirstName(firstName);
    const lnErr = validateLastName(lastName);
    const emErr = validateEmail(email);
    const pwErr = validatePassword(password);

    if (fnErr) newErrors.firstName = fnErr;
    if (lnErr) newErrors.lastName = lnErr;
    if (emErr) newErrors.email = emErr;
    if (pwErr) newErrors.password = pwErr;

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError('');

    if (!validateAll()) {
      // Focus first error field
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
        password,
      });

      setIsSuccess(true);
      setTimeout(() => router.push('/login'), 1500);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setErrors((prev) => ({ ...prev, email: 'An account with this email already exists' }));
        } else if (err.status === 422 && err.body.errors) {
          const fieldErrors: FormErrors = {};
          for (const e of err.body.errors) {
            if (e.field in fieldErrors === false) {
              (fieldErrors as Record<string, string>)[e.field] = e.message;
            }
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

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-logo">SPORTSMART</h1>
          <h2 className="auth-title">Create your account</h2>
        </div>

        {isSuccess && (
          <div className="alert alert-success" role="alert">
            Account created successfully! Redirecting to login...
          </div>
        )}

        {serverError && (
          <div className="alert alert-error" role="alert">
            {serverError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="firstName">First Name *</label>
              <input
                id="firstName"
                type="text"
                placeholder="Enter your first name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                onBlur={() => handleBlur('firstName', firstName)}
                aria-invalid={!!errors.firstName}
                aria-describedby={errors.firstName ? 'firstName-error' : undefined}
                disabled={isSubmitting || isSuccess}
                autoComplete="given-name"
              />
              {errors.firstName && (
                <span id="firstName-error" className="field-error" role="alert">
                  {errors.firstName}
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="lastName">Last Name *</label>
              <input
                id="lastName"
                type="text"
                placeholder="Enter your last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                onBlur={() => handleBlur('lastName', lastName)}
                aria-invalid={!!errors.lastName}
                aria-describedby={errors.lastName ? 'lastName-error' : undefined}
                disabled={isSubmitting || isSuccess}
                autoComplete="family-name"
              />
              {errors.lastName && (
                <span id="lastName-error" className="field-error" role="alert">
                  {errors.lastName}
                </span>
              )}
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="email">Email *</label>
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
            <label htmlFor="password">Password *</label>
            <div className="password-wrapper">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Min. 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => handleBlur('password', password)}
                aria-invalid={!!errors.password}
                aria-describedby={errors.password ? 'password-error' : undefined}
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
              <span id="password-error" className="field-error" role="alert">
                {errors.password}
              </span>
            )}
          </div>

          <button
            type="submit"
            className="btn-submit"
            disabled={isSubmitting || isSuccess}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="auth-footer">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
