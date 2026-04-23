'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminAuthService } from '@/services/admin-auth.service';
import { ApiError } from '@/lib/api-client';
import './login.css';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await adminAuthService.login(email, password);
      if (res.data) {
        sessionStorage.setItem('adminAccessToken', res.data.accessToken);
        sessionStorage.setItem('adminRefreshToken', res.data.refreshToken);
        sessionStorage.setItem('admin', JSON.stringify(res.data.admin));
        router.replace('/dashboard');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <main className="login-card" aria-labelledby="login-title">
        <header className="login-header">
          <span className="login-role">
            <span className="login-role-dot" aria-hidden="true" />
            Super Admin
          </span>
          <h1 className="login-brand">SPORTSMART</h1>
          <p className="login-subtitle" id="login-title">
            Sign in to the marketplace control center.
          </p>
        </header>

        {error && (
          <div className="login-error" role="alert">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path
                d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 4.5a.9.9 0 01.9.9v3.6a.9.9 0 11-1.8 0V7.4a.9.9 0 01.9-.9zm0 8.4a1.05 1.05 0 110-2.1 1.05 1.05 0 010 2.1z"
                fill="currentColor"
              />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="login-field">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@sportsmart.com"
              required
            />
          </div>

          <div className="login-field">
            <label htmlFor="login-password">Password</label>
            <div className="login-input-wrap">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
              />
              <button
                type="button"
                className="login-input-toggle"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? (
              <>
                <span className="login-spinner" aria-hidden="true" />
                Signing in
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </form>

        <p className="login-footnote">
          Restricted access. All sign-ins are logged for audit.
        </p>
      </main>
    </div>
  );
}
