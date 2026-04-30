'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

/**
 * Affiliate registration form. Submits an application — admin must
 * approve before the account becomes ACTIVE. Mirrors the SRS §5.1
 * registration fields.
 */
export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    websiteUrl: '',
    socialHandle: '',
    joinReason: '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const update = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const apiBase =
        process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
      const payload: any = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        password: form.password,
      };
      payload.phone = form.phone.trim();
      if (form.websiteUrl.trim()) payload.websiteUrl = form.websiteUrl.trim();
      if (form.socialHandle.trim()) payload.socialHandle = form.socialHandle.trim();
      if (form.joinReason.trim()) payload.joinReason = form.joinReason.trim();

      const res = await fetch(`${apiBase}/affiliate/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.message || 'Could not submit your application.');
        return;
      }
      setSuccess(true);
      setTimeout(() => router.push('/login'), 2500);
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <main style={pageStyle}>
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          <div
            style={{
              fontSize: 40,
              marginBottom: 12,
              color: '#16a34a',
            }}
            aria-hidden
          >
            ✓
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>
            Application submitted
          </h1>
          <p style={{ fontSize: 14, color: '#64748b', margin: 0, lineHeight: 1.5 }}>
            We&rsquo;ll review your application and email you when it&rsquo;s
            approved. Redirecting to sign-in…
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <form onSubmit={handleSubmit} style={cardStyle}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.3px' }}>
          Apply as affiliate
        </h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 20px' }}>
          Fill in your details. We review every application personally.
        </p>

        {error && (
          <div role="alert" style={errorStyle}>
            {error}
          </div>
        )}

        <Row>
          <Field label="First name" required>
            <input
              type="text"
              required
              value={form.firstName}
              onChange={update('firstName')}
              disabled={loading}
              style={inputStyle}
            />
          </Field>
          <Field label="Last name" required>
            <input
              type="text"
              required
              value={form.lastName}
              onChange={update('lastName')}
              disabled={loading}
              style={inputStyle}
            />
          </Field>
        </Row>

        <Field label="Email" required>
          <input
            type="email"
            required
            autoComplete="email"
            value={form.email}
            onChange={update('email')}
            disabled={loading}
            style={inputStyle}
          />
        </Field>

        <Field label="Phone" required hint="10-digit Indian mobile starting with 6, 7, 8, or 9">
          <input
            type="tel"
            required
            inputMode="numeric"
            autoComplete="tel"
            pattern="^[6-9]\d{9}$"
            maxLength={10}
            placeholder="9876543210"
            value={form.phone}
            onChange={(e) => {
              // Indian mobile only: strip non-digits, drop any leading
              // 0–5, cap at 10 digits. Mirrors the server-side regex
              // on RegisterAffiliateDto.
              let next = e.target.value.replace(/\D/g, '');
              next = next.replace(/^[0-5]+/, '');
              next = next.slice(0, 10);
              setForm((p) => ({ ...p, phone: next }));
            }}
            disabled={loading}
            style={inputStyle}
          />
        </Field>

        <Field label="Password" required hint="At least 8 characters">
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={form.password}
            onChange={update('password')}
            disabled={loading}
            style={inputStyle}
          />
        </Field>

        <Field label="Website / blog URL (optional)">
          <input
            type="url"
            value={form.websiteUrl}
            onChange={update('websiteUrl')}
            disabled={loading}
            style={inputStyle}
            placeholder="https://"
          />
        </Field>

        <Field label="Social handle (optional)" hint="@yourhandle on the platform you mainly use">
          <input
            type="text"
            value={form.socialHandle}
            onChange={update('socialHandle')}
            disabled={loading}
            style={inputStyle}
          />
        </Field>

        <Field label="Why do you want to join? (optional)">
          <textarea
            rows={3}
            value={form.joinReason}
            onChange={update('joinReason')}
            disabled={loading}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </Field>

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            marginTop: 16,
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
          {loading ? 'Submitting…' : 'Submit application'}
        </button>

        <div style={{ marginTop: 14, fontSize: 12, color: '#64748b', textAlign: 'center' }}>
          Already approved?{' '}
          <Link href="/login" style={{ color: '#2563eb', fontWeight: 600 }}>
            Sign in
          </Link>
        </div>
      </form>
    </main>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {children}
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
        {label}
        {required && <span style={{ color: '#dc2626', marginLeft: 4 }}>*</span>}
      </label>
      {children}
      {hint && (
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{hint}</div>
      )}
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
};
const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 480,
  background: '#fff',
  padding: 32,
  borderRadius: 12,
  border: '1px solid #e2e8f0',
  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  fontSize: 14,
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};
const errorStyle: React.CSSProperties = {
  padding: '10px 12px',
  marginBottom: 16,
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: 8,
  fontSize: 12,
  color: '#991b1b',
};
