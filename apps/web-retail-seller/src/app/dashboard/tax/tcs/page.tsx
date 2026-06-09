'use client';

// Phase 160 (§52 TCS lifecycle audit B2 / #2) — seller-facing TCS page.
//
// Before this page, a seller's settlement payout arrived short by the
// TCS amount with no explanation, no filing status, and no certificate.
// Here the seller can see each period's TCS deduction, whether the
// marketplace has filed (NIC ARN) / paid / certified it, and download
// the §52(5) certificate once issued — closing the GSTR-2A
// reconciliation gap the audit called out.

import { useCallback, useEffect, useState } from 'react';
import { sellerTaxService, SellerTcsRow } from '@/services/tax.service';

const fmt = (paise: string) =>
  `₹${(Number(paise) / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const STATUS_LABEL: Record<string, { text: string; bg: string; fg: string }> = {
  COMPUTED: { text: 'Computed', bg: '#F3F4F6', fg: '#374151' },
  COLLECTED: { text: 'Collected', bg: '#dbeafe', fg: '#1d4ed8' },
  FILED: { text: 'Filed (GSTR-8)', bg: '#ede9fe', fg: '#7c3aed' },
  PAID_TO_GOVT: { text: 'Paid to Govt', bg: '#dcfce7', fg: '#15803d' },
  CERTIFICATE_ISSUED: { text: 'Certificate issued', bg: '#cffafe', fg: '#0e7490' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { text: status, bg: '#F3F4F6', fg: '#374151' };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 9999,
      fontSize: 12, fontWeight: 600, background: s.bg, color: s.fg,
    }}>
      {s.text}
    </span>
  );
}

export default function SellerTcsPage() {
  const [rows, setRows] = useState<SellerTcsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    sellerTaxService
      .tcsSummary()
      .then((res) => setRows(res.data?.items ?? []))
      .catch((e) => setErr(e?.message ?? 'Failed to load TCS summary'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const download = async (row: SellerTcsRow) => {
    setDownloadingId(row.id);
    setErr(null);
    try {
      await sellerTaxService.openTcsCertificate(row.id);
    } catch (e: any) {
      setErr(e?.message ?? 'Certificate download failed');
    } finally {
      setDownloadingId(null);
    }
  };

  const totalTcs = rows.reduce((acc, r) => acc + Number(r.totalTcsInPaise), 0);

  return (
    <div style={{ padding: '24px 0', maxWidth: 1000 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>
        Tax Collected at Source (Section 52)
      </h1>
      <p style={{ color: '#525A65', fontSize: 14, margin: '0 0 20px', maxWidth: 680 }}>
        The marketplace collects 1% TCS on the net value of your taxable supplies
        and remits it to the government via GSTR-8. Once filed, you can claim this
        in your electronic cash ledger and reconcile it against your GSTR-2A.
        Download your §52(5) certificate below once it is issued.
      </p>

      {err && (
        <div style={{
          padding: '10px 14px', borderRadius: 10, marginBottom: 16,
          background: '#fef2f2', border: '1px solid #fca5a5', color: '#b91c1c', fontSize: 13,
        }}>
          {err}
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div style={{
          padding: '12px 16px', borderRadius: 12, marginBottom: 16,
          background: '#f8fafc', border: '1px solid #e5e7eb',
          display: 'inline-flex', gap: 24,
        }}>
          <div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Periods</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{rows.length}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total TCS</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(String(totalTcs))}</div>
          </div>
        </div>
      )}

      {loading ? (
        <p style={{ color: '#64748b' }}>Loading…</p>
      ) : rows.length === 0 ? (
        <div style={{
          padding: 32, textAlign: 'center', color: '#64748b',
          border: '1px dashed #e5e7eb', borderRadius: 12,
        }}>
          No TCS has been collected on your supplies yet.
        </div>
      ) : (
        <div style={{ overflow: 'hidden', border: '1px solid #e5e7eb', borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
                <th style={thStyle}>Period</th>
                <th style={thStyle}>GSTIN</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Net taxable</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>TCS</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>GSTR-8 ARN</th>
                <th style={thStyle}>Certificate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={tdStyle}>{r.filingPeriod}</td>
                  <td style={{ ...tdStyle, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                    {r.supplierGstin ?? '—'}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(r.netTaxableSupplyInPaise)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                    {fmt(r.totalTcsInPaise)}
                  </td>
                  <td style={tdStyle}><StatusBadge status={r.status} /></td>
                  <td style={{ ...tdStyle, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                    {r.nicArn ?? <span style={{ color: '#94a3b8' }}>—</span>}
                  </td>
                  <td style={tdStyle}>
                    {r.status === 'CERTIFICATE_ISSUED' ? (
                      <button
                        onClick={() => download(r)}
                        disabled={downloadingId === r.id}
                        style={{
                          padding: '5px 12px', borderRadius: 8, border: '1px solid #0e7490',
                          background: '#fff', color: '#0e7490', fontSize: 12, fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {downloadingId === r.id ? 'Opening…' : 'Download'}
                      </button>
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: 12 }}>Pending</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '10px 12px', fontSize: 11, fontWeight: 600, color: '#64748b',
  textTransform: 'uppercase', letterSpacing: '0.05em',
};
const tdStyle: React.CSSProperties = { padding: '10px 12px', color: '#0f1115' };
