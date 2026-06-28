'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { adminFranchisesService } from '@/services/admin-franchises.service';

// The two reversal sources in the franchise finance ledger:
//   RETURN_REVERSAL    — an online order was returned (claws back the
//                        franchise's earning on that order)
//   POS_SALE_REVERSAL  — an in-store POS sale was returned/voided
// They reduce the franchise's payout and are summed into the settlement; this
// page is the dedicated view for them, split out of the Commission ledger.
const REVERSAL_TYPES = ['RETURN_REVERSAL', 'POS_SALE_REVERSAL'];

const TYPE_LABEL: Record<string, string> = {
  RETURN_REVERSAL: 'Return reversal',
  POS_SALE_REVERSAL: 'POS sale reversal',
};

export default function FranchiseReversalsPage() {
  const [franchises, setFranchises] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [reversals, setReversals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [revLoading, setRevLoading] = useState(false);

  useEffect(() => {
    adminFranchisesService
      .listFranchises({ limit: 100 })
      .then((res) => {
        setFranchises(res.data?.franchises || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const loadReversals = async (id: string) => {
    setSelected(id);
    setRevLoading(true);
    try {
      // One call per reversal source (the backend filters an exact sourceType),
      // then merge + sort newest-first.
      const results = await Promise.all(
        REVERSAL_TYPES.map((sourceType) =>
          adminFranchisesService
            .getFinanceLedger(id, { sourceType, limit: 100 })
            .then((res) => {
              const d = res.data as any;
              return (d?.entries || (Array.isArray(d) ? d : [])) as any[];
            })
            .catch(() => [] as any[]),
        ),
      );
      const merged = results
        .flat()
        .sort(
          (a, b) =>
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime(),
        );
      setReversals(merged);
    } catch {
      setReversals([]);
    } finally {
      setRevLoading(false);
    }
  };

  const totalReversed = reversals.reduce(
    (sum, e) => sum + Math.abs(Number(e.franchiseEarning || 0)),
    0,
  );

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Franchise Reversals</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
        Return &amp; POS sale reversals that claw back franchise earnings. These reduce the settlement payout; commission earnings are on the{' '}
        <Link href="/dashboard/commission" style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>Commission</Link>{' '}page.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 24 }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 12, textTransform: 'uppercase' }}>Select Franchise</h3>
          {loading ? (
            <p style={{ color: '#9ca3af', fontSize: 13 }}>Loading...</p>
          ) : (
            franchises.map((f) => (
              <button
                key={f.id}
                onClick={() => loadReversals(f.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  border: 'none',
                  borderRadius: 6,
                  marginBottom: 4,
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 500,
                  background: selected === f.id ? '#eff6ff' : 'transparent',
                  color: selected === f.id ? '#2563eb' : '#111827',
                }}
              >
                {f.businessName || f.ownerName}
              </button>
            ))
          )}
        </div>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 }}>
          {!selected ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>Select a franchise to view reversals</p>
          ) : revLoading ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>Loading...</p>
          ) : reversals.length === 0 ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>No reversals for this franchise</p>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12, fontSize: 13, color: '#6b7280' }}>
                {reversals.length} reversal{reversals.length === 1 ? '' : 's'} &middot; total clawed back{' '}
                <span style={{ color: '#b91c1c', fontWeight: 700, marginLeft: 6, fontFamily: 'monospace' }}>
                  &#8722;&#8377;{totalReversed.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                    {['Type', 'Reference', 'Reversed Earning', 'Status', 'Date'].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reversals.map((e: any) => (
                    <tr key={e.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: '#fef2f2', color: '#b91c1c' }}>
                          {TYPE_LABEL[e.sourceType] || (e.sourceType || '').replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace', color: '#6b7280', fontSize: 12 }} title={e.sourceId || ''}>
                        {e.sourceId ? String(e.sourceId).slice(0, 8) + '…' : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 600, color: '#b91c1c' }}>
                        &#8722;&#8377;{Math.abs(Number(e.franchiseEarning || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: e.status === 'SETTLED' ? '#dcfce7' : '#fef3c7', color: e.status === 'SETTLED' ? '#15803d' : '#92400e' }}>
                          {e.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', color: '#6b7280', fontSize: 12 }}>
                        {e.createdAt ? new Date(e.createdAt).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
