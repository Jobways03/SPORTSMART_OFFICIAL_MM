'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

/**
 * Affiliate portal login. POSTs to /api/v1/affiliate/auth/login,
 * stores the returned JWT in sessionStorage, and redirects to the
 * dashboard.
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const apiBase =
        process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
      const res = await fetch(`${apiBase}/affiliate/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.message || 'Invalid email or password');
        return;
      }
      // Stash the token. Same pattern as the franchise/seller portals.
      sessionStorage.setItem('affiliateToken', body.data.token);
      sessionStorage.setItem(
        'affiliateProfile',
        JSON.stringify(body.data.affiliate),
      );
      router.push('/dashboard');
    } catch {
      setError('Could not reach the server. Please try again.');
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
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.3px' }}>
          Affiliate sign in
        </h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 24px' }}>
          Use the credentials you signed up with.
        </p>

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
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
          style={inputStyle}
        />

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
