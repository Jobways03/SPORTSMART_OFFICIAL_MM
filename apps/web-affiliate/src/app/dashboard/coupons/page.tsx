'use client';

import { useEffect, useMemo, useState } from 'react';
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
      <div style={{ maxWidth: 880, marginInline: 'auto' }}>
        <div style={{ height: 130, background: '#f1f5f9', borderRadius: 16, marginBottom: 14 }} />
        <div style={{ height: 280, background: '#f1f5f9', borderRadius: 14 }} />
      </div>
    );
  }

  const coupons = profile.couponCodes ?? [];
  const totalUses = coupons.reduce((sum, c) => sum + c.usedCount, 0);
  const activeCount = coupons.filter((c) => isLive(c)).length;

  return (
    <div style={{ maxWidth: 880, marginInline: 'auto' }}>
      {/* ── Hero ──────────────────────────────────────── */}
      <header
        style={{
          position: 'relative',
          padding: '26px 28px',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 55%, #312e81 100%)',
          color: '#fff',
          borderRadius: 16,
          marginBottom: 18,
          overflow: 'hidden',
        }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute',
            right: -50,
            top: -50,
            width: 240,
            height: 240,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(99, 102, 241, 0.35) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />
        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#a5b4fc', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 6 }}>
            Affiliate · Share Kit
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
            Coupons & links
          </h1>
          <p style={{ fontSize: 13, color: '#cbd5e1', margin: '8px 0 16px', maxWidth: 560, lineHeight: 1.55 }}>
            Share these with your audience. Every order that uses your code <em>or</em> lands via your link earns you commission — even if the customer pays days later.
          </p>

          {coupons.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
              <HeroStat label="Total uses" value={String(totalUses)} hint="Across all codes" />
              <HeroStat label="Active codes" value={String(activeCount)} hint={`Out of ${coupons.length}`} />
              <HeroStat
                label="Primary"
                value={coupons.find((c) => c.isPrimary)?.code ?? '—'}
                mono
                hint="Your default share code"
              />
            </div>
          )}
        </div>
      </header>

      {coupons.length === 0 ? (
        <EmptyState />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {coupons.map((c) => (
            <CouponCard key={c.id} coupon={c} firstName={profile.firstName} />
          ))}
        </div>
      )}

      {/* ── How tracking works (callout) ──────────────── */}
      {coupons.length > 0 && (
        <aside
          style={{
            marginTop: 18,
            padding: '16px 18px',
            background: '#eff6ff',
            border: '1px solid #dbeafe',
            borderRadius: 12,
            fontSize: 12,
            color: '#1e3a8a',
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 12 }}>
            🔗 How attribution works
          </div>
          <strong>Coupon</strong>: customer types your code at checkout — you earn instantly, no cookie required.{' '}
          <strong>Link</strong>: customer clicks your <code style={codeStyle}>?ref=…</code> link — we drop a 30-day cookie, and any order they place in that window credits you, even if they remove items, log out, or come back later.
        </aside>
      )}
    </div>
  );
}

/* ── Coupon card ───────────────────────────────────────── */

