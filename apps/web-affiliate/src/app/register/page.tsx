'use client';

import { useCallback, useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { resolveStorefrontUrl, STOREFRONT_LEGAL_PATHS } from '@sportsmart/shared-utils';
import { apiFetch, ApiError } from '@/lib/api';
import {
  filterPersonNameInput,
  validateEmail,
  validateIndianMobile,
  validatePassword,
  validatePersonName,
} from '@/lib/validators';
import { CaptchaWidget } from '@/components/CaptchaWidget';

const CAPTCHA_REQUIRED =
  (process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER ?? 'disabled').toLowerCase() !==
  'disabled';

/**
 * Affiliate registration form. Submits an application — admin must
 * approve before the account becomes ACTIVE. Mirrors the SRS §5.1
 * registration fields plus the Phase-22 audit additions: confirm
 * password, Terms + Privacy consent, optional marketing opt-in.
 *
 * Phase 22 (2026-05-20) — switched from raw `fetch` to the shared
 * `apiFetch` helper. The helper adds cookie credentials, handles the
 * SportsMart `{ success, data }` envelope, and surfaces ApiError so
 * the 4xx handling below works uniformly.
 */
export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    websiteUrl: '',
    socialHandle: '',
    joinReason: '',
  });
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [acceptMarketing, setAcceptMarketing] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const onCaptchaToken = useCallback((token: string) => {
    setCaptchaToken(token);
  }, []);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [legalHost, setLegalHost] = useState<string | null>(null);
  useEffect(() => {
    setLegalHost(window.location.hostname);
  }, []);
  const termsUrl = resolveStorefrontUrl(STOREFRONT_LEGAL_PATHS.terms, legalHost);
  const privacyUrl = resolveStorefrontUrl(STOREFRONT_LEGAL_PATHS.privacy, legalHost);

  const update = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    // Field-level validation — browser `required`/`pattern` is bypassable, so
    // enforce the real formats here before the API call.
    const fieldError =
      validatePersonName(form.firstName, 'First name') ||
      validatePersonName(form.lastName, 'Last name') ||
      validateEmail(form.email) ||
      validateIndianMobile(form.phone) ||
      validatePassword(form.password);
    if (fieldError) {
      setError(fieldError);
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!acceptTerms) {
      setError('You must agree to the Terms of Service to apply.');
      return;
    }
    if (!acceptPrivacy) {
      setError('You must agree to the Privacy Policy to apply.');
      return;
    }
    if (CAPTCHA_REQUIRED && !captchaToken) {
      setError('Please complete the captcha challenge.');
      return;
    }
    setLoading(true);
    try {
      await apiFetch('/affiliate/register', {
        method: 'POST',
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim().toLowerCase(),
          phone: form.phone.trim(),
          password: form.password,
          websiteUrl: form.websiteUrl.trim() || undefined,
          socialHandle: form.socialHandle.trim() || undefined,
          joinReason: form.joinReason.trim() || undefined,
          acceptTerms,
          acceptPrivacy,
          acceptMarketing,
          captchaToken: captchaToken || undefined,
        }),
      });
      setSuccess(true);
      // Redirect immediately — the API already returned the uniform
      // 201, so further waiting just risks the user closing the tab.
      router.replace('/login?applied=1');
    } catch (err) {
      // Force a fresh captcha challenge on every failed submit —
      // Turnstile / hCaptcha tokens are single-use, so a 4xx without
      // resetting would leave the form unsubmittable.
      setCaptchaResetKey((k) => k + 1);
      setCaptchaToken('');
      if (err instanceof ApiError) {
        setError(err.message || 'Could not submit your application.');
      } else {
        setError('Could not reach the server. Please try again.');
      }
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
              maxLength={100}
              value={form.firstName}
              onChange={(e) =>
                setForm((p) => ({ ...p, firstName: filterPersonNameInput(e.target.value) }))
              }
              disabled={loading}
              style={inputStyle}
            />
          </Field>
          <Field label="Last name" required>
            <input
              type="text"
              required
              maxLength={100}
              value={form.lastName}
              onChange={(e) =>
                setForm((p) => ({ ...p, lastName: filterPersonNameInput(e.target.value) }))
              }
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
          <div style={{ position: 'relative' }}>
            <input
              type={showPassword ? 'text' : 'password'}
              required
              minLength={8}
              autoComplete="new-password"
              value={form.password}
              onChange={update('password')}
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
        </Field>

        <Field label="Confirm password" required>
          <div style={{ position: 'relative' }}>
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              required
              minLength={8}
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={update('confirmPassword')}
              disabled={loading}
              style={{ ...inputStyle, paddingRight: 44 }}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword((v) => !v)}
              aria-label={
                showConfirmPassword ? 'Hide password' : 'Show password'
              }
              aria-pressed={showConfirmPassword}
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
              {showConfirmPassword ? '🙈' : '👁'}
            </button>
          </div>
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

        <div style={{ marginTop: 12, marginBottom: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: '#374151' }}>
            <input
              type="checkbox"
              checked={acceptTerms}
              onChange={(e) => setAcceptTerms(e.target.checked)}
              disabled={loading}
              style={{ marginTop: 3 }}
            />
            <span>
              I agree to the{' '}
              <Link href={termsUrl} target="_blank" style={{ color: '#2563eb' }}>Terms of Service</Link>
              {' '}*
            </span>
          </label>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: '#374151' }}>
            <input
              type="checkbox"
              checked={acceptPrivacy}
              onChange={(e) => setAcceptPrivacy(e.target.checked)}
              disabled={loading}
              style={{ marginTop: 3 }}
            />
            <span>
              I agree to the{' '}
              <Link href={privacyUrl} target="_blank" style={{ color: '#2563eb' }}>Privacy Policy</Link>
              {' '}*
            </span>
          </label>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: '#64748b' }}>
            <input
              type="checkbox"
              checked={acceptMarketing}
              onChange={(e) => setAcceptMarketing(e.target.checked)}
              disabled={loading}
              style={{ marginTop: 3 }}
            />
            <span>Send me affiliate program updates (optional).</span>
          </label>
        </div>

        {CAPTCHA_REQUIRED && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
            <CaptchaWidget onToken={onCaptchaToken} resetKey={captchaResetKey} />
          </div>
        )}

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
