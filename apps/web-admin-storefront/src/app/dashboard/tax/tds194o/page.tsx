'use client';

// Phase 27 GST — Section 194-O Income-Tax TDS admin panel.
//
// Lifecycle mirrors the existing TCS panel:
//   COMPUTED → WITHHELD (auto, when settlement marked PAID)
//             → DEPOSITED (admin marks after challan upload)
//             → CERTIFICATE_ISSUED (admin marks after Form 16A
//                                   issued to seller)
//
// Quarterly filing period in YYYY-Qn format (e.g. 2026-Q3 = Oct-Dec
// 2026). Form 26Q quarterly return drives the cadence.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  adminTaxService,
  Tds194OLedgerItem,
} from '@/services/admin-tax.service';

export default function Tds194OPage() {
  const [filingPeriod, setFilingPeriod] = useState(currentQuarterIst());
  const [items, setItems] = useState<Tds194OLedgerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(
    null,
  );
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showCertModal, setShowCertModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await adminTaxService.listTds194O(filingPeriod);
      setItems(res.data?.items ?? []);
      setSelected({});
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Load failed' });
    } finally {
      setLoading(false);
    }
  }, [filingPeriod]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedIds = Object.entries(selected)
    .filter(([, v]) => v)
    .map(([k]) => k);

  return (
    <div style={{ padding: 24, maxWidth: 1400 }}>
      <Link href="/dashboard/tax" style={crumb}>
        &larr; Tax / GST
      </Link>
      <h1>Section 194-O TDS (Form 26Q)</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        Marketplace deducts 1% income tax (or 5% when seller has no
        verified PAN) on gross sale value INCLUDING GST. Filing cadence is
        quarterly via Form 26Q; Form 16A goes to the seller within 15 days
        of filing.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>Filing period</label>
        <input
          type="text"
          value={filingPeriod}
          onChange={(e) => setFilingPeriod(e.target.value)}
          placeholder="2026-Q3"
          style={{ ...input, width: 120 }}
        />
        <button onClick={load} style={btnSecondary}>
          Load
        </button>
        <a
          href={adminTaxService.form26qCsvUrl(filingPeriod)}
          target="_blank"
          rel="noopener"
          style={{
            ...btnSecondary,
            textDecoration: 'none',
            display: 'inline-block',
          }}
          title="Download Form 26Q CSV — import into NSDL RPU"
        >
          ⬇ Form 26Q CSV
        </a>
        <span style={{ flex: 1 }} />
        {selectedIds.length > 0 && (
          <>
            <span style={{ fontSize: 12, color: '#666' }}>
              {selectedIds.length} selected
            </span>
            <button onClick={() => setShowDepositModal(true)} style={btnPrimary}>
              Mark DEPOSITED
            </button>
            <button onClick={() => setShowCertModal(true)} style={btnPrimary}>
              Mark CERTIFICATE_ISSUED
            </button>
          </>
        )}
      </div>

      {msg && (
        <div
          style={{
            ...note,
            background: msg.kind === 'ok' ? '#dcfce7' : '#fee2e2',
            color: msg.kind === 'ok' ? '#166534' : '#991b1b',
          }}
        >
          {msg.text}
        </div>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : items.length === 0 ? (
        <p style={{ color: '#666' }}>
          No TDS rows for {filingPeriod}. Try another quarter or run a
          settlement cycle approval to compute new rows.
        </p>
      ) : (
        <table style={tbl}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <th style={{ ...th, width: 28 }}>
                <input
                  type="checkbox"
                  checked={
                    items.length > 0 &&
                    items.every((i) => selected[i.id])
                  }
                  onChange={(e) => {
                    const next: Record<string, boolean> = {};
                    if (e.target.checked) {
                      for (const i of items) next[i.id] = true;
                    }
                    setSelected(next);
                  }}
                />
              </th>
              <th style={th}>Seller</th>
              <th style={th}>Status</th>
              <th style={th}>PAN</th>
              <th style={{ ...th, textAlign: 'right' }}>Gross sale</th>
              <th style={{ ...th, textAlign: 'right' }}>Rate</th>
              <th style={{ ...th, textAlign: 'right' }}>TDS</th>
              <th style={th}>Challan</th>
              <th style={th}>Form 16A</th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id} style={{ borderTop: '1px solid #eee' }}>
                <td style={td}>
                  <input
                    type="checkbox"
                    checked={!!selected[t.id]}
                    onChange={(e) =>
                      setSelected((prev) => ({
                        ...prev,
                        [t.id]: e.target.checked,
                      }))
                    }
                    disabled={
                      t.status === 'REVERSED' ||
                      (t.status === 'CERTIFICATE_ISSUED')
                    }
                  />
                </td>
                <td style={td}>
                  <div style={{ fontWeight: 600 }}>
                    {t.sellerLegalName ?? '—'}
                  </div>
                  <div style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace' }}>
                    {t.sellerId.slice(0, 8)}
                  </div>
                </td>
                <td style={td}>
                  <span style={statusBadge(t.status)}>{t.status}</span>
                </td>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>
                  {t.sellerPanLast4 ? `••••${t.sellerPanLast4}` : '—'}
                  {!t.hadVerifiedPan && (
                    <div style={{ color: '#dc2626', fontSize: 10 }}>
                      not verified
                    </div>
                  )}
                </td>
                <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace' }}>
                  ₹{paiseToRupees(t.grossSaleInPaise)}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {(t.tdsRateBps / 100).toFixed(1)}%
                </td>
                <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                  ₹{paiseToRupees(t.tdsInPaise)}
                </td>
                <td style={{ ...td, fontSize: 11 }}>
                  {t.challanReference ? (
                    <>
                      <div style={{ fontFamily: 'monospace' }}>
                        {t.challanReference}
                      </div>
                      <div style={{ color: '#6b7280' }}>
                        {t.depositedAt
                          ? new Date(t.depositedAt).toLocaleDateString('en-IN')
                          : ''}
                      </div>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td style={{ ...td, fontSize: 11 }}>
                  {t.certificateNumber ? (
                    <>
                      <div style={{ fontFamily: 'monospace' }}>
                        {t.certificateNumber}
                      </div>
                      <div style={{ color: '#6b7280' }}>
                        {t.certificateIssuedAt
                          ? new Date(t.certificateIssuedAt).toLocaleDateString('en-IN')
                          : ''}
                      </div>
                      <a
                        href={adminTaxService.form16aHtmlUrl(t.id)}
                        target="_blank"
                        rel="noopener"
                        style={{ fontSize: 11, color: '#2563eb', textDecoration: 'underline' }}
                      >
                        Open Form 16A
                      </a>
                    </>
                  ) : (
                    <>
                      <div style={{ color: '#9ca3af' }}>—</div>
                      <a
                        href={adminTaxService.form16aHtmlUrl(t.id)}
                        target="_blank"
                        rel="noopener"
                        style={{ fontSize: 11, color: '#6b7280', textDecoration: 'underline' }}
                        title="Preview certificate before issuance"
                      >
                        Preview draft
                      </a>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showDepositModal && (
        <BulkChallanModal
          title="Mark TDS rows as DEPOSITED"
          label="Challan reference (NSDL / TIN-Protean)"
          placeholder="e.g. 0001234567"
          onClose={() => setShowDepositModal(false)}
          onSubmit={async (ref) => {
            try {
              const res = await adminTaxService.markTdsDeposited(selectedIds, ref);
              setMsg({
                kind: 'ok',
                text: `${res.data?.flipped ?? 0} row(s) marked DEPOSITED`,
              });
              setShowDepositModal(false);
              await load();
            } catch (err: any) {
              setMsg({ kind: 'err', text: err?.message ?? 'Failed' });
            }
          }}
        />
      )}

      {showCertModal && (
        <BulkChallanModal
          title="Mark TDS rows as CERTIFICATE_ISSUED"
          label="Form 16A certificate number"
          placeholder="e.g. ABCD1234"
          onClose={() => setShowCertModal(false)}
          onSubmit={async (num) => {
            try {
              const res = await adminTaxService.markTdsCertificateIssued(
                selectedIds,
                num,
              );
              setMsg({
                kind: 'ok',
                text: `${res.data?.flipped ?? 0} row(s) marked CERTIFICATE_ISSUED`,
              });
              setShowCertModal(false);
              await load();
            } catch (err: any) {
              setMsg({ kind: 'err', text: err?.message ?? 'Failed' });
            }
          }}
        />
      )}
    </div>
  );
}

function BulkChallanModal({
  title,
  label,
  placeholder,
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  placeholder: string;
  onClose: () => void;
  onSubmit: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (!value.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit(value.trim());
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        <label style={{ fontSize: 13, fontWeight: 600 }}>{label}</label>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          style={{ ...input, marginBottom: 12 }}
          autoFocus
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} disabled={submitting} style={btnSecondary}>
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || !value.trim()}
            style={submitting ? { ...btnPrimary, ...busyStyle } : btnPrimary}
          >
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}

function statusBadge(s: string): React.CSSProperties {
  const color =
    s === 'CERTIFICATE_ISSUED'
      ? '#16a34a'
      : s === 'DEPOSITED'
        ? '#2563eb'
        : s === 'WITHHELD'
          ? '#d97706'
          : s === 'COMPUTED'
            ? '#a16207'
            : s === 'REVERSED'
              ? '#6b7280'
              : '#6b7280';
  return {
    background: color,
    color: '#fff',
    padding: '2px 6px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
  };
}

function paiseToRupees(p: string): string {
  if (!p) return '0.00';
  const ZERO = BigInt(0);
  const HUNDRED = BigInt(100);
  let n: bigint;
  try {
    n = BigInt(p);
  } catch {
    return '0.00';
  }
  const neg = n < ZERO;
  const abs = neg ? -n : n;
  const whole = abs / HUNDRED;
  const cents = abs % HUNDRED;
  const wholeStr = whole.toString().replace(/\B(?=(\d{2})+(\d{3})(?!\d))/g, ',');
  return (neg ? '-' : '') + wholeStr + '.' + cents.toString().padStart(2, '0');
}

// "now" → "YYYY-Qn" (Indian FY quarters). Apr-Jun=Q1, Jul-Sep=Q2,
// Oct-Dec=Q3, Jan-Mar=Q4 (of previous FY).
function currentQuarterIst(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const m = ist.getUTCMonth();
  const y = ist.getUTCFullYear();
  if (m >= 3 && m <= 5) return `${y}-Q1`;
  if (m >= 6 && m <= 8) return `${y}-Q2`;
  if (m >= 9 && m <= 11) return `${y}-Q3`;
  return `${y - 1}-Q4`;
}

const crumb: React.CSSProperties = { fontSize: 12, color: '#6b7280', textDecoration: 'none', marginBottom: 8, display: 'inline-block' };
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '8px', verticalAlign: 'top' };
const note: React.CSSProperties = { padding: '8px 12px', borderRadius: 4, marginBottom: 12, fontSize: 13 };
const btnPrimary: React.CSSProperties = { background: '#2563eb', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
const btnSecondary: React.CSSProperties = { background: '#f3f4f6', color: '#111', border: '1px solid #d1d5db', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
const busyStyle: React.CSSProperties = { opacity: 0.5, cursor: 'not-allowed' };
const input: React.CSSProperties = { display: 'block', width: '100%', padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 4, marginTop: 4 };
const modalBackdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modal: React.CSSProperties = { background: '#fff', padding: 24, borderRadius: 8, minWidth: 400 };
