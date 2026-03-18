'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { sellerAuthService } from '@/services/auth.service';
import { ApiError } from '@/lib/api-client';
import { validateIdentifier, validateLoginPassword } from '@/lib/validators';
import './login.css';

interface FormErrors {
  identifier?: string;
  password?: string;
}

export default function SellerLoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState('');
  const [serverErrorType, setServerErrorType] = useState<'error' | 'warning' | 'info'>('error');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleBlur = (field: string, value: string) => {
    let error: string | null = null;
    if (field === 'identifier') error = validateIdentifier(value);
    if (field === 'password') error = validateLoginPassword(value);
    setErrors((prev) => ({ ...prev, [field]: error || undefined }));
  };

  const validateAll = (): boolean => {
    const newErrors: FormErrors = {};
    const idErr = validateIdentifier(identifier);
    const pwErr = validateLoginPassword(password);
    if (idErr) newErrors.identifier = idErr;
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
      const trimmedIdentifier = identifier.trim();
      const normalizedIdentifier = trimmedIdentifier.includes('@')
        ? trimmedIdentifier.toLowerCase()
        : trimmedIdentifier;

      const result = await sellerAuthService.login({
        identifier: normalizedIdentifier,
        password,
      });

      if (result.data) {
        try {
          sessionStorage.setItem('accessToken', result.data.accessToken);
          sessionStorage.setItem('refreshToken', result.data.refreshToken);
          sessionStorage.setItem('seller', JSON.stringify(result.data.seller));
        } catch {
          // Storage unavailable
        }
        router.push('/dashboard');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setServerErrorType('error');
          setServerError('Invalid email/phone number or password');
          setPassword('');
        } else if (err.status === 403) {
          setServerErrorType('info');
          setServerError(
            'Your account is pending admin approval. You will be able to sign in once your account is approved.',
          );
        } else if (err.status === 429) {
          setServerErrorType('warning');
          const msg = err.body.message || 'Too many failed attempts. Please try again later.';
          setServerError(typeof msg === 'string' ? msg : Array.isArray(msg) ? msg[0] : String(msg));
        } else if (err.status === 422 && err.body.errors) {
          const fieldErrors: FormErrors = {};
          for (const e of err.body.errors) {
            (fieldErrors as Record<string, string>)[e.field] = e.message;
          }
          setErrors(fieldErrors);
        } else {
          setServerErrorType('error');
          setServerError('Something went wrong. Please try again.');
        }
      } else {
        setServerErrorType('error');
        setServerError('Something went wrong. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const alertClass =
    serverErrorType === 'warning'
      ? 'alert alert-warning'
      : serverErrorType === 'info'
        ? 'alert alert-info'
        : 'alert alert-error';

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-logo">SPORTSMART</h1>
          <p className="auth-badge">Seller Portal</p>
          <h2 className="auth-title">Sign in to your account</h2>
        </div>

        {serverError && (
          <div className={alertClass} role="alert">
            {serverError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="identifier">Email or Phone Number *</label>
            <input
              id="identifier"
              type="text"
              placeholder="Enter your email or phone number"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              onBlur={() => handleBlur('identifier', identifier)}
              aria-invalid={!!errors.identifier}
              aria-describedby={errors.identifier ? 'identifier-error' : undefined}
              disabled={isSubmitting}
              autoComplete="username"
              autoFocus
            />
            {errors.identifier && (
              <span id="identifier-error" className="field-error" role="alert">
                {errors.identifier}
              </span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="password">Password *</label>
            <div className="password-wrapper">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => handleBlur('password', password)}
                aria-invalid={!!errors.password}
                aria-describedby={errors.password ? 'password-error' : undefined}
                disabled={isSubmitting}
                autoComplete="current-password"
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

          <div style={{ textAlign: 'right', marginTop: 4, marginBottom: 8 }}>
            <Link href="/forgot-password" style={{ fontSize: 13, color: 'var(--color-primary)' }}>
              Forgot password?
            </Link>
          </div>

          <button
            type="submit"
            className="btn-submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="auth-footer">
          Don&apos;t have an account? <Link href="/register">Register</Link>
        </p>
      </div>
    </div>
  );
}
