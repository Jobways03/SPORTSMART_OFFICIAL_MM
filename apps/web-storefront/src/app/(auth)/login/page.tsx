'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authService } from '@/services/auth.service';
import { ApiError } from '@/lib/api-client';
import { validateLoginEmail, validateLoginPassword } from '@/lib/validators';
import './login.css';

interface FormErrors {
  email?: string;
  password?: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleBlur = (field: string, value: string) => {
    let error: string | null = null;
    if (field === 'email') error = validateLoginEmail(value);
    if (field === 'password') error = validateLoginPassword(value);
    setErrors((prev) => ({ ...prev, [field]: error || undefined }));
  };

  const validateAll = (): boolean => {
    const newErrors: FormErrors = {};
    const emErr = validateLoginEmail(email);
    const pwErr = validateLoginPassword(password);
    if (emErr) newErrors.email = emErr;
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
      const result = await authService.login({
        email: email.trim().toLowerCase(),
        password,
      });

      if (result.data) {
        // Store tokens and user data
        try {
          sessionStorage.setItem('accessToken', result.data.accessToken);
          sessionStorage.setItem('refreshToken', result.data.refreshToken);
          if (result.data.user) {
            sessionStorage.setItem('user', JSON.stringify(result.data.user));
          }
        } catch {
          // Storage unavailable
        }
        router.push('/');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setServerError('Invalid email or password');
        } else if (err.status === 403) {
          setServerError('Account is not active. Please contact support.');
        } else if (err.status === 429) {
          setServerError('Too many login attempts. Please try again later.');
        } else if (err.status === 422 && err.body.errors) {
          const fieldErrors: FormErrors = {};
          for (const e of err.body.errors) {
            (fieldErrors as Record<string, string>)[e.field] = e.message;
          }
          setErrors(fieldErrors);
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
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-logo">SPORTSMART</h1>
          <h2 className="auth-title">Welcome back</h2>
        </div>

        {serverError && (
          <div className="alert alert-error" role="alert">
            {serverError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
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
              disabled={isSubmitting}
              autoComplete="email"
              autoFocus
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
