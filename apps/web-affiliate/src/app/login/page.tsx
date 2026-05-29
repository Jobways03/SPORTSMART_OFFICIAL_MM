'use client';

import { Suspense, useCallback, useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, ApiError, storeTokens } from '@/lib/api';
import { CaptchaWidget } from '@/components/CaptchaWidget';

const CAPTCHA_REQUIRED =
  (process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER ?? 'disabled').toLowerCase() !==
  'disabled';

/**
 * Affiliate portal login.
 *
 * Phase 22 (2026-05-20) — Audit-driven updates:
 *   • Uses the shared `apiFetch` helper instead of raw fetch so we
 *     pick up cookie credentials + the single-flight refresh logic.
 *   • Captures BOTH access + refresh tokens (the API used to return
 *     only `token`; new shape is `accessToken` + `refreshToken`).
 *   • Surfaces the new EMAIL_NOT_VERIFIED / PENDING_APPROVAL error
 *     codes so PENDING applicants see a friendly message instead of
 *     a generic 403.
 */
function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const justApplied = searchParams.get('applied') === '1';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const onCaptchaToken = useCallback((token: string) => {
    setCaptchaToken(token);
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (CAPTCHA_REQUIRED && !captchaToken) {
      setError('Please complete the captcha challenge.');
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch<{
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
        affiliate: {
          id: string;
          email: string;
          firstName: string;
          lastName: string;
          status: string;
        };
      }>('/affiliate/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          captchaToken: captchaToken || undefined,
        }),
      });
      storeTokens({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      });
      sessionStorage.setItem(
        'affiliateProfile',
        JSON.stringify(data.affiliate),
      );
      router.push('/dashboard');
    } catch (err) {
      // Single-use captcha tokens are burned on the API side; reset
      // the widget on every failed submit so the next attempt has a
      // fresh challenge.
      setCaptchaResetKey((k) => k + 1);
      setCaptchaToken('');
      if (err instanceof ApiError) {
        const code = err.body?.code ?? '';
        if (code === 'AFFILIATE_PENDING_APPROVAL') {
          setError(
            'Your affiliate application is still under review. We will email you once a decision is made.',
          );
        } else if (
          code === 'AFFILIATE_REJECTED' ||
          code === 'AFFILIATE_SUSPENDED'
        ) {
          setError(err.message);
        } else {
          setError(err.message || 'Invalid email or password');
        }
      } else {
        setError('Could not reach the server. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: '100%',
          maxWidth: 400,
          background: '#fff',
          padding: 32,
          borderRadius: 12,
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/SportsMart_Web_Banner.avif"
          alt="SportsMart"
          style={{ height: 48, width: 'auto', display: 'block', marginBottom: 16 }}
        />
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.3px' }}>
          Affiliate sign in
        </h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 24px' }}>
          Use the credentials you signed up with.
        </p>

        {justApplied && !error && (
          <div
            role="status"
            style={{
              padding: '10px 12px',
              marginBottom: 16,
              background: '#f0fdf4',
              border: '1px solid #86efac',
              borderRadius: 8,
              fontSize: 12,
              color: '#166534',
            }}
          >
            Thanks for applying — we will email you once your application has been reviewed. You can sign in here once your account is approved.
          </div>
        )}

        {error && (
          <div
            role="alert"
            style={{
              padding: '10px 12px',
              marginBottom: 16,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 8,
              fontSize: 12,
              color: '#991b1b',
            }}
          >
            {error}
          </div>
        )}

        <label
          style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}
        >
          Email
        </label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
          style={inputStyle}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '14px 0 6px' }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>
            Password
          </label>
          <Link
            href="/forgot-password"
            style={{ fontSize: 12, color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}
          >
            Forgot password?
          </Link>
        </div>
        <div style={{ position: 'relative' }}>
          <input
            type={showPassword ? 'text' : 'password'}
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            style={{ ...inputStyle, paddingRight: 44 }}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            tabIndex={-1}
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              height: '100%',
              width: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#64748b',
              padding: 0,
            }}
          >
            {showPassword ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>

        {CAPTCHA_REQUIRED && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
            <CaptchaWidget onToken={onCaptchaToken} resetKey={captchaResetKey} />
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            marginTop: 20,
            padding: '11px 16px',
            background: loading ? '#93c5fd' : '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 14,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>

        <div style={{ marginTop: 18, fontSize: 12, color: '#64748b', textAlign: 'center' }}>
          New here?{' '}
          <Link href="/register" style={{ color: '#2563eb', fontWeight: 600 }}>
            Apply to become an affiliate
          </Link>
        </div>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageInner />
    </Suspense>
  );
}

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  fontSize: 14,
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box' as const,
};
