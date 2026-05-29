'use client';

// Phase 25 GST — Super Admin tax dashboard hub.
//
// Single entry-point for India tax compliance. Surfaces the strict-mode
// posture, audit-readiness blockers, all operational queues, and the
// CSV exports finance needs for GSTR-1 / 3B / 8 + Marketplace commission.
// Sub-pages own their own UIs; this page just routes to them and shows
// at-a-glance posture.

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { useModal } from '@sportsmart/ui';
import {
  adminTaxService,
  AuditReadinessReport,
  BlockerSummary,
  Gstr8Summary,
  TaxMode,
} from '@/services/admin-tax.service';

// ── Static config ─────────────────────────────────────────────────

const GSTR1_SECTIONS = [
  { value: 'b2c-large', label: '§5 — B2C Large (>₹2.5L inter-state)' },
  { value: 'b2c-small', label: '§7 — B2C Small (state + rate)' },
  { value: 'credit-notes', label: '§9B — Credit Notes' },
  { value: 'hsn', label: '§12 — HSN Summary' },
  { value: 'docs-issued', label: '§13 — Documents Issued' },
];

type SubPage = {
  href: string;
  title: string;
  desc: string;
  icon: IconName;
  group: 'queues' | 'verify' | 'masters' | 'bulk';
};

const SUB_PAGES: SubPage[] = [
  { group: 'queues',  href: '/dashboard/tax/timebar-review',          title: 'Time-bar review',       desc: 'Returns flagged for finance review or beyond the credit-note cutoff.',                  icon: 'clock' },
  { group: 'queues',  href: '/dashboard/tax/wallet-adjustments',       title: 'Wallet adjustments',    desc: 'Goodwill credits & time-barred refunds awaiting dual approval.',                        icon: 'wallet' },
  { group: 'queues',  href: '/dashboard/tax/eway-bills',               title: 'E-way bills',           desc: 'CBIC Rule 138 — generate, cancel, or override e-way bills per consignment.',           icon: 'truck' },
  { group: 'queues',  href: '/dashboard/tax/einvoices',                title: 'E-invoices / IRN',      desc: 'NIC IRP IRN lifecycle — generate, cancel, and retry failed e-invoices.',               icon: 'receipt' },
  { group: 'queues',  href: '/dashboard/tax/tds194o',                  title: 'Section 194-O TDS',     desc: 'Form 26Q quarterly TDS — deposit & Form 16A certificate lifecycle.',                    icon: 'percent' },

  { group: 'verify',  href: '/dashboard/tax/seller-gstins',            title: 'Seller GSTINs',         desc: 'GSTN portal verification for active seller GSTINs (legal name match).',                 icon: 'building' },
  { group: 'verify',  href: '/dashboard/tax/customer-tax-profiles',    title: 'Customer tax profiles', desc: 'GSTN portal verification for B2B customer GSTINs claiming ITC.',                       icon: 'shield' },

  { group: 'masters', href: '/dashboard/tax/hsn-master',               title: 'HSN master',            desc: 'CBIC HSN codes with effective-dated rate changes — used by products & invoices.',       icon: 'tag' },
  { group: 'masters', href: '/dashboard/tax/uqc-master',               title: 'UQC master',            desc: 'CBIC Unit Quantity Codes — required on Tax Invoices under Section 31 / Rule 46.',     icon: 'ruler' },
  { group: 'masters', href: '/dashboard/tax/config',                   title: 'Tax config',            desc: 'Runtime knobs — EWB threshold, TCS rate, shipping SAC, and other policy values.',      icon: 'sliders' },
  { group: 'masters', href: '/dashboard/tax/platform-gst',             title: 'Platform GST profiles', desc: "Sportsmart's own GSTINs used for OWN_BRAND supply and platform-side filings.",        icon: 'store' },

  // Phase 45 / 46 (2026-05-21) — SUPER_ADMIN-only bulk tools. The
  // backend permission guards (tax.bulk-config / tax.bulk-verify +
  // @Roles('SUPER_ADMIN')) reject non-SUPER_ADMIN actors with 403;
  // these tiles still render in the hub but the destination pages
  // gracefully error for unauthorized actors. Listing them here makes
  // the tools discoverable for SUPER_ADMIN ops without adding noise
  // to the sidebar.
  { group: 'bulk',    href: '/dashboard/tax/bulk-config',               title: 'Bulk update tax config', desc: 'SUPER_ADMIN only — rewrite HSN / GST / cess / UQC across up to 500 products; resets attestation.', icon: 'sliders' },
  { group: 'bulk',    href: '/dashboard/tax/bulk-verify',               title: 'Bulk verify tax config', desc: 'SUPER_ADMIN only — bulk-attest products whose tax config has already been reviewed offline.', icon: 'shield' },
];

const GROUP_META: Record<SubPage['group'], { title: string; hint: string }> = {
  queues:  { title: 'Compliance queues',  hint: 'Work that needs an admin action — returns, e-way bills, TDS deposits.' },
  verify:  { title: 'GSTN verifications', hint: 'Confirm GSTINs against the GSTN portal before they appear on invoices.' },
  masters: { title: 'Reference data',     hint: 'Codes & runtime config the tax engine reads at invoice time.' },
  bulk:    { title: 'Bulk operations',    hint: 'SUPER_ADMIN-only bulk writes — wide blast radius, audit-logged per row.' },
};

// Friendlier title for blocker codes (shown next to the raw code).
const BLOCKER_TITLE: Record<string, string> = {
  'product.missing_hsn':       'Products without HSN code',
  'product.missing_rate':      'Taxable products without GST rate',
  'seller.missing_gstin':      'Active sellers without GSTIN',
  'einvoice.unresolved':       'E-invoices stuck past retry cap',
  'pdf.unresolved':            'Invoice PDFs failed past retry cap',
  'tcs.unfiled':               'TCS rows past the GSTR-8 cutoff',
  'timebar.requires_review':   'Returns flagged for finance review',
};

