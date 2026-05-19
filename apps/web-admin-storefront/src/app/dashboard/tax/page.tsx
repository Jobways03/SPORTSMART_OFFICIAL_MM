'use client';

// Phase 25 GST — Super Admin tax dashboard hub.

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useModal } from '@sportsmart/ui';
import {
  adminTaxService,
  AuditReadinessReport,
  Gstr8Summary,
  TaxMode,
} from '@/services/admin-tax.service';

const GSTR1_SECTIONS = [
  { value: 'b2c-large', label: '§5 — B2C Large (>₹2.5L inter-state)' },
  { value: 'b2c-small', label: '§7 — B2C Small (state+rate)' },
  { value: 'credit-notes', label: '§9B — Credit Notes' },
  { value: 'hsn', label: '§12 — HSN Summary' },
  { value: 'docs-issued', label: '§13 — Documents Issued' },
];

export default function TaxDashboardPage() {
  const [mode, setMode] = useState<TaxMode | null>(null);
  const [readiness, setReadiness] = useState<AuditReadinessReport | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [m, r] = await Promise.all([
        adminTaxService.getMode().catch(() => null),
        adminTaxService.getAuditReadiness().catch(() => null),
      ]);
      setMode(m?.data?.mode ?? null);
      setReadiness(r?.data ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) {
    return <div style={{ padding: 24 }}>Loading tax dashboard…</div>;
  }

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <h1>Tax / GST</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>
        Phases 0–27 surfaces. Flip the mode below; see{' '}
        <code>docs/tax/STRICT_MODE_ROLLOUT_RUNBOOK.md</code> before going STRICT.
      </p>

      <ModeBadge mode={mode} onRefresh={refresh} />

      {/* Sub-page navigation cards */}
      <section style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Operations</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          <SubPageCard href="/dashboard/tax/timebar-review"
            title="⏰ Time-bar review"
            desc="Phase-12 returns flagged REQUIRES_FINANCE_REVIEW or TIME_BARRED" />
          <SubPageCard href="/dashboard/tax/wallet-adjustments"
            title="💰 Wallet adjustments"
            desc="Phase-13 goodwill + time-barred refund approval queue" />
          <SubPageCard href="/dashboard/tax/eway-bills"
            title="🚚 E-way bills"
            desc="Phase-15 CBIC Rule 138 generation / cancel / override" />
          <SubPageCard href="/dashboard/tax/einvoices"
            title="🧾 E-invoices / IRN"
            desc="Phase-22 NIC IRP IRN management" />
          <SubPageCard href="/dashboard/tax/seller-gstins"
            title="🪪 Seller GSTINs"
            desc="Phase-35 GSTN portal verification for seller GSTINs" />
          <SubPageCard href="/dashboard/tax/customer-tax-profiles"
            title="🛡️ Customer tax profiles"
            desc="Phase-35 GSTN portal verification for B2B customer GSTINs" />
          <SubPageCard href="/dashboard/tax/tds194o"
            title="📋 Section 194-O TDS"
            desc="Phase-27 Form 26Q quarterly TDS lifecycle (deposit + Form 16A)" />
          <SubPageCard href="/dashboard/tax/hsn-master"
            title="📚 HSN master"
            desc="Phase-37 CBIC HSN codes + effective-dated rate changes" />
          <SubPageCard href="/dashboard/tax/uqc-master"
            title="📏 UQC master"
            desc="Phase-37 CBIC Unit Quantity Codes (Section 31 / Rule 46)" />
          <SubPageCard href="/dashboard/tax/config"
            title="⚙️ Tax config"
            desc="Phase-37 runtime knobs (EWB threshold, TCS rate, shipping SAC, etc.)" />
          <SubPageCard href="/dashboard/tax/platform-gst"
            title="🏢 Platform GST profiles"
            desc="Phase-37 Sportsmart's own GSTINs (OWN_BRAND / SPORTSMART supplier)" />
        </div>
      </section>

      {readiness && <ReadinessSection report={readiness} onRefresh={refresh} />}

      <Gstr8Section />
      <Gstr1Section />
      <MarketplaceCommissionGstrSection />
    </div>
  );
}

function SubPageCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link href={href} style={{
      display: 'block', padding: 12, border: '1px solid #e5e7eb', borderRadius: 6,
      textDecoration: 'none', color: 'inherit', background: '#f9fafb',
    }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: '#6b7280' }}>{desc}</div>
    </Link>
  );
}

// ── Mode badge ────────────────────────────────────────────────────

function ModeBadge({ mode, onRefresh }: { mode: TaxMode | null; onRefresh: () => void }) {
  const { confirmDialog } = useModal();
  const [busy, setBusy] = useState<TaxMode | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const color =
    mode === 'STRICT' ? '#16a34a' : mode === 'AUDIT' ? '#ca8a04' : '#6b7280';
  const label =
    mode === 'STRICT'
      ? 'STRICT — production posture; DRAFT banner suppressed'
      : mode === 'AUDIT'
      ? 'AUDIT — staging soak; violations logged, not thrown'
      : 'OFF — dev permissive; DRAFT banner visible';

  const flip = async (target: TaxMode) => {
    if (target === mode) return;
    const warnings: Record<TaxMode, string> = {
      OFF: 'Switch to OFF? Tax data validation will be permissive and the DRAFT banner will reappear on invoices.',
      AUDIT: 'Switch to AUDIT? Validation runs but failures are LOGGED, not thrown. Safe for staging soak.',
      STRICT: 'Switch to STRICT? Validation will THROW on missing tax data — checkouts and invoice generation can fail. Only flip after audit-readiness shows zero blockers.',
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
      setMsg({ kind: 'ok', text: `Mode set to ${target}` });
      await onRefresh();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? `Failed to set mode to ${target}` });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section style={card}>
      <h2>Current mode</h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span
          style={{
            background: color,
            color: '#fff',
            padding: '4px 12px',
            borderRadius: 4,
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          {mode ?? 'UNKNOWN'}
        </span>
        <span style={{ color: '#444' }}>{label}</span>
        <button onClick={onRefresh} style={btnSecondary}>Refresh</button>
      </div>
      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: '#666' }}>Switch to:</span>
        {(['OFF', 'AUDIT', 'STRICT'] as TaxMode[]).map((target) => {
          const isCurrent = target === mode;
          const isBusy = busy === target;
          const btnColor = target === 'STRICT' ? '#16a34a' : target === 'AUDIT' ? '#ca8a04' : '#6b7280';
          return (
            <button
              key={target}
              onClick={() => flip(target)}
              disabled={isCurrent || isBusy || !!busy}
              style={{
                background: isCurrent ? '#e5e7eb' : btnColor,
                color: isCurrent ? '#6b7280' : '#fff',
                border: 'none',
                padding: '6px 14px',
                borderRadius: 4,
                fontWeight: 600,
                fontSize: 12,
                cursor: isCurrent || isBusy ? 'not-allowed' : 'pointer',
                opacity: isBusy ? 0.6 : 1,
              }}
            >
              {isBusy ? `Setting ${target}…` : target}
            </button>
          );
        })}
      </div>
      {msg && (
        <div style={{
          marginTop: 12,
          padding: '6px 10px',
          borderRadius: 4,
          fontSize: 12,
          background: msg.kind === 'ok' ? '#dcfce7' : '#fee2e2',
          color: msg.kind === 'ok' ? '#166534' : '#991b1b',
        }}>
          {msg.text}
        </div>
      )}
    </section>
  );
}

// ── Readiness ─────────────────────────────────────────────────────

