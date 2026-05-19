'use client';

// Phase 35 GST — Customer tax-profile verification admin panel.
//
// Same as the seller GSTINs page but for buyer-side B2B tax profiles.
// Verification flips isVerified=true only when the portal returns
// found=true AND status=ACTIVE — SUSPENDED / CANCELLED GSTINs land
// the result but stay unverified.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  adminTaxService,
  CustomerTaxProfileItem,
  GstnVerifyOutcome,
} from '@/services/admin-tax.service';

type Filter = 'ALL' | 'UNVERIFIED' | 'VERIFIED';

export default function CustomerTaxProfilesPage() {
  const [filter, setFilter] = useState<Filter>('UNVERIFIED');
  const [items, setItems] = useState<CustomerTaxProfileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [lastOutcome, setLastOutcome] = useState<
    { id: string; outcome: GstnVerifyOutcome } | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const verified =
        filter === 'UNVERIFIED'
          ? ('false' as const)
          : filter === 'VERIFIED'
            ? ('true' as const)
            : undefined;
      const res = await adminTaxService.listCustomerTaxProfiles(verified);
      setItems(res.data?.items ?? []);
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Load failed' });
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const verify = async (id: string) => {
    setBusy(id);
    setLastOutcome(null);
    try {
      const res = await adminTaxService.verifyCustomerTaxProfile(id);
      const outcome = res.data;
      if (outcome) {
        setLastOutcome({ id, outcome });
        setMsg({
          kind: outcome.verified ? 'ok' : 'err',
          text: outcome.verified
            ? `Verified via GSTN — status ${outcome.status}`
            : `Not verified — status ${outcome.status}${
                outcome.legalNameMismatch
                  ? ' (legal-name mismatch)'
                  : ''
              }`,
        });
      }
      await load();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Verify failed' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1400 }}>
      <Link href="/dashboard/tax" style={crumb}>
        &larr; Tax / GST
      </Link>
      <h1>Customer tax-profile verification</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        Verify B2B customer GSTINs against the GSTN portal before letting
        their orders attract B2B tax invoices. Unverified profiles still
        accept orders; this page is where finance attests them for
        STRICT-mode invoicing.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['UNVERIFIED', 'VERIFIED', 'ALL'] as Filter[]).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            style={filter === s ? btnFilterActive : btnFilter}
          >
            {s}
          </button>
        ))}
        <button onClick={load} style={btnSecondary}>
          Refresh
        </button>
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
        <p style={{ color: '#666' }}>No tax profiles match this filter.</p>
      ) : (
        <table style={tbl}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <th style={th}>Customer</th>
              <th style={th}>GSTIN</th>
              <th style={th}>State</th>
              <th style={th}>Default</th>
              <th style={th}>Verified</th>
              <th style={th}>Last note</th>
              <th style={th}>Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} style={{ borderTop: '1px solid #eee' }}>
                <td style={td}>
                  <div style={{ fontWeight: 600 }}>
                    {p.customer?.firstName || p.customer?.lastName
                      ? `${p.customer?.firstName ?? ''} ${p.customer?.lastName ?? ''}`.trim()
                      : '—'}
                  </div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>
                    {p.customer?.email ?? p.customerId.slice(0, 8)}
                  </div>
                </td>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>
                  {p.gstin}
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{p.legalName}</div>
                </td>
                <td style={td}>{p.stateCode}</td>
                <td style={td}>
                  {p.isDefault ? (
                    <span style={{ color: '#16a34a', fontWeight: 600 }}>✓</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td style={td}>
                  {p.isVerified ? (
                    <>
                      <span style={{ color: '#16a34a', fontWeight: 600 }}>✓</span>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>
                        {p.verifiedAt
                          ? new Date(p.verifiedAt).toLocaleString('en-IN')
                          : ''}
                      </div>
                    </>
                  ) : (
                    <span style={{ color: '#dc2626', fontWeight: 600 }}>—</span>
                  )}
                </td>
                <td style={{ ...td, fontSize: 11, color: '#6b7280', maxWidth: 320 }}>
                  {lastOutcome && lastOutcome.id === p.id ? (
                    <div>
                      <div>{lastOutcome.outcome.notes}</div>
                      {lastOutcome.outcome.legalNameMismatch && (
                        <div style={{ color: '#dc2626', marginTop: 4 }}>
                          ⚠ Portal name differs from local
                          {lastOutcome.outcome.legalName
                            ? `: "${lastOutcome.outcome.legalName}"`
                            : ''}
                        </div>
                      )}
                    </div>
                  ) : p.verificationNotes ? (
                    <div>{p.verificationNotes}</div>
                  ) : (
                    '—'
                  )}
                </td>
                <td style={td}>
                  <button
                    onClick={() => verify(p.id)}
                    disabled={busy === p.id}
                    style={busy === p.id ? { ...btnPrimary, ...busyStyle } : btnPrimary}
                  >
                    {busy === p.id
                      ? 'Verifying…'
                      : p.isVerified
                        ? 'Re-verify'
                        : 'Verify with GSTN'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const crumb: React.CSSProperties = { fontSize: 12, color: '#6b7280', textDecoration: 'none', marginBottom: 8, display: 'inline-block' };
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '8px', verticalAlign: 'top' };
const note: React.CSSProperties = { padding: '8px 12px', borderRadius: 4, marginBottom: 12, fontSize: 13 };
const btnPrimary: React.CSSProperties = { background: '#2563eb', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
const btnSecondary: React.CSSProperties = { background: '#f3f4f6', color: '#111', border: '1px solid #d1d5db', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
const btnFilter: React.CSSProperties = { background: '#fff', color: '#111', borderWidth: 1, borderStyle: 'solid', borderColor: '#d1d5db', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
const btnFilterActive: React.CSSProperties = { ...btnFilter, background: '#2563eb', color: '#fff', borderColor: '#2563eb' };
const busyStyle: React.CSSProperties = { opacity: 0.5, cursor: 'not-allowed' };