// ── Page ──────────────────────────────────────────────────────────

export default function TaxDashboardPage() {
  const [mode, setMode] = useState<TaxMode | null>(null);
  const [readiness, setReadiness] = useState<AuditReadinessReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [m, r] = await Promise.all([
        adminTaxService.getMode().catch(() => null),
        adminTaxService.getAuditReadiness().catch(() => null),
      ]);
      setMode(m?.data?.mode ?? null);
      setReadiness(r?.data ?? null);
      setRefreshedAt(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0F1115' }}>
          Tax & GST
        </h1>
        <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', maxWidth: 760 }}>
          Compliance posture, audit readiness, and every GST / TDS filing surface in one place.
          Flip the engine mode below — review the runbook before going <Mono>STRICT</Mono>.
        </p>
      </div>

      {/* ── KPI strip ─────────────────────────────────────── */}
      <KpiStrip
        mode={mode}
        readiness={readiness}
        loading={loading}
        refreshedAt={refreshedAt}
      />

      {/* ── Mode control ──────────────────────────────────── */}
      <ModeCard mode={mode} onRefresh={refresh} loading={loading} />

      {/* ── Operations directory (grouped) ─────────────────── */}
      <OperationsDirectory />

      {/* ── Audit readiness ───────────────────────────────── */}
      {readiness && <ReadinessSection report={readiness} onRefresh={refresh} />}

      {/* ── Filings (CSV exports) ─────────────────────────── */}
      <h2 style={sectionHeading}>Filings & CSV exports</h2>
      <p style={sectionSub}>
        Download what GSTN / TIN-Protean expects. Files mirror the official template columns —
        upload directly or import into your filing utility.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16, marginBottom: 32 }}>
        <Gstr8Section />
        <Gstr1Section />
        <MarketplaceCommissionGstrSection />
      </div>
    </div>
  );
}

// ── KPI strip ─────────────────────────────────────────────────────

function KpiStrip({
  mode,
  readiness,
  loading,
  refreshedAt,
}: {
  mode: TaxMode | null;
  readiness: AuditReadinessReport | null;
  loading: boolean;
  refreshedAt: Date | null;
}) {
  const total = readiness?.totalBlockers ?? 0;
  const ready = readiness?.ready ?? false;
  const byCode = (code: string) => readiness?.blockers.find((b) => b.code === code)?.count ?? 0;

  const modeTone: KpiTone =
    mode === 'STRICT' ? 'success' : mode === 'AUDIT' ? 'warning' : mode === 'OFF' ? 'neutral' : 'muted';
  const modeHint =
    mode === 'STRICT' ? 'Production posture — validation enforced.'
    : mode === 'AUDIT' ? 'Staging soak — violations logged.'
    : mode === 'OFF' ? 'Dev only — validation skipped.'
    : 'Mode unavailable.';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
      <Kpi
        label="Engine mode"
        value={mode ?? '—'}
        tone={modeTone}
        hint={modeHint}
        loading={loading && mode === null}
      />
      <Kpi
        label="Audit blockers"
        value={ready ? 'Ready' : total.toLocaleString('en-IN')}
        tone={ready ? 'success' : total > 0 ? 'danger' : 'muted'}
        hint={ready ? 'Cleared to flip STRICT.' : `${total} item${total === 1 ? '' : 's'} blocking STRICT.`}
        loading={loading && readiness === null}
      />
      <Kpi
        label="Sellers missing GSTIN"
        value={byCode('seller.missing_gstin').toLocaleString('en-IN')}
        tone={byCode('seller.missing_gstin') > 0 ? 'danger' : 'success'}
        hint="Active sellers with no verified GSTIN row."
        loading={loading && readiness === null}
      />
      <Kpi
        label="Time-bar queue"
        value={byCode('timebar.requires_review').toLocaleString('en-IN')}
        tone={byCode('timebar.requires_review') > 0 ? 'warning' : 'muted'}
        hint="Returns awaiting finance triage."
        loading={loading && readiness === null}
      />
      <Kpi
        label="Last refreshed"
        value={refreshedAt ? relTime(refreshedAt) : '—'}
        tone="muted"
        hint={refreshedAt ? refreshedAt.toLocaleString('en-IN') : 'Pending first load.'}
        loading={loading && refreshedAt === null}
      />
    </div>
  );
}

type KpiTone = 'success' | 'warning' | 'danger' | 'neutral' | 'muted';

const KPI_TONE: Record<KpiTone, { color: string; chip: string }> = {
  success: { color: '#15803d', chip: '#dcfce7' },
  warning: { color: '#b45309', chip: '#fef3c7' },
  danger:  { color: '#b91c1c', chip: '#fee2e2' },
  neutral: { color: '#0F1115', chip: '#F3F4F6' },
  muted:   { color: '#525A65', chip: '#F3F4F6' },
};

