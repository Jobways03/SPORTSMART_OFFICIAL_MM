'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';

interface Coupon {
  id: string;
  code: string;
  isPrimary: boolean;
  isActive: boolean;
  expiresAt?: string | null;
  maxUses?: number | null;
  usedCount: number;
  customerDiscountType?: 'PERCENT' | 'FIXED' | null;
  customerDiscountValue?: string | null;
}

interface Profile {
  firstName?: string;
  couponCodes?: Coupon[];
}

const STOREFRONT =
  process.env.NEXT_PUBLIC_STOREFRONT_URL || 'http://localhost:4005';

export default function CouponsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<Profile>('/affiliate/me')
      .then(setProfile)
      .catch((e) => setError(e?.message ?? 'Could not load coupons.'));
  }, []);

  if (error) return <p style={{ color: '#b91c1c' }}>{error}</p>;
  if (!profile) {
    return (
      <div style={{ maxWidth: 880 }}>
        <div style={{ height: 30, width: 220, background: '#f1f5f9', borderRadius: 8, marginBottom: 8 }} />
        <div style={{ height: 14, width: 420, background: '#f1f5f9', borderRadius: 6, marginBottom: 24 }} />
        <div style={{ height: 200, background: '#f1f5f9', borderRadius: 12 }} />
      </div>
    );
  }

  const coupons = profile.couponCodes ?? [];

  return (
    <div style={{ maxWidth: 880 }}>
      <header style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.02em' }}>
          Coupons & links
        </h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
          Share these with your audience. Every order placed using your code or link earns you commission.
        </p>
      </header>

      {coupons.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#64748b', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14 }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>🎟️</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>No coupon codes yet</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Codes are issued automatically when an admin approves your application.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {coupons.map((c) => (
            <CouponCard key={c.id} coupon={c} firstName={profile.firstName} />
          ))}
        </div>
      )}
    </div>
  );
}

function CouponCard({ coupon, firstName }: { coupon: Coupon; firstName?: string }) {
  const referralLink = `${STOREFRONT}/?ref=${encodeURIComponent(coupon.code)}`;
  const [codeCopied, setCodeCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const copy = async (text: string, kind: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      if (kind === 'code') {
        setCodeCopied(true);
        setTimeout(() => setCodeCopied(false), 1600);
      } else {
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 1600);
      }
    } catch {
      alert(`Copy failed. Manually copy: ${text}`);
    }
  };

  const expired = coupon.expiresAt && new Date(coupon.expiresAt) < new Date();
  const exhausted = coupon.maxUses != null && coupon.usedCount >= coupon.maxUses;
  const inactive = !coupon.isActive || expired || exhausted;

  const usagePct = coupon.maxUses != null ? Math.min(100, (coupon.usedCount / coupon.maxUses) * 100) : null;

  const shareMessage = `Use my code ${coupon.code} on SportsMart for the best deals on sportswear & gear. ${referralLink}`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareMessage)}`;
  const emailSubject = encodeURIComponent('Check out SportsMart');
  const emailBody = encodeURIComponent(
    `Hey,\n\nI thought you'd like SportsMart. Use my code ${coupon.code} at checkout, or follow this link: ${referralLink}\n\n${firstName ?? ''}`,
  );
  const emailUrl = `mailto:?subject=${emailSubject}&body=${emailBody}`;
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareMessage)}`;

  return (
    <article style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
      {/* Coupon header band */}
      <div
        style={{
          padding: 22,
          background: inactive
            ? 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)'
            : 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4c1d95 100%)',
          color: inactive ? '#475569' : '#fff',
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: inactive ? '#64748b' : '#a5b4fc', textTransform: 'uppercase', letterSpacing: '1px' }}>
              {coupon.isPrimary ? 'Primary code' : 'Coupon code'}
            </div>
            <div
              style={{
                fontSize: 32,
                fontWeight: 700,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                marginTop: 4,
                letterSpacing: '2px',
              }}
            >
              {coupon.code}
            </div>
            {coupon.customerDiscountValue && (
              <div style={{ marginTop: 6, fontSize: 13 }}>
                Customer gets{' '}
                <strong>
                  {coupon.customerDiscountType === 'PERCENT'
                    ? `${coupon.customerDiscountValue}% off`
                    : `₹${coupon.customerDiscountValue} off`}
                </strong>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
            {inactive && (
              <span style={{ padding: '3px 9px', fontSize: 10, fontWeight: 700, borderRadius: 999, background: '#fee2e2', color: '#991b1b', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                {!coupon.isActive ? 'Inactive' : expired ? 'Expired' : 'Used up'}
              </span>
            )}
            {!inactive && coupon.isPrimary && (
              <span style={{ padding: '3px 9px', fontSize: 10, fontWeight: 700, borderRadius: 999, background: 'rgba(255,255,255,0.15)', color: '#fff', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                Primary
              </span>
            )}
          </div>
        </div>
        {/* Usage bar */}
        {coupon.maxUses != null && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: inactive ? '#64748b' : '#cbd5e1', marginBottom: 4 }}>
              <span>Usage</span>
              <span>{coupon.usedCount} / {coupon.maxUses}</span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: inactive ? '#e2e8f0' : 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${usagePct ?? 0}%`, background: inactive ? '#94a3b8' : '#a5b4fc', transition: 'width 0.3s' }} />
            </div>
          </div>
        )}
      </div>

      {/* Share rows */}
      <div style={{ padding: 20, display: 'grid', gap: 14 }}>
        <ShareRow
          label="Coupon code (paste at checkout)"
          value={coupon.code}
          copied={codeCopied}
          onCopy={() => copy(coupon.code, 'code')}
          mono
        />
        <ShareRow
          label="Referral link (auto-applies via cookie)"
          value={referralLink}
          copied={linkCopied}
          onCopy={() => copy(referralLink, 'link')}
        />

        {/* Social share */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
            Share
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <SocialButton href={whatsappUrl} bg="#25D366" fg="#fff">WhatsApp</SocialButton>
            <SocialButton href={twitterUrl} bg="#0f172a" fg="#fff">𝕏 / Twitter</SocialButton>
            <SocialButton href={emailUrl} bg="#fff" fg="#0f172a" border>Email</SocialButton>
          </div>
        </div>

        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, lineHeight: 1.6 }}>
          {coupon.usedCount} use{coupon.usedCount === 1 ? '' : 's'}
          {coupon.expiresAt && (
            <> · Expires {new Date(coupon.expiresAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</>
          )}
        </div>
      </div>
    </article>
  );
}

function ShareRow({ label, value, copied, onCopy, mono }: { label: string; value: string; copied: boolean; onCopy: () => void; mono?: boolean }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
        {label}
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          readOnly
          value={value}
          style={{
            flex: 1,
            padding: '11px 14px',
            border: '1px solid #cbd5e1',
            borderRadius: 8,
            fontSize: 13,
            fontFamily: mono ? 'ui-monospace, Menlo, monospace' : 'inherit',
            background: '#f8fafc',
            color: '#334155',
            outline: 'none',
          }}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          onClick={onCopy}
          style={{
            padding: '11px 18px',
            background: copied ? '#16a34a' : '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            minWidth: 92,
            transition: 'background 0.15s',
          }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function SocialButton({ href, bg, fg, border, children }: { href: string; bg: string; fg: string; border?: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{
        padding: '8px 14px',
        background: bg,
        color: fg,
        border: border ? '1px solid #cbd5e1' : 'none',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        textDecoration: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {children}
    </a>
  );
}