function CouponCard({ coupon, firstName }: { coupon: Coupon; firstName?: string }) {
  const referralLink = `${STOREFRONT}/?ref=${encodeURIComponent(coupon.code)}`;
  const [codeCopied, setCodeCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const expired = !!coupon.expiresAt && new Date(coupon.expiresAt) < new Date();
  const exhausted = coupon.maxUses != null && coupon.usedCount >= coupon.maxUses;
  const inactive = !coupon.isActive || expired || exhausted;

  const usagePct = useMemo(() => {
    if (coupon.maxUses == null) return null;
    return Math.min(100, (coupon.usedCount / coupon.maxUses) * 100);
  }, [coupon.maxUses, coupon.usedCount]);

  const expiryDays = coupon.expiresAt
    ? Math.ceil((new Date(coupon.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

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

  const shareMessage = `Use my code ${coupon.code} on SportsMart for the best deals on sportswear & gear. ${referralLink}`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareMessage)}`;
  const emailSubject = encodeURIComponent('Check out SportsMart');
  const emailBody = encodeURIComponent(
    `Hey,\n\nI thought you'd like SportsMart. Use my code ${coupon.code} at checkout, or follow this link: ${referralLink}\n\n${firstName ?? ''}`,
  );
  const emailUrl = `mailto:?subject=${emailSubject}&body=${emailBody}`;
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareMessage)}`;

  return (
    <article
      style={{
        background: '#fff',
        border: '1px solid ' + (inactive ? '#e2e8f0' : '#dbeafe'),
        borderRadius: 16,
        overflow: 'hidden',
        boxShadow: inactive ? 'none' : '0 1px 2px rgba(15, 23, 42, 0.04)',
      }}
    >
      {/* Coupon header — code + state pills */}
      <div
        style={{
          padding: '24px 26px',
          background: inactive
            ? 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)'
            : 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4c1d95 100%)',
          color: inactive ? '#475569' : '#fff',
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: inactive ? '#64748b' : '#a5b4fc', textTransform: 'uppercase', letterSpacing: '1.5px' }}>
                {coupon.isPrimary ? 'Primary code' : 'Coupon code'}
              </span>
              {coupon.isPrimary && !inactive && (
                <span style={{ padding: '2px 8px', fontSize: 9, fontWeight: 700, borderRadius: 999, background: 'rgba(255,255,255,0.15)', color: '#fff', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                  Default
                </span>
              )}
            </div>
            <div
              style={{
                fontSize: 36,
                fontWeight: 800,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                letterSpacing: '3px',
                lineHeight: 1,
              }}
            >
              {coupon.code}
            </div>
            {coupon.customerDiscountValue && (
              <div style={{ marginTop: 10, fontSize: 13, color: inactive ? '#475569' : '#cbd5e1' }}>
                Customer gets{' '}
                <strong style={{ color: inactive ? '#0f172a' : '#fff' }}>
                  {coupon.customerDiscountType === 'PERCENT'
                    ? `${coupon.customerDiscountValue}% off`
                    : `₹${coupon.customerDiscountValue} off`}
                </strong>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
            {inactive && (
              <span style={{ padding: '4px 10px', fontSize: 10, fontWeight: 700, borderRadius: 999, background: '#fee2e2', color: '#991b1b', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                {!coupon.isActive ? 'Inactive' : expired ? 'Expired' : 'Used up'}
              </span>
            )}
            {expiryDays != null && expiryDays >= 0 && expiryDays <= 30 && !inactive && (
              <span style={{ padding: '3px 9px', fontSize: 10, fontWeight: 600, borderRadius: 999, background: 'rgba(251, 191, 36, 0.2)', color: '#fbbf24', letterSpacing: '0.3px' }}>
                {expiryDays === 0 ? 'Expires today' : `Expires in ${expiryDays} day${expiryDays === 1 ? '' : 's'}`}
              </span>
            )}
          </div>
        </div>

        {/* Inline stats line */}
        <div
          style={{
            marginTop: 16,
            display: 'grid',
            gridTemplateColumns: usagePct != null ? '1fr 1fr' : '1fr',
            gap: 16,
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: inactive ? '#64748b' : '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Uses
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
              {coupon.usedCount}
              {coupon.maxUses != null && (
                <span style={{ fontSize: 13, fontWeight: 500, color: inactive ? '#94a3b8' : '#cbd5e1', marginLeft: 6 }}>
                  / {coupon.maxUses}
                </span>
              )}
            </div>
          </div>
          {usagePct != null && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: inactive ? '#64748b' : '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                {usagePct.toFixed(0)}% used
              </div>
              <div style={{ height: 6, borderRadius: 999, background: inactive ? '#e2e8f0' : 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${usagePct}%`,
                    background: inactive ? '#94a3b8' : 'linear-gradient(90deg, #a5b4fc, #818cf8)',
                    transition: 'width 0.3s',
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Body — share kit */}
      <div style={{ padding: 22, display: 'grid', gap: 16 }}>
        <ShareRow
          icon="🎟️"
          label="Coupon code"
          help="Customer pastes this at checkout."
          value={coupon.code}
          copied={codeCopied}
          onCopy={() => copy(coupon.code, 'code')}
          mono
        />
        <ShareRow
          icon="🔗"
          label="Referral link"
          help="Drops a 30-day cookie — any order in that window credits you."
          value={referralLink}
          copied={linkCopied}
          onCopy={() => copy(referralLink, 'link')}
        />

        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
            Quick share
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <SocialButton href={whatsappUrl} bg="#25D366" fg="#fff" icon="💬">
              WhatsApp
            </SocialButton>
            <SocialButton href={twitterUrl} bg="#0f172a" fg="#fff" icon="𝕏">
              Twitter / X
            </SocialButton>
            <SocialButton href={emailUrl} bg="#fff" fg="#0f172a" border icon="✉️">
              Email
            </SocialButton>
          </div>
        </div>

        {coupon.expiresAt && (
          <div style={{ fontSize: 11, color: '#94a3b8', borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>
            {coupon.usedCount} use{coupon.usedCount === 1 ? '' : 's'}
            {' · '}
            Expires{' '}
            {new Date(coupon.expiresAt).toLocaleDateString('en-IN', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })}
          </div>
        )}
      </div>
    </article>
  );
}