function Kpi({
  label, value, tone, hint, loading,
}: {
  label: string; value: string; tone: KpiTone; hint?: string; loading?: boolean;
}) {
  const t = KPI_TONE[tone];
  return (
    <div style={{
      background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14,
      padding: 16, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0,
    }}>
      <div style={{ fontSize: 11, color: '#7A828F', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
        {label}
      </div>
      {loading ? (
        <div style={{ height: 28, width: '60%', background: '#F3F4F6', borderRadius: 6 }} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: t.color, fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </span>
          {tone !== 'muted' && tone !== 'neutral' && (
            <span style={{
              width: 8, height: 8, borderRadius: 9999, background: t.color,
            }} />
          )}
        </div>
      )}
      {hint && (
        <div style={{ fontSize: 12, color: '#525A65', lineHeight: 1.4 }}>{hint}</div>
      )}
    </div>
  );
}

// ── Mode control ──────────────────────────────────────────────────

function ModeCard({
  mode, onRefresh, loading,
}: {
  mode: TaxMode | null; onRefresh: () => Promise<void>; loading: boolean;
}) {
  const { confirmDialog } = useModal();
  const [busy, setBusy] = useState<TaxMode | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const flip = async (target: TaxMode) => {
    if (target === mode) return;
    const warnings: Record<TaxMode, string> = {
      OFF: 'Switch to OFF? Tax data validation will be permissive and the DRAFT banner will reappear on invoices. Dev / break-glass only.',
      AUDIT: 'Switch to AUDIT? Validation runs but failures are LOGGED, not thrown. Safe for staging soak — recommended before going STRICT.',
      STRICT: 'Switch to STRICT? Validation will THROW on missing tax data — checkouts and invoice generation can fail. Only flip after audit readiness shows zero blockers.',
    };
    const ok = await confirmDialog({
      title: `Switch tax mode to ${target}?`,
      message: warnings[target],
      confirmText: `Set ${target}`,
      cancelText: 'Cancel',
      danger: target === 'STRICT' || target === 'OFF',
    });
    if (!ok) return;
    setBusy(target);
    setMsg(null);
    try {
      await adminTaxService.setMode(target);
      setMsg({ kind: 'ok', text: `Mode set to ${target}.` });
      await onRefresh();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? `Failed to set mode to ${target}` });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section style={{ ...card, marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={cardHeading}>Engine mode</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#525A65', maxWidth: 600 }}>
            Controls whether the tax engine validates and throws on missing data. Read{' '}
            <Mono>docs/tax/STRICT_MODE_ROLLOUT_RUNBOOK.md</Mono> before changing.
          </p>
        </div>
        <button onClick={() => void onRefresh()} style={btnGhost} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#525A65', fontWeight: 600 }}>Switch to:</span>
        {(['OFF', 'AUDIT', 'STRICT'] as TaxMode[]).map((target) => {
          const isCurrent = target === mode;
          const isBusy = busy === target;
          return (
            <button
              key={target}
              onClick={() => flip(target)}
              disabled={isCurrent || isBusy || !!busy}
              style={{
                height: 36,
                padding: '0 16px',
                borderRadius: 9999,
                fontSize: 13,
                fontWeight: 600,
                cursor: isCurrent || isBusy ? 'not-allowed' : 'pointer',
                border: isCurrent ? '1px solid #0F1115' : '1px solid #D2D6DC',
                background: isCurrent ? '#0F1115' : '#fff',
                color: isCurrent ? '#fff' : '#0F1115',
                opacity: isBusy ? 0.6 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {isCurrent && <span style={{ width: 6, height: 6, borderRadius: 9999, background: '#fff' }} />}
              {isBusy ? `Setting ${target}…` : target}
            </button>
          );
        })}
      </div>

      {msg && (
        <div style={{
          marginTop: 12, padding: '8px 12px', borderRadius: 10, fontSize: 13,
          border: `1px solid ${msg.kind === 'ok' ? '#bbf7d0' : '#fca5a5'}`,
          background: msg.kind === 'ok' ? '#f0fdf4' : '#fef2f2',
          color: msg.kind === 'ok' ? '#15803d' : '#b91c1c',
        }}>
          {msg.text}
        </div>
      )}
    </section>
  );
}

// ── Operations directory ──────────────────────────────────────────

function OperationsDirectory() {
  const groups: SubPage['group'][] = ['queues', 'verify', 'masters'];
  return (
    <>
      {groups.map((g) => {
        const meta = GROUP_META[g];
        const pages = SUB_PAGES.filter((p) => p.group === g);
        return (
          <section key={g} style={{ marginBottom: 24 }}>
            <h2 style={sectionHeading}>{meta.title}</h2>
            <p style={sectionSub}>{meta.hint}</p>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 12,
            }}>
              {pages.map((p) => <SubPageCard key={p.href} page={p} />)}
            </div>
          </section>
        );
      })}
    </>
  );
}

function SubPageCard({ page }: { page: SubPage }) {
  return (
    <Link href={page.href} style={{
      display: 'block',
      padding: 16,
      background: '#fff',
      border: '1px solid #E5E7EB',
      borderRadius: 14,
      textDecoration: 'none',
      color: 'inherit',
      transition: 'border-color 120ms ease, box-shadow 120ms ease',
    }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#0F1115'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#E5E7EB'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{
          width: 32, height: 32, borderRadius: 9,
          background: '#F3F4F6',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: '#0F1115',
        }}>
          <Icon name={page.icon} size={18} />
        </span>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#0F1115' }}>{page.title}</div>
      </div>
      <div style={{ fontSize: 12, color: '#525A65', lineHeight: 1.45 }}>{page.desc}</div>
    </Link>
  );
}

// ── Audit readiness ───────────────────────────────────────────────

function blockerFixLink(code: string): { label: string; href: string } | null {
  switch (code) {
    case 'einvoice.unresolved':
    case 'pdf.unresolved':
      return { label: 'Open e-invoices', href: '/dashboard/tax/einvoices' };
    case 'timebar.requires_review':
      return { label: 'Open time-bar queue', href: '/dashboard/tax/timebar-review' };
    case 'tcs.unfiled':
      return { label: 'Jump to GSTR-8', href: '#gstr8' };
    case 'seller.missing_gstin':
      return { label: 'Open seller GSTINs', href: '/dashboard/tax/seller-gstins' };
    case 'product.missing_hsn':
    case 'product.missing_rate':
      return null;
    default:
      return null;
  }
}

function ReadinessSection({
  report, onRefresh,
}: { report: AuditReadinessReport; onRefresh: () => Promise<void> }) {
  // Sort: blocking first (count > 0), then by count desc.
  const sorted = useMemo<BlockerSummary[]>(
    () => [...report.blockers].sort((a, b) => b.count - a.count),
    [report],
  );
  const blocking = sorted.filter((b) => b.count > 0);
  const clear = sorted.filter((b) => b.count === 0);

  return (
    <section style={{ ...card, marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={cardHeading}>Audit readiness</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#525A65' }}>
            Generated <span style={{ color: '#0F1115', fontWeight: 500 }}>{new Date(report.generatedAt).toLocaleString('en-IN')}</span>
            {' · '}<span title={report.generatedAt}>{relTime(new Date(report.generatedAt))}</span>
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <VerdictPill ready={report.ready} count={report.totalBlockers} />
          <button onClick={() => void onRefresh()} style={btnGhost}>Refresh</button>
        </div>
      </div>

      <div style={{ marginTop: 16, overflow: 'hidden', border: '1px solid #E5E7EB', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
              <th style={th}>Check</th>
              <th style={{ ...th, width: 80, textAlign: 'right' }}>Count</th>
              <th style={th}>What it means</th>
              <th style={{ ...th, width: 240 }}>Sample IDs</th>
              <th style={{ ...th, width: 180 }}>Fix</th>
            </tr>
          </thead>
          <tbody>
            {blocking.map((b) => <BlockerRow key={b.code} blocker={b} />)}
            {clear.length > 0 && (
              <tr style={{ background: '#FAFAFA' }}>
                <td colSpan={5} style={{ ...td, fontSize: 11, fontWeight: 600, color: '#525A65', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Cleared ({clear.length})
                </td>
              </tr>
            )}
            {clear.map((b) => <BlockerRow key={b.code} blocker={b} />)}
            {sorted.length === 0 && (
              <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#7A828F', padding: 24 }}>
                No checks reported. Backend may not be populating audit-readiness yet.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BlockerRow({ blocker }: { blocker: BlockerSummary }) {
  const link = blocker.count > 0 ? blockerFixLink(blocker.code) : null;
  const isBlocking = blocker.count > 0;
  const title = BLOCKER_TITLE[blocker.code] ?? blocker.code;
  const samples = blocker.sampleIds.slice(0, 3);
  const extra = Math.max(0, blocker.sampleIds.length - samples.length);

  return (
    <tr style={{ borderTop: '1px solid #F3F4F6' }}>
      <td style={td}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 8, height: 8, borderRadius: 9999,
            background: isBlocking ? '#b91c1c' : '#15803d',
          }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#0F1115' }}>{title}</div>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#7A828F', marginTop: 2 }}>
              {blocker.code}
            </div>
          </div>
        </div>
      </td>
      <td style={{ ...td, textAlign: 'right' }}>
        <span style={{
          fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
          color: isBlocking ? '#b91c1c' : '#15803d',
        }}>
          {blocker.count.toLocaleString('en-IN')}
        </span>
      </td>
      <td style={{ ...td, color: '#525A65', lineHeight: 1.45, maxWidth: 360 }}>
        {blocker.message}
      </td>
      <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#525A65' }}>
        {samples.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {samples.map((s) => (
              <span key={s} title={s} style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {s.slice(0, 16)}…
              </span>
            ))}
            {extra > 0 && (
              <span style={{ color: '#7A828F', fontSize: 11 }}>+{extra} more</span>
            )}
          </div>
        ) : (
          <span style={{ color: '#7A828F' }}>—</span>
        )}
      </td>
      <td style={td}>
        {link ? (
          <Link href={link.href} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            color: '#0F1115', fontSize: 12, fontWeight: 600, textDecoration: 'none',
            border: '1px solid #D2D6DC', borderRadius: 9999, padding: '6px 12px',
          }}>
            {link.label} <Icon name="arrow-right" size={12} />
          </Link>
        ) : isBlocking ? (
          <span style={{ color: '#7A828F', fontSize: 12 }}>No in-app target</span>
        ) : (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            color: '#15803d', fontSize: 12, fontWeight: 600,
          }}>
            <Icon name="check" size={12} /> Clear
          </span>
        )}
      </td>
    </tr>
  );
}

function VerdictPill({ ready, count }: { ready: boolean; count: number }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 9999,
      background: ready ? '#dcfce7' : '#fee2e2',
      color: ready ? '#15803d' : '#b91c1c',
      fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 9999, background: ready ? '#15803d' : '#b91c1c' }} />
      {ready ? 'Ready' : `${count} blocker${count === 1 ? '' : 's'}`}
    </span>
  );
}

// ── GSTR-8 (platform-side TCS) ────────────────────────────────────
//
// Phase 159z (GSTR-8 export-flow audit remediation):
//   #9   Download JSON button alongside CSV.
//   #6   ARN input required before bulk Mark-FILED.
//   #10  Per-row Reverse action surfaces the correction flow.
//   #12  Period picker disallows future months.
//   #14  Paginated summary — controls in the table footer.

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;

/** Phase 159z (audit #12) — current IST month as `YYYY-MM`. */
function currentIstFilingPeriod(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}
function isFuturePeriod(p: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(p)) return false;
  const current = currentIstFilingPeriod();
  return p > current;
}

function Gstr8Section() {
  const [period, setPeriod] = useState(defaultFilingPeriod());
  const [summary, setSummary] = useState<Gstr8Summary | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [payRef, setPayRef] = useState('');
  // Phase 159z (audit #6) — captured in the UI alongside the FILED click.
  const [nicArn, setNicArn] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<
    'load' | 'filed' | 'paid' | 'csv' | 'json' | 'reverse' | null
  >(null);
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState('');

  const periodInvalid = !/^\d{4}-\d{2}$/.test(period);
  const periodIsFuture = isFuturePeriod(period);
  const periodBlocked = periodInvalid || periodIsFuture;

  const loadSummary = async (nextPage = page) => {
    if (periodBlocked) {
      setMsg({
        kind: 'err',
        text: periodInvalid
          ? 'Filing period must be in YYYY-MM format'
          : `Filing period ${period} is in the future — pick a completed month.`,
      });
      return;
    }
    setMsg(null);
    setBusy('load');
    try {
      const res = await adminTaxService.getGstr8Summary(period, {
        page: nextPage,
        pageSize,
      });
      setSummary(res.data ?? null);
      setPage(res.data?.page ?? nextPage);
      setSelected(new Set());
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Failed to load summary' });
    } finally { setBusy(null); }
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const toggleAll = () => {
    if (!summary) return;
    if (selected.size === summary.rows.length) setSelected(new Set());
    else setSelected(new Set(summary.rows.map((r) => r.id)));
  };

  const markFiled = async () => {
    if (selected.size === 0) return;
    if (!nicArn.trim()) {
      setMsg({ kind: 'err', text: 'Enter the GSTN ARN (NIC acknowledgement number) to mark FILED.' });
      return;
    }
    setBusy('filed');
    try {
      const res = await adminTaxService.markFiled([...selected], nicArn.trim());
      setMsg({
        kind: 'ok',
        text: `Marked FILED — ${res.data?.flipped} of ${res.data?.requested} rows (ARN ${res.data?.nicArn}).`,
      });
      setNicArn('');
      await loadSummary(page);
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'markFiled failed' });
    } finally { setBusy(null); }
  };

  const markPaid = async () => {
    if (selected.size === 0 || !payRef) return;
    setBusy('paid');
    try {
      const res = await adminTaxService.markPaid([...selected], payRef);
      setMsg({ kind: 'ok', text: `Marked PAID_TO_GOVT — ${res.data?.flipped} of ${res.data?.requested} rows.` });
      setPayRef('');
      await loadSummary(page);
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'markPaid failed' });
    } finally { setBusy(null); }
  };

  const downloadCsv = async () => {
    if (periodBlocked) return;
    setBusy('csv');
    setMsg(null);
    try { await adminTaxService.gstr8Csv(period); }
    catch (err: any) { setMsg({ kind: 'err', text: err?.message ?? 'CSV download failed' }); }
    finally { setBusy(null); }
  };

  // Phase 159z (audit #9) — JSON download. Operator GSTIN is resolved
  // server-side from PlatformGstProfile (B3); the UI never sees it.
  const downloadJson = async () => {
    if (periodBlocked) return;
    setBusy('json');
    setMsg(null);
    try { await adminTaxService.gstr8Json(period); }
    catch (err: any) { setMsg({ kind: 'err', text: err?.message ?? 'JSON download failed' }); }
    finally { setBusy(null); }
  };

  // Phase 159z (audit #10) — correction flow per row.
  const openReverse = (id: string) => {
    setReversingId(id);
    setReverseReason('');
    setMsg(null);
  };
  const confirmReverse = async () => {
    if (!reversingId) return;
    if (reverseReason.trim().length < 6) {
      setMsg({ kind: 'err', text: 'Reason must be at least 6 characters' });
      return;
    }
    setBusy('reverse');
    try {
      const res = await adminTaxService.reverseTcs(reversingId, reverseReason.trim());
      setMsg({
        kind: 'ok',
        text: res.data?.wasAlreadyReversed
          ? 'Row was already REVERSED (no-op)'
          : `Row ${reversingId} reversed (was ${res.data?.previousStatus}).`,
      });
      setReversingId(null);
      setReverseReason('');
      await loadSummary(page);
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'reverse failed' });
    } finally { setBusy(null); }
  };

  return (
    <section style={card} id="gstr8">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={cardHeading}>GSTR-8 — Platform-side TCS</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#525A65', maxWidth: 640 }}>
            Marketplace's own GSTR-8 filing — TCS collected at source on every seller supply.
            Load a filing period to see per-supplier rows and flip status as you file & pay.
          </p>
        </div>
      </div>

      <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Field label="Filing period">
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            max={currentIstFilingPeriod()}
            style={input}
          />
        </Field>
        <button
          onClick={() => loadSummary(1)}
          style={btnPrimary}
          disabled={busy === 'load' || !period || periodBlocked}
        >
          {busy === 'load' ? 'Loading…' : 'Load summary'}
        </button>
        <button onClick={downloadCsv} style={btnGhost} disabled={busy === 'csv' || !period || periodBlocked}>
          <Icon name="download" size={14} /> {busy === 'csv' ? 'Downloading…' : 'Download CSV'}
        </button>
        <button onClick={downloadJson} style={btnGhost} disabled={busy === 'json' || !period || periodBlocked}>
          <Icon name="download" size={14} /> {busy === 'json' ? 'Downloading…' : 'Download JSON'}
        </button>
        {periodIsFuture && (
          <span style={{ fontSize: 12, color: '#b91c1c', fontWeight: 600 }}>
            Period is in the future — exports disabled.
          </span>
        )}
      </div>

      {msg && <Banner msg={msg} />}

      {summary && (
        <>
          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
            <Stat label="Sellers"          value={summary.sellerCount.toLocaleString('en-IN')} />
            <Stat label="Gross taxable"    value={`₹${paiseToRupees(summary.totalGrossInPaise)}`} />
            <Stat label="Net taxable"      value={`₹${paiseToRupees(summary.totalNetTaxableInPaise)}`} />
            <Stat label="Total TCS"        value={`₹${paiseToRupees(summary.totalTcsInPaise)}`} accent />
          </div>

          <div style={{ marginTop: 12, overflow: 'hidden', border: '1px solid #E5E7EB', borderRadius: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
                  <th style={{ ...th, width: 36 }}>
                    {summary.rows.length > 0 && (
                      <input
                        type="checkbox"
                        checked={selected.size === summary.rows.length && summary.rows.length > 0}
                        ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < summary.rows.length; }}
                        onChange={toggleAll}
                        style={{ cursor: 'pointer' }}
                      />
                    )}
                  </th>
                  <th style={th}>Supplier GSTIN</th>
                  <th style={th}>Trade Name</th>
                  <th style={{ ...th, textAlign: 'right' }}>Gross</th>
                  <th style={{ ...th, textAlign: 'right' }}>Net</th>
                  <th style={{ ...th, textAlign: 'right' }}>TCS</th>
                  <th style={th}>Status</th>
                  <th style={th}>NIC ARN</th>
                  <th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid #F3F4F6', background: selected.has(r.id) ? '#FAFAFA' : '#fff' }}>
                    <td style={td}>
                      <input
                        type="checkbox" checked={selected.has(r.id)}
                        onChange={() => toggle(r.id)} style={{ cursor: 'pointer' }}
                      />
                    </td>
                    <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#0F1115' }}>
                      {r.supplierGstin ?? <span style={{ color: '#7A828F' }}>—</span>}
                    </td>
                    <td style={td}>
                      {r.seller?.sellerShopName || r.seller?.sellerName || (
                        <span style={{ color: '#7A828F' }}>—</span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      ₹{paiseToRupees(r.grossTaxableSupplyInPaise)}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      ₹{paiseToRupees(r.netTaxableSupplyInPaise)}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                      ₹{paiseToRupees(r.totalTcsInPaise)}
                    </td>
                    <td style={td}>
                      <StatusPill status={r.status} />
                    </td>
                    <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                      {r.nicArn ?? <span style={{ color: '#7A828F' }}>—</span>}
                    </td>
                    <td style={td}>
                      {r.status !== 'REVERSED' && (
                        <button
                          onClick={() => openReverse(r.id)}
                          style={{ ...btnGhost, padding: '4px 8px', fontSize: 12 }}
                          disabled={busy === 'reverse'}
                        >
                          Reverse
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {summary.rows.length === 0 && (
                  <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: '#7A828F', padding: 24 }}>
                    No TCS rows for {period} (NIL filing).
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Phase 159z (audit #14) — pagination controls. */}
          {summary.totalPages > 1 && (
            <div style={{
              marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: 12, color: '#525A65' }}>
                Page {summary.page} of {summary.totalPages} · {summary.sellerCount.toLocaleString('en-IN')} suppliers
              </span>
              <button
                onClick={() => loadSummary(Math.max(1, summary.page - 1))}
                style={{ ...btnGhost, padding: '6px 10px', fontSize: 12 }}
                disabled={summary.page <= 1 || busy === 'load'}
              >
                ← Prev
              </button>
              <button
                onClick={() => loadSummary(Math.min(summary.totalPages, summary.page + 1))}
                style={{ ...btnGhost, padding: '6px 10px', fontSize: 12 }}
                disabled={summary.page >= summary.totalPages || busy === 'load'}
              >
                Next →
              </button>
            </div>
          )}

          {summary.rows.length > 0 && (
            <div style={{
              marginTop: 12, padding: 12, background: '#FAFAFA',
              border: '1px solid #E5E7EB', borderRadius: 12,
              display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: 13, color: '#525A65', fontWeight: 600 }}>
                {selected.size === 0 ? 'Select rows to act on' : `${selected.size} row${selected.size === 1 ? '' : 's'} selected`}
              </span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  value={nicArn} onChange={(e) => setNicArn(e.target.value.toUpperCase())}
                  placeholder="GSTN ARN (mandatory)" style={{ ...input, width: 220 }}
                />
                <button onClick={markFiled} style={btnSecondary} disabled={selected.size === 0 || !nicArn.trim() || busy === 'filed'}>
                  {busy === 'filed' ? 'Marking…' : `Mark FILED`}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  value={payRef} onChange={(e) => setPayRef(e.target.value)}
                  placeholder="UTR / payment ref" style={{ ...input, width: 180 }}
                />
                <button
                  onClick={markPaid}
                  style={btnPrimary}
                  disabled={selected.size === 0 || !payRef || busy === 'paid'}
                >
                  {busy === 'paid' ? 'Marking…' : 'Mark PAID_TO_GOVT'}
                </button>
              </div>
            </div>
          )}

          {/* Phase 159z (audit #10) — inline reverse-confirm prompt. */}
          {reversingId && (
            <div style={{
              marginTop: 12, padding: 12, background: '#fff4f4',
              border: '1px solid #fecaca', borderRadius: 12,
              display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: 13, color: '#b91c1c', fontWeight: 700 }}>
                Reverse row {reversingId.slice(0, 8)}…
              </span>
              <input
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                placeholder="Reason (min 6 chars)"
                style={{ ...input, width: 280 }}
              />
              <button
                onClick={confirmReverse}
                style={btnSecondary}
                disabled={busy === 'reverse' || reverseReason.trim().length < 6}
              >
                {busy === 'reverse' ? 'Reversing…' : 'Confirm reverse'}
              </button>
              <button
                onClick={() => setReversingId(null)}
                style={{ ...btnGhost, padding: '6px 12px' }}
                disabled={busy === 'reverse'}
              >
                Cancel
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── GSTR-1 / 3B (per-seller) ──────────────────────────────────────

function Gstr1Section() {
  const [sellerId, setSellerId] = useState('');
  const [period, setPeriod] = useState(defaultFilingPeriod());
  const [section, setSection] = useState('b2c-large');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<'b2b' | 'section' | '3b' | null>(null);

  const safeCall = async (kind: 'b2b' | 'section' | '3b', fn: () => Promise<void>) => {
    setBusy(kind); setMsg(null);
    try { await fn(); }
    catch (err: any) { setMsg({ kind: 'err', text: err?.message ?? 'Download failed' }); }
    finally { setBusy(null); }
  };

  const disabled = !sellerId || !period;

  return (
    <section style={card}>
      <h2 style={cardHeading}>GSTR-1 / GSTR-3B — Per-seller</h2>
      <p style={{ margin: '4px 0 0', fontSize: 13, color: '#525A65', maxWidth: 640 }}>
        Per-seller filing files. Pick a seller and a period, then export the section your filing
        utility expects. §4 B2B is the most common; other sections are below.
      </p>

      <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <Field label="Seller ID">
          <input
            value={sellerId} onChange={(e) => setSellerId(e.target.value)}
            placeholder="uuid" style={input}
          />
        </Field>
        <Field label="Filing period">
          <input
            value={period} onChange={(e) => setPeriod(e.target.value)}
            placeholder="2026-04" style={input}
          />
        </Field>
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={() => safeCall('b2b', () => adminTaxService.gstr1Csv(sellerId, period))}
          style={btnPrimary} disabled={disabled || busy === 'b2b'}
        >
          <Icon name="download" size={14} /> {busy === 'b2b' ? 'Downloading…' : '§4 B2B CSV'}
        </button>

        <select value={section} onChange={(e) => setSection(e.target.value)} style={{ ...input, paddingRight: 28 }}>
          {GSTR1_SECTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <button
          onClick={() => safeCall('section', () => adminTaxService.gstr1SectionCsv(section, sellerId, period))}
          style={btnSecondary} disabled={disabled || busy === 'section'}
        >
          <Icon name="download" size={14} /> {busy === 'section' ? 'Downloading…' : 'Section CSV'}
        </button>

        <button
          onClick={() => safeCall('3b', () => adminTaxService.gstr3bCsv(sellerId, period))}
          style={btnGhost} disabled={disabled || busy === '3b'}
        >
          <Icon name="download" size={14} /> {busy === '3b' ? 'Downloading…' : 'GSTR-3B CSV'}
        </button>
      </div>

      {msg && <Banner msg={msg} />}
    </section>
  );
}

// ── Marketplace GSTR-1 (own filing) — commission section ─────────

function MarketplaceCommissionGstrSection() {
  const [period, setPeriod] = useState(defaultFilingPeriod());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const download = async () => {
    setMsg(null); setBusy(true);
    try {
      const url = adminTaxService.marketplaceCommissionGstr1CsvUrl(period);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Download failed' });
    } finally { setBusy(false); }
  };

  return (
    <section style={card}>
      <h2 style={cardHeading}>Marketplace GSTR-1 — Commission section (SAC 9985)</h2>
      <p style={{ margin: '4px 0 0', fontSize: 13, color: '#525A65', maxWidth: 720 }}>
        Marketplace's <em>own</em> GSTR-1 filing for commission charged to sellers. Aggregated per
        (seller GSTIN, state) — CGST/SGST if intra-state with the marketplace, IGST otherwise.
      </p>
      <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Field label="Filing period">
          <input
            value={period} onChange={(e) => setPeriod(e.target.value)}
            placeholder="2026-04" style={input}
          />
        </Field>
        <button onClick={download} style={btnPrimary} disabled={busy || !period}>
          <Icon name="download" size={14} /> {busy ? 'Opening…' : 'Download CSV'}
        </button>
      </div>
      {msg && <Banner msg={msg} />}
    </section>
  );
}

// ── Status pill (for GSTR-8 rows) ─────────────────────────────────

const STATUS_TONE: Record<string, { color: string; chip: string }> = {
  COMPUTED:       { color: '#0F1115', chip: '#F3F4F6' },
  COLLECTED:      { color: '#1d4ed8', chip: '#dbeafe' },
  FILED:          { color: '#7c3aed', chip: '#ede9fe' },
  PAID_TO_GOVT:   { color: '#15803d', chip: '#dcfce7' },
  REVERSED:       { color: '#7A828F', chip: '#F3F4F6' },
};

function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? { color: '#525A65', chip: '#F3F4F6' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      height: 22, padding: '0 10px', borderRadius: 9999,
      background: tone.chip, color: tone.color,
      fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 9999, background: tone.color }} />
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ── Shared bits ───────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 140 }}>
      <span style={{
        fontSize: 11, fontWeight: 600, color: '#525A65',
        textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>{label}</span>
      {children}
    </label>
  );
}

function Banner({ msg }: { msg: { kind: 'ok' | 'err'; text: string } }) {
  return (
    <div style={{
      marginTop: 12, padding: '8px 12px', borderRadius: 10, fontSize: 13,
      border: `1px solid ${msg.kind === 'ok' ? '#bbf7d0' : '#fca5a5'}`,
      background: msg.kind === 'ok' ? '#f0fdf4' : '#fef2f2',
      color: msg.kind === 'ok' ? '#15803d' : '#b91c1c',
    }}>
      {msg.text}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      background: accent ? '#0F1115' : '#F9FAFB',
      border: '1px solid ' + (accent ? '#0F1115' : '#E5E7EB'),
      padding: '10px 14px', borderRadius: 12,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 600, color: accent ? '#94A3B8' : '#525A65',
        textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>{label}</div>
      <div style={{
        fontSize: 18, fontWeight: 700, marginTop: 4,
        color: accent ? '#fff' : '#0F1115',
        fontVariantNumeric: 'tabular-nums',
      }}>{value}</div>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code style={{
      fontFamily: 'ui-monospace, monospace', fontSize: 12,
      padding: '1px 6px', background: '#F3F4F6', borderRadius: 4,
    }}>{children}</code>
  );
}

// ── Icons ─────────────────────────────────────────────────────────

type IconName =
  | 'clock' | 'wallet' | 'truck' | 'receipt' | 'percent'
  | 'building' | 'shield' | 'tag' | 'ruler' | 'sliders' | 'store'
  | 'arrow-right' | 'check' | 'download';

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    'clock':       (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
    'wallet':      (<><path d="M3 7a2 2 0 0 1 2-2h13v4" /><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" /><path d="M16 13h5v-3h-5a1.5 1.5 0 0 0 0 3z" /></>),
    'truck':       (<><rect x="2" y="6" width="12" height="10" rx="1" /><path d="M14 9h4l3 3v4h-7" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></>),
    'receipt':     (<><path d="M5 3v18l3-2 3 2 3-2 3 2V3z" /><path d="M9 8h6M9 12h6M9 16h4" /></>),
    'percent':     (<><circle cx="7" cy="7" r="2" /><circle cx="17" cy="17" r="2" /><path d="M19 5 5 19" /></>),
    'building':    (<><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01" /></>),
    'shield':      (<><path d="M12 3 4 6v6c0 5 4 8 8 9 4-1 8-4 8-9V6z" /><path d="m9 12 2 2 4-4" /></>),
    'tag':         (<><path d="M3 12 12 3h7v7l-9 9z" /><circle cx="15.5" cy="8.5" r="1" /></>),
    'ruler':       (<><path d="M3 17 17 3l4 4L7 21z" /><path d="m7 7 2 2M11 11l2 2M15 15l2 2" /></>),
    'sliders':     (<><path d="M4 6h11M19 6h1M4 12h6M14 12h6M4 18h13M21 18h-1" /><circle cx="17" cy="6" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="18" r="2" /></>),
    'store':       (<><path d="M3 9 4 4h16l1 5" /><path d="M3 9v11h18V9" /><path d="M3 9c0 2 1.5 3 3 3s3-1 3-3c0 2 1.5 3 3 3s3-1 3-3c0 2 1.5 3 3 3s3-1 3-3" /></>),
    'arrow-right': (<path d="M5 12h14M13 6l6 6-6 6" />),
    'check':       (<path d="m5 12 5 5 9-11" />),
    'download':    (<><path d="M12 3v13" /><path d="m6 11 6 6 6-6" /><path d="M5 21h14" /></>),
  };
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

function paiseToRupees(p: string): string {
  if (!p) return '0.00';
  const negative = p.startsWith('-');
  const abs = negative ? p.slice(1) : p;
  const whole = abs.length > 2 ? abs.slice(0, -2) : '0';
  const cents = abs.length > 2 ? abs.slice(-2) : abs.padStart(2, '0');
  const grouped = formatIndianGrouping(whole);
  return (negative ? '-' : '') + grouped + '.' + cents;
}

function formatIndianGrouping(n: string): string {
  if (n.length <= 3) return n;
  const last3 = n.slice(-3);
  const rest = n.slice(0, -3);
  const groups: string[] = [];
  let i = rest.length;
  while (i > 0) {
    const start = Math.max(0, i - 2);
    groups.unshift(rest.slice(start, i));
    i = start;
  }
  return `${groups.join(',')},${last3}`;
}

function defaultFilingPeriod(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}`;
}

function relTime(d: Date): string {
  const diff = Math.max(0, Date.now() - d.getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  const w = Math.floor(days / 7);
  if (w < 4) return `${w}w ago`;
  const mo = Math.floor(days / 30);
  if (mo < 12) return `${mo}mo ago`;
  const y = Math.floor(days / 365);
  return `${y}y ago`;
}

// ── Shared styles ─────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #E5E7EB',
  borderRadius: 16,
  padding: 20,
};

const cardHeading: React.CSSProperties = {
  fontSize: 16, fontWeight: 700, color: '#0F1115', margin: 0,
};

const sectionHeading: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, color: '#0F1115', margin: 0,
  marginTop: 8, marginBottom: 4,
  textTransform: 'uppercase', letterSpacing: '0.06em',
};

const sectionSub: React.CSSProperties = {
  fontSize: 13, color: '#525A65', margin: 0, marginBottom: 12,
};

const btnPrimary: React.CSSProperties = {
  height: 36, padding: '0 16px',
  background: '#0F1115', color: '#fff',
  border: '1px solid #0F1115', borderRadius: 9999,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};

const btnSecondary: React.CSSProperties = {
  height: 36, padding: '0 16px',
  background: '#fff', color: '#0F1115',
  border: '1px solid #D2D6DC', borderRadius: 9999,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};

const btnGhost: React.CSSProperties = {
  height: 36, padding: '0 14px',
  background: 'transparent', color: '#525A65',
  border: '1px solid #E5E7EB', borderRadius: 9999,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};

const input: React.CSSProperties = {
  height: 36, padding: '0 12px',
  border: '1px solid #D2D6DC', borderRadius: 9,
  fontSize: 13, color: '#0F1115',
  outline: 'none', background: '#fff',
  minWidth: 140,
};

const th: React.CSSProperties = {
  padding: '12px 16px', textAlign: 'left',
  fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.06em', color: '#525A65',
};

const td: React.CSSProperties = {
  padding: '12px 16px', fontSize: 13, color: '#0F1115',
  verticalAlign: 'middle',
};
