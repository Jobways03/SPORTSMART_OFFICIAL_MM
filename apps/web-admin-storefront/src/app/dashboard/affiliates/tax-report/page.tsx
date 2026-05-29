'use client';

// Phase 159e (audit) — admin §194-O quarterly TDS report for Form 26Q.
// Read-only; gated on affiliates.tax_report.read. The backend aggregates the
// per-payout §194-O ledger (status WITHHELD+) by affiliate for a filing quarter.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePermissions } from '@/lib/permissions';
import { API_BASE } from '@/lib/api-client';
import {
  adminAffiliatePayoutsService as svc,
  Tds194OReport,
  Tds194OLedgerRow,
} from '@/services/admin-affiliate-payouts.service';

// Current Indian-FY filing quarter as "YYYY-Qn" (matches the backend).
function currentQuarter(): string {
  const d = new Date();
  const m = d.getMonth();
  const y = d.getFullYear();
  const fyStart = m >= 3 ? y : y - 1;
  const q = m >= 3 && m <= 5 ? 1 : m >= 6 && m <= 8 ? 2 : m >= 9 && m <= 11 ? 3 : 4;
  return `${fyStart}-Q${q}`;
}

const rupees = (paise: string) =>
  `₹${(Number(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AffiliateTaxReportPage() {
  const { hasPermission } = usePermissions();
  const canView = hasPermission('affiliates.tax_report.read');
  const canDeposit = hasPermission('affiliates.tax.deposit');
  const canIssue = hasPermission('affiliates.tax.issue_certificate');

  const [quarter, setQuarter] = useState(currentQuarter());
  const [report, setReport] = useState<Tds194OReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Phase 159f — deposit/certificate ops.
  const [ledger, setLedger] = useState<Tds194OLedgerRow[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [challan, setChallan] = useState('');
  const [certNo, setCertNo] = useState('');
  const [opsBusy, setOpsBusy] = useState(false);
  const [opsMsg, setOpsMsg] = useState('');

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError('');
    setSelected({});
    setOpsMsg('');
    try {
      const res = await svc.tds194oReport(quarter);
      if (!res?.success) {
        setError(res?.message ?? 'Failed to load report');
        setReport(null);
      } else {
        setReport(res.data ?? null);
      }
      const led = await svc.tdsLedger(quarter);
      setLedger(led?.success ? led.data ?? [] : []);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [quarter, canView]);

  const selectedIds = Object.keys(selected).filter((id) => selected[id]);
  const runDeposit = async () => {
    setOpsMsg('');
    if (selectedIds.length === 0 || !challan.trim()) {
      setOpsMsg('Select WITHHELD rows and enter a challan reference.');
      return;
    }
    setOpsBusy(true);
    try {
      const res = await svc.markTdsDeposited(selectedIds, challan.trim());
      setOpsMsg(res?.success ? `Marked ${res.data?.flipped ?? 0} row(s) deposited.` : res?.message ?? 'Failed');
      setChallan('');
      await load();
    } catch (e: any) {
      setOpsMsg(e?.message ?? 'Failed');
    } finally {
      setOpsBusy(false);
    }
  };
  const runIssue = async () => {
    setOpsMsg('');
    if (selectedIds.length === 0 || !certNo.trim()) {
      setOpsMsg('Select DEPOSITED rows and enter a certificate number.');
      return;
    }
    setOpsBusy(true);
    try {
      const res = await svc.markTdsCertificateIssued(selectedIds, certNo.trim());
      setOpsMsg(res?.success ? `Issued certificate for ${res.data?.flipped ?? 0} row(s).` : res?.message ?? 'Failed');
      setCertNo('');
      await load();
    } catch (e: any) {
      setOpsMsg(e?.message ?? 'Failed');
    } finally {
      setOpsBusy(false);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  // Phase 159g — download the server-generated CBDT Form 26Q CSV (full PAN,
  // BSR, injection-safe). Raw fetch with the admin bearer token (the file is a
  // streamed text/csv response, not JSON).
  const downloadForm26Q = async () => {
    setError('');
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('adminAccessToken') : null;
      const res = await fetch(
        `${API_BASE}/admin/affiliates/payouts/form26q.csv?quarter=${encodeURIComponent(quarter)}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!res.ok) throw new Error('Form 26Q export failed.');
      const csv = await res.text();
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `form26q-affiliate-${quarter}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message ?? 'Download failed');
    }
  };

  const exportCsv = () => {
    if (!report || report.rows.length === 0) return;
    const header = ['Affiliate', 'Email', 'PAN last4', 'PAN on file', 'Rate %', 'Payouts', 'Gross (₹)', 'TDS (₹)'];
    const lines = report.rows.map((r) =>
      [
        r.affiliateName,
        r.email ?? '',
        r.panLast4 ?? '',
        r.hadPanOnFile ? 'Yes' : 'No',
        r.tdsRateBps != null ? r.tdsRateBps / 100 : '',
        r.payoutCount,
        (Number(r.grossInPaise) / 100).toFixed(2),
        (Number(r.tdsInPaise) / 100).toFixed(2),
      ]
        // Quote every field + escape embedded quotes (CSV injection-safe enough
        // for an internal finance export).
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    const csv = [header.map((h) => `"${h}"`).join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `affiliate-194o-tds-${report.filingPeriod}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!canView) {
    return (
      <main style={{ padding: 24 }}>
        <p style={{ color: '#b91c1c', fontSize: 13 }}>
          You need the <code>affiliates.tax_report.read</code> permission to view this report.
        </p>
      </main>
    );
  }

  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <Link href="/dashboard/affiliates/payouts" style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none' }}>
        ← Payouts
      </Link>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '12px 0 4px' }}>Affiliate §194-O TDS report</h1>
      <p style={{ color: '#64748b', fontSize: 13, marginTop: 0 }}>
        Per-affiliate TDS withheld in a filing quarter (Form 26Q). Aggregated from the §194-O ledger.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '16px 0' }}>
        <label style={{ fontSize: 13, color: '#475569' }}>Quarter</label>
        <input
          value={quarter}
          onChange={(e) => setQuarter(e.target.value.trim())}
          placeholder="2026-Q1"
          style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, width: 120 }}
        />
        <button onClick={load} style={btn}>Load</button>
        <button onClick={exportCsv} disabled={!report || report.rows.length === 0} style={btn}>
          Export summary CSV
        </button>
        <button onClick={downloadForm26Q} style={{ ...btn, background: '#0F1115', color: '#fff', borderColor: '#0F1115' }}>
          Form 26Q (CBDT)
        </button>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', color: '#b91c1c', padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ color: '#64748b' }}>Loading…</p>
      ) : !report || report.rows.length === 0 ? (
        <p style={{ color: '#64748b', fontSize: 13 }}>No TDS withheld in {quarter}.</p>
      ) : (
        <>
          <div style={{ fontSize: 13, color: '#334155', marginBottom: 8 }}>
            <strong>{report.totals.affiliates}</strong> affiliate(s) · Gross{' '}
            <strong>{rupees(report.totals.grossInPaise)}</strong> · TDS{' '}
            <strong>{rupees(report.totals.tdsInPaise)}</strong>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#64748b', borderBottom: '2px solid #eee' }}>
                <th style={th}>Affiliate</th>
                <th style={th}>PAN</th>
                <th style={th}>Rate</th>
                <th style={{ ...th, textAlign: 'right' }}>Payouts</th>
                <th style={{ ...th, textAlign: 'right' }}>Gross</th>
                <th style={{ ...th, textAlign: 'right' }}>TDS</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.affiliateId} style={{ borderTop: '1px solid #eee' }}>
                  <td style={td}>
                    <strong>{r.affiliateName}</strong>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{r.email}</div>
                  </td>
                  <td style={td}>
                    {r.panLast4 ? `••••${r.panLast4}` : <span style={{ color: '#b91c1c' }}>no PAN</span>}
                  </td>
                  <td style={td}>{r.tdsRateBps != null ? `${r.tdsRateBps / 100}%` : '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{r.payoutCount}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{rupees(r.grossInPaise)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{rupees(r.tdsInPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {(canDeposit || canIssue) && ledger.length > 0 && (
        <section style={{ marginTop: 28, borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px' }}>Deposit &amp; certificate operations</h2>
          <p style={{ fontSize: 12, color: '#64748b', marginTop: 0 }}>
            Select rows, then mark deposited (WITHHELD→DEPOSITED) or issue Form 16A (DEPOSITED→CERTIFICATE_ISSUED). Use the same challan / certificate number across an affiliate&apos;s quarter.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '10px 0' }}>
            {canDeposit && (
              <>
                <input value={challan} onChange={(e) => setChallan(e.target.value)} placeholder="Challan reference" style={opsInput} />
                <button onClick={runDeposit} disabled={opsBusy} style={btn}>Mark deposited</button>
              </>
            )}
            {canIssue && (
              <>
                <input value={certNo} onChange={(e) => setCertNo(e.target.value)} placeholder="Certificate no." style={opsInput} />
                <button onClick={runIssue} disabled={opsBusy} style={{ ...btn, background: '#0F1115', color: '#fff', borderColor: '#0F1115' }}>
                  Issue Form 16A
                </button>
              </>
            )}
          </div>
          {opsMsg && <div style={{ fontSize: 12, color: '#334155', marginBottom: 8 }}>{opsMsg}</div>}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#64748b', borderBottom: '2px solid #eee' }}>
                <th style={th}></th>
                <th style={th}>Affiliate</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>TDS</th>
                <th style={th}>Challan</th>
                <th style={th}>Cert #</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #eee' }}>
                  <td style={td}>
                    <input
                      type="checkbox"
                      checked={!!selected[r.id]}
                      onChange={(e) => setSelected((s) => ({ ...s, [r.id]: e.target.checked }))}
                    />
                  </td>
                  <td style={td}>
                    {r.affiliateName}
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>{r.panLast4 ? `••••${r.panLast4}` : 'no PAN'}</div>
                  </td>
                  <td style={td}>
                    <span style={{ fontSize: 11, fontWeight: 700 }}>{r.status}</span>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>{rupees(r.tdsInPaise)}</td>
                  <td style={{ ...td, fontSize: 11, color: '#64748b' }}>{r.challanReference ?? '—'}</td>
                  <td style={{ ...td, fontSize: 11, color: '#64748b' }}>{r.certificateNumber ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

const opsInput: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid #cbd5e1',
  fontSize: 13,
  width: 160,
};

const th: React.CSSProperties = { padding: '8px 10px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '10px', verticalAlign: 'top' };
const btn: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid #cbd5e1',
  background: '#fff',
  color: '#475569',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};
