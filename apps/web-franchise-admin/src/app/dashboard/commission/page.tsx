'use client';

import { useEffect, useState } from 'react';
import { adminFranchisesService } from '@/services/admin-franchises.service';

export default function FranchiseCommissionPage() {
  const [franchises, setFranchises] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [ledger, setLedger] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [ledLoading, setLedLoading] = useState(false);

  useEffect(() => {
    adminFranchisesService.listFranchises({ limit: 100 }).then(res => {
      setFranchises(res.data?.franchises || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const loadLedger = async (id: string) => {
    setSelected(id);
    setLedLoading(true);
    try {
      const res = await adminFranchisesService.getFinanceLedger(id, { limit: 50 });
      const d = res.data as any;
      setLedger(d?.entries || (Array.isArray(d) ? d : []));
    } catch { setLedger([]); }
    finally { setLedLoading(false); }
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Franchise Commission & Finance</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>View commission ledger and finance entries for each franchise.</p>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 24 }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 12, textTransform: 'uppercase' }}>Select Franchise</h3>
          {loading ? <p style={{ color: '#9ca3af', fontSize: 13 }}>Loading...</p> : franchises.map(f => (
            <button key={f.id} onClick={() => loadLedger(f.id)} style={{
              display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none',
              borderRadius: 6, marginBottom: 4, cursor: 'pointer', fontSize: 13, fontWeight: 500,
              background: selected === f.id ? '#eff6ff' : 'transparent', color: selected === f.id ? '#2563eb' : '#111827',
            }}>
              {f.businessName || f.ownerName}
            </button>
          ))}
        </div>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 }}>
          {!selected ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>Select a franchise to view commission ledger</p>
          ) : ledLoading ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>Loading...</p>
          ) : ledger.length === 0 ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>No finance entries yet</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  {['Type', 'Base Amt', 'Computed', 'Franchise Earning', 'Status', 'Date'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ledger.map((e: any) => (
                  <tr key={e.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '10px 12px' }}><span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: '#eff6ff', color: '#2563eb' }}>{(e.sourceType || e.type || '').replace(/_/g, ' ')}</span></td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>{'\u20B9'}{Number(e.baseAmount || e.amount || 0).toLocaleString('en-IN')}</td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>{'\u20B9'}{Number(e.computedAmount || 0).toLocaleString('en-IN')}</td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 600 }}>{'\u20B9'}{Number(e.franchiseEarning || 0).toLocaleString('en-IN')}</td>
                    <td style={{ padding: '10px 12px' }}><span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: e.status === 'SETTLED' ? '#dcfce7' : '#fef3c7', color: e.status === 'SETTLED' ? '#15803d' : '#92400e' }}>{e.status}</span></td>
                    <td style={{ padding: '10px 12px', color: '#6b7280', fontSize: 12 }}>{e.createdAt ? new Date(e.createdAt).toLocaleString() : '\u2014'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
