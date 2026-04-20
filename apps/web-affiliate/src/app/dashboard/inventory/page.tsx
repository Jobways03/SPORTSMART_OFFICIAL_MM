'use client';

import { useEffect, useState } from 'react';
import { adminFranchisesService } from '@/services/admin-franchises.service';

export default function FranchiseInventoryPage() {
  const [franchises, setFranchises] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [inventory, setInventory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [invLoading, setInvLoading] = useState(false);

  useEffect(() => {
    adminFranchisesService.listFranchises({ limit: 100 }).then(res => {
      setFranchises(res.data?.franchises || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const loadInventory = async (id: string) => {
    setSelected(id);
    setInvLoading(true);
    try {
      const res = await adminFranchisesService.getInventory(id);
      setInventory((res.data as any)?.inventory || []);
    } catch { setInventory([]); }
    finally { setInvLoading(false); }
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Franchise Inventory</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>View stock levels across franchise locations.</p>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 24 }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 12, textTransform: 'uppercase' }}>Select Franchise</h3>
          {loading ? <p style={{ color: '#9ca3af', fontSize: 13 }}>Loading...</p> : franchises.map(f => (
            <button key={f.id} onClick={() => loadInventory(f.id)} style={{
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
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>Select a franchise to view inventory</p>
          ) : invLoading ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>Loading...</p>
          ) : inventory.length === 0 ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>No inventory records</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  {['Product', 'SKU', 'Stock', 'Reserved', 'Available', 'Threshold'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {inventory.map((item: any) => (
                  <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 500 }}>{item.productTitle || '\u2014'}</td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 12 }}>{item.sku || '\u2014'}</td>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>{item.stockQty}</td>
                    <td style={{ padding: '10px 12px' }}>{item.reservedQty}</td>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: item.availableQty <= 0 ? '#dc2626' : item.availableQty <= item.lowStockThreshold ? '#d97706' : '#15803d' }}>{item.availableQty}</td>
                    <td style={{ padding: '10px 12px', color: '#6b7280' }}>{item.lowStockThreshold}</td>
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
