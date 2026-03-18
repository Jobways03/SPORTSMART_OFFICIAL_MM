'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

interface Collection {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  productCount: number;
  isActive: boolean;
  createdAt: string;
}

interface CollectionsResponse {
  collections: Collection[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export default function CollectionsPage() {
  const router = useRouter();
  const [data, setData] = useState<CollectionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const fetchCollections = useCallback((p: number) => {
    setLoading(true);
    apiClient<CollectionsResponse>(`/admin/collections?page=${p}&limit=50`)
      .then((res) => { if (res.data) setData(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchCollections(page); }, [page, fetchCollections]);

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Collections</h1>
        <button
          onClick={() => router.push('/dashboard/products/collections/new')}
          style={{
            padding: '8px 18px', fontSize: 13, fontWeight: 600,
            background: '#303030', color: '#fff', border: 'none',
            borderRadius: 8, cursor: 'pointer',
          }}
        >
          Add collection
        </button>
      </div>

      {loading && !data ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af', fontSize: 14 }}>Loading collections...</div>
      ) : !data || data.collections.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
        }}>
          <div style={{ fontSize: 40, color: '#e5e7eb', marginBottom: 12 }}>&#128230;</div>
          <h3 style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>No collections yet</h3>
          <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>
            Create a collection to organize your products.
          </p>
        </div>
      ) : (
        <>
          <div style={{
            background: '#fff', border: '1px solid #e5e7eb',
            borderRadius: 12, overflow: 'hidden',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <th style={th}>Title</th>
                  <th style={{ ...th, width: 120 }}>Products</th>
                  <th style={{ ...th, width: 180 }}>Product conditions</th>
                </tr>
              </thead>
              <tbody>
                {data.collections.map((c, i) => (
                  <tr
                    key={c.id}
                    onClick={() => router.push(`/dashboard/products/collections/${c.id}`)}
                    style={{
                      borderTop: i > 0 ? '1px solid #f3f4f6' : 'none',
                      cursor: 'pointer',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f9fafb')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                  >
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 40, height: 40, borderRadius: 8,
                          background: '#f3f4f6', border: '1px solid #e5e7eb',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0, overflow: 'hidden',
                        }}>
                          {c.imageUrl ? (
                            <img src={c.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b0b0b0" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>
                          )}
                        </div>
                        <span style={{ fontWeight: 500, fontSize: 14, color: '#111' }}>{c.name}</span>
                      </div>
                    </td>
                    <td style={{ ...td, color: '#374151', fontSize: 14 }}>{c.productCount}</td>
                    <td style={{ ...td, color: '#9ca3af', fontSize: 13 }}>Manual</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data.pagination.totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} style={pageBtn}>&#8249;</button>
              <button disabled={page >= data.pagination.totalPages} onClick={() => setPage(page + 1)} style={pageBtn}>&#8250;</button>
              <span style={{ fontSize: 13, color: '#6b7280' }}>
                {(page - 1) * 50 + 1}-{Math.min(page * 50, data.pagination.total)}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left', padding: '11px 16px',
  fontWeight: 500, fontSize: 13, color: '#6b7280',
};
const td: React.CSSProperties = {
  padding: '12px 16px', verticalAlign: 'middle',
};
const pageBtn: React.CSSProperties = {
  width: 30, height: 30,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  border: '1px solid #d1d5db', borderRadius: 6,
  background: '#fff', fontSize: 15, cursor: 'pointer', color: '#374151',
};
