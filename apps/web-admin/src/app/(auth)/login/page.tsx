'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { adminAuthService } from '@/services/admin-auth.service';
import { ApiError } from '@/lib/api-client';
import './login.css';

interface FormErrors {
  email?: string;
  password?: string;
}

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState('');
  const [serverErrorType, setServerErrorType] = useState<'error' | 'warning' | 'info'>('error');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validate = (): boolean => {
    const newErrors: FormErrors = {};
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      newErrors.email = 'Enter a valid email address';
    }
    if (!password) {
      newErrors.password = 'Password is required';
    } else if (password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError('');

    if (!validate()) return;

    setIsSubmitting(true);

    try {
      const result = await adminAuthService.login({
        email: email.trim().toLowerCase(),
        password,
      });

      if (result.data) {
        try {
          sessionStorage.setItem('adminAccessToken', result.data.accessToken);
          sessionStorage.setItem('adminRefreshToken', result.data.refreshToken);
          sessionStorage.setItem('admin', JSON.stringify(result.data.admin));
        } catch {
          // Storage unavailable
        }
        router.push('/dashboard');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setServerErrorType('error');
          const msg = err.body.message || 'Invalid credentials';
          setServerError(typeof msg === 'string' ? msg : String(msg));
          setPassword('');
        } else if (err.status === 403) {
          setServerErrorType('info');
          setServerError(err.body.message || 'Account is not active');
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
          <p className="auth-badge">SELLER ADMIN</p>
          <h2 className="auth-title">Sign in to seller admin</h2>
        </div>

        {serverError && (
          <div className={alertClass} role="alert">
            {serverError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="email">Email *</label>
            <input
              id="email"
              type="email"
              placeholder="Enter your admin email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'email-error' : undefined}
              disabled={isSubmitting}
              autoComplete="username"
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
          Admin access only. Contact your administrator for credentials.
        </p>
      </div>
    </div>
  );
}
