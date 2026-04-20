'use client';

import { useEffect, useState } from 'react';
import { adminFranchisesService } from '@/services/admin-franchises.service';

export default function FranchiseCatalogPage() {
  const [mappings, setMappings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminFranchisesService.listCatalog({ page, limit: 20 });
      setMappings((res.data as any)?.mappings || []);
      setTotalPages((res.data as any)?.pagination?.totalPages || 1);
    } catch { /* */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [page]);

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Franchise Catalog Mappings</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>Review and manage product mappings across all franchises.</p>

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Loading...</div>
        ) : mappings.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>No catalog mappings found</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                {['Franchise', 'Product', 'SKU', 'Approval', 'Created'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mappings.map((m: any) => (
                <tr key={m.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '10px 14px', fontWeight: 500 }}>{m.franchiseName || m.franchiseCode || '\u2014'}</td>
                  <td style={{ padding: '10px 14px' }}>{m.product?.title || '\u2014'}</td>
                  <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 12 }}>{m.sku || '\u2014'}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: m.approvalStatus === 'APPROVED' ? '#dcfce7' : '#fef3c7', color: m.approvalStatus === 'APPROVED' ? '#15803d' : '#92400e' }}>{m.approvalStatus}</span>
                  </td>
                  <td style={{ padding: '10px 14px', color: '#6b7280', fontSize: 12 }}>{new Date(m.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={{ padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 }}>Prev</button>
          <span style={{ padding: '8px 12px', fontSize: 13 }}>Page {page} of {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} style={{ padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 }}>Next</button>
        </div>
      )}
    </div>
  );
}