/* ── Atoms ─────────────────────────────────────────────── */

function HeroStat({ label, value, hint, mono }: { label: string; value: string; hint?: string; mono?: boolean }) {
  return (
    <div
      title={hint}
      style={{
        padding: 12,
        background: 'rgba(255, 255, 255, 0.06)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 10,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, color: '#a5b4fc', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div
        style={{
          fontSize: mono ? 16 : 22,
          fontWeight: 700,
          color: '#fff',
          marginTop: 4,
          fontFamily: mono ? 'ui-monospace, Menlo, monospace' : 'inherit',
          letterSpacing: mono ? '1.5px' : '-0.01em',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function ShareRow({
  icon,
  label,
  help,
  value,
  copied,
  onCopy,
  mono,
}: {
  icon: string;
  label: string;
  help: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  mono?: boolean;
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {label}
        </label>
      </div>
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
      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 5 }}>
        {help}
      </div>
    </div>
  );
}

function SocialButton({
  href,
  bg,
  fg,
  border,
  icon,
  children,
}: {
  href: string;
  bg: string;
  fg: string;
  border?: boolean;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{
        padding: '9px 16px',
        background: bg,
        color: fg,
        border: border ? '1px solid #cbd5e1' : 'none',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        textDecoration: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span style={{ fontSize: 14 }}>{icon}</span>
      {children}
    </a>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        padding: '60px 24px',
        textAlign: 'center',
        background: '#fff',
        border: '1px dashed #cbd5e1',
        borderRadius: 14,
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          margin: '0 auto 14px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #f1f5f9 0%, #e0e7ff 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 30,
        }}
      >
        🎟️
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>No coupon codes yet</div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 6, maxWidth: 360, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.55 }}>
        Codes are issued automatically when an admin approves your application.
      </div>
    </div>
  );
}

/* ── helpers ───────────────────────────────────────────── */

function isLive(c: Coupon): boolean {
  if (!c.isActive) return false;
  if (c.expiresAt && new Date(c.expiresAt) < new Date()) return false;
  if (c.maxUses != null && c.usedCount >= c.maxUses) return false;
  return true;
}

const codeStyle: React.CSSProperties = {
  background: '#dbeafe',
  padding: '0 5px',
  borderRadius: 4,
  fontSize: 11,
  fontFamily: 'ui-monospace, Menlo, monospace',
};