// Phase 37 — map each blocker code to its admin fix page. Codes that
// have no in-app target (e.g. product.missing_hsn lives in web-admin,
// not admin-storefront) return null and the row stays read-only.
function blockerFixLink(code: string): { label: string; href: string } | null {
  switch (code) {
    case 'einvoice.unresolved':
      return { label: 'Open e-invoices →', href: '/dashboard/tax/einvoices' };
    case 'pdf.unresolved':
      return { label: 'Open e-invoices →', href: '/dashboard/tax/einvoices' };
    case 'timebar.requires_review':
      return {
        label: 'Open time-bar queue →',
        href: '/dashboard/tax/timebar-review',
      };
    case 'tcs.unfiled':
      // GSTR-8 section is anchored on this page; jump to it via hash.
      return { label: 'Jump to GSTR-8 →', href: '#gstr8' };
    case 'seller.missing_gstin':
      return {
        label: 'Open seller GSTINs →',
        href: '/dashboard/tax/seller-gstins',
      };
    case 'product.missing_hsn':
    case 'product.missing_rate':
      // Product tax fields live in web-admin (different app); link
      // to the bulk-tax-config page there. Both apps run under the
      // same parent dashboard in prod, so the relative path works.
      return null;
    default:
      return null;
  }
}

function ReadinessSection({ report, onRefresh }: { report: AuditReadinessReport; onRefresh: () => void }) {
  return (
    <section style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Audit readiness</h2>
        <div>
          <span
            style={{
              background: report.ready ? '#16a34a' : '#dc2626',
              color: '#fff',
              padding: '4px 12px',
              borderRadius: 4,
              fontWeight: 700,
              marginRight: 8,
            }}
          >
            {report.ready ? 'READY' : `${report.totalBlockers} BLOCKER${report.totalBlockers === 1 ? '' : 'S'}`}
          </span>
          <button onClick={onRefresh} style={btnSecondary}>Refresh</button>
        </div>
      </div>
      <p style={{ color: '#888', fontSize: 12 }}>
        Generated {new Date(report.generatedAt).toLocaleString()}
      </p>
      <table style={tbl}>
        <thead>
          <tr>
            <th style={th}>Code</th>
            <th style={{ ...th, textAlign: 'right' }}>Count</th>
            <th style={th}>Message</th>
            <th style={th}>Sample IDs</th>
            <th style={th}>Fix</th>
          </tr>
        </thead>
        <tbody>
          {report.blockers.map((b) => {
            const link = b.count > 0 ? blockerFixLink(b.code) : null;
            return (
              <tr key={b.code} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ ...td, fontFamily: 'monospace' }}>{b.code}</td>
                <td
                  style={{
                    ...td,
                    textAlign: 'right',
                    color: b.count > 0 ? '#dc2626' : '#16a34a',
                    fontWeight: 700,
                  }}
                >
                  {b.count}
                </td>
                <td style={td}>{b.message}</td>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>
                  {b.sampleIds.length > 0 ? b.sampleIds.join(', ') : '—'}
                </td>
                <td style={td}>
                  {link ? (
                    <Link
                      href={link.href}
                      style={{
                        color: '#2563eb',
                        fontSize: 12,
                        fontWeight: 600,
                        textDecoration: 'none',
                      }}
                    >
                      {link.label}
                    </Link>
                  ) : b.count > 0 ? (
                    <span style={{ color: '#888', fontSize: 12 }}>
                      No in-app target
                    </span>
                  ) : (
                    <span style={{ color: '#16a34a', fontSize: 12 }}>✓</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// ── GSTR-8 (platform-side TCS) ────────────────────────────────────

function Gstr8Section() {
  const [period, setPeriod] = useState(defaultFilingPeriod());
  const [summary, setSummary] = useState<Gstr8Summary | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [payRef, setPayRef] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const loadSummary = async () => {
    setMsg(null);
    try {
      const res = await adminTaxService.getGstr8Summary(period);
      setSummary(res.data ?? null);
      setSelected(new Set());
    } catch (err: any) {
      setMsg(`Error: ${err?.message ?? 'failed to load summary'}`);
    }
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const markFiled = async () => {
    if (selected.size === 0) return;
    try {
      const res = await adminTaxService.markFiled([...selected]);
      setMsg(`Marked FILED: flipped=${res.data?.flipped} / requested=${res.data?.requested}`);
      await loadSummary();
    } catch (err: any) {
      setMsg(`Error: ${err?.message ?? 'markFiled failed'}`);
    }
  };

  const markPaid = async () => {
    if (selected.size === 0 || !payRef) return;
    try {
      const res = await adminTaxService.markPaid([...selected], payRef);
      setMsg(`Marked PAID_TO_GOVT: flipped=${res.data?.flipped} / requested=${res.data?.requested}`);
      setPayRef('');
      await loadSummary();
    } catch (err: any) {
      setMsg(`Error: ${err?.message ?? 'markPaid failed'}`);
    }
  };

  return (
    <section style={card} id="gstr8">
      <h2>GSTR-8 (platform-side TCS)</h2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <label>Filing period (YYYY-MM):</label>
        <input
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          placeholder="2026-04"
          style={input}
        />
        <button onClick={loadSummary} style={btnPrimary}>Load summary</button>
        <button
          onClick={() => adminTaxService.gstr8Csv(period).catch((e) => setMsg(`Error: ${e?.message}`))}
          style={btnSecondary}
        >
          Download CSV
        </button>
      </div>

      {msg && <p style={{ color: msg.startsWith('Error') ? '#dc2626' : '#16a34a' }}>{msg}</p>}

      {summary && (
        <>
          <div style={{ display: 'flex', gap: 24, marginBottom: 12 }}>
            <Stat label="Sellers" value={summary.sellerCount.toString()} />
            <Stat label="Gross taxable" value={`₹${paiseToRupees(summary.totalGrossInPaise)}`} />
            <Stat label="Net taxable" value={`₹${paiseToRupees(summary.totalNetTaxableInPaise)}`} />
            <Stat label="Total TCS" value={`₹${paiseToRupees(summary.totalTcsInPaise)}`} />
          </div>

          <table style={tbl}>
            <thead>
              <tr>
                <th style={{ ...th, width: 30 }}></th>
                <th style={th}>Supplier GSTIN</th>
                <th style={{ ...th, textAlign: 'right' }}>Gross</th>
                <th style={{ ...th, textAlign: 'right' }}>Net</th>
                <th style={{ ...th, textAlign: 'right' }}>TCS</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #eee' }}>
                  <td style={td}>
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                  </td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>
                    {r.supplierGstin ?? '—'}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    ₹{paiseToRupees(r.grossTaxableSupplyInPaise)}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    ₹{paiseToRupees(r.netTaxableSupplyInPaise)}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>
                    ₹{paiseToRupees(r.totalTcsInPaise)}
                  </td>
                  <td style={td}>{r.status}</td>
                </tr>
              ))}
              {summary.rows.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ ...td, textAlign: 'center', color: '#888' }}>
                    No TCS rows for {period} (NIL filing).
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {summary.rows.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={markFiled} style={btnPrimary} disabled={selected.size === 0}>
                Mark {selected.size} row(s) FILED
              </button>
              <input
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                placeholder="UTR / payment reference"
                style={input}
              />
              <button
                onClick={markPaid}
                style={btnPrimary}
                disabled={selected.size === 0 || !payRef}
              >
                Mark {selected.size} row(s) PAID_TO_GOVT
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
  const [msg, setMsg] = useState<string | null>(null);

  const safeCall = async (fn: () => Promise<void>) => {
    try {
      setMsg(null);
      await fn();
    } catch (err: any) {
      setMsg(`Error: ${err?.message ?? 'download failed'}`);
    }
  };

  return (
    <section style={card}>
      <h2>GSTR-1 / GSTR-3B (per-seller)</h2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <label>Seller ID:</label>
        <input
          value={sellerId}
          onChange={(e) => setSellerId(e.target.value)}
          placeholder="uuid"
          style={{ ...input, width: 280 }}
        />
        <label>Filing period:</label>
        <input
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          placeholder="2026-04"
          style={input}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={() => safeCall(() => adminTaxService.gstr1Csv(sellerId, period))}
          style={btnPrimary}
          disabled={!sellerId || !period}
        >
          §4 B2B CSV
        </button>
        <select value={section} onChange={(e) => setSection(e.target.value)} style={input}>
          {GSTR1_SECTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <button
          onClick={() => safeCall(() => adminTaxService.gstr1SectionCsv(section, sellerId, period))}
          style={btnPrimary}
          disabled={!sellerId || !period}
        >
          Download section CSV
        </button>
        <button
          onClick={() => safeCall(() => adminTaxService.gstr3bCsv(sellerId, period))}
          style={btnSecondary}
          disabled={!sellerId || !period}
        >
          GSTR-3B CSV
        </button>
      </div>

      {msg && <p style={{ color: msg.startsWith('Error') ? '#dc2626' : '#16a34a', marginTop: 8 }}>{msg}</p>}
    </section>
  );
}

// ── Marketplace GSTR-1 (own filing) — commission section ─────────
//
// Phase 28+ — distinct from per-seller §4 B2B above: this CSV is the
// marketplace's OWN GSTR-1 commission section under SAC 9985, grouped
// by (sellerGstin, stateCode) for the chosen period. Treat the seller
// as the recipient; the marketplace is the supplier.

function MarketplaceCommissionGstrSection() {
  const [period, setPeriod] = useState(defaultFilingPeriod());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const download = async () => {
    setMsg(null);
    setBusy(true);
    try {
      const url = adminTaxService.marketplaceCommissionGstr1CsvUrl(period);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      setMsg(`Error: ${err?.message ?? 'download failed'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={card}>
      <h2>Marketplace GSTR-1 — commission section (SAC 9985)</h2>
      <p style={{ color: '#666', fontSize: 12, marginTop: 4 }}>
        Marketplace's OWN GSTR-1 filing for commission charged to sellers.
        Aggregated per (seller GSTIN, state) for the period; CGST/SGST when
        the seller is intra-state with the marketplace, IGST otherwise.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label>Filing period (YYYY-MM):</label>
        <input
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          placeholder="2026-04"
          style={input}
        />
        <button onClick={download} style={btnPrimary} disabled={busy || !period}>
          {busy ? 'Downloading…' : 'Download CSV'}
        </button>
      </div>
      {msg && (
        <p style={{ color: msg.startsWith('Error') ? '#dc2626' : '#16a34a', marginTop: 8 }}>
          {msg}
        </p>
      )}
    </section>
  );
}

// ── Styles + helpers ───────────────────────────────────────────────

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
};
const btnPrimary: React.CSSProperties = {
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  padding: '6px 12px',
  borderRadius: 4,
  cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  background: '#f3f4f6',
  color: '#111',
  border: '1px solid #d1d5db',
  padding: '6px 12px',
  borderRadius: 4,
  cursor: 'pointer',
};
const input: React.CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: 4,
  padding: '4px 8px',
  fontSize: 14,
};
const tbl: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 8px',
  background: '#f9fafb',
  fontWeight: 600,
};
const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'top' };

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#f3f4f6', padding: '8px 12px', borderRadius: 4 }}>
      <div style={{ fontSize: 11, color: '#666' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function paiseToRupees(p: string): string {
  if (!p) return '0.00';
  const negative = p.startsWith('-');
  const abs = negative ? p.slice(1) : p;
  const whole = abs.length > 2 ? abs.slice(0, -2) : '0';
  const cents = abs.length > 2 ? abs.slice(-2) : abs.padStart(2, '0');
  // Indian grouping
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
