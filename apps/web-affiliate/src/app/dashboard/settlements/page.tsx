'use client';

import { useEffect, useState } from 'react';
import { adminFranchisesService } from '@/services/admin-franchises.service';

export default function FranchiseSettlementsPage() {
  const [settlements, setSettlements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminFranchisesService.listSettlements({ limit: 50 });
      const d = res.data as any;
      setSettlements(d?.settlements || (Array.isArray(d) ? d : []));
    } catch { /* */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Franchise Settlements</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>Manage payout cycles and settlement history for franchise partners.</p>

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Loading...</div>
        ) : settlements.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>No settlements yet</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                {['Period', 'Franchise', 'Amount', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {settlements.map((s: any) => (
                <tr key={s.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '10px 14px' }}>{s.periodStart ? new Date(s.periodStart).toLocaleDateString() : '\u2014'} &mdash; {s.periodEnd ? new Date(s.periodEnd).toLocaleDateString() : '\u2014'}</td>
                  <td style={{ padding: '10px 14px' }}>{s.franchise?.businessName || '\u2014'}</td>
                  <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 600 }}>{'\u20B9'}{Number(s.totalAmount || s.amount || 0).toLocaleString('en-IN')}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: s.status === 'PAID' ? '#dcfce7' : s.status === 'APPROVED' ? '#dbeafe' : '#fef3c7', color: s.status === 'PAID' ? '#15803d' : s.status === 'APPROVED' ? '#1d4ed8' : '#92400e' }}>{s.status}</span>
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    {s.status === 'PENDING' && <button onClick={async () => { await adminFranchisesService.approveSettlement(s.id); load(); }} style={{ fontSize: 11, padding: '4px 10px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>Approve</button>}
                    {s.status === 'APPROVED' && <button onClick={async () => { await adminFranchisesService.markSettlementPaid(s.id); load(); }} style={{ fontSize: 11, padding: '4px 10px', border: 'none', borderRadius: 6, background: '#2563eb', color: '#fff', cursor: 'pointer' }}>Mark Paid</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
