'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
  // Phase 38 (2026-05-21) — multi-select for bulk activate/deactivate.
  // Pre-Phase-38 the audit (gap #19) noted admin had to open each
  // collection to flip its active state.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState<'activate' | 'deactivate' | null>(null);

  const fetchCollections = useCallback((p: number) => {
    setLoading(true);
    apiClient<CollectionsResponse>(`/admin/collections?page=${p}&limit=50`)
      .then((res) => { if (res.data) setData(res.data); })
      .catch((err) => console.warn(err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchCollections(page); }, [page, fetchCollections]);

  const clearSelection = () => setSelected(new Set());

  // Phase 38 (2026-05-21) — single-collection toggle. Optimistic so
  // the badge flips instantly; failure case re-fetches to revert.
  const handleToggleActive = async (e: React.MouseEvent, c: Collection) => {
    e.stopPropagation(); // don't open the detail page
    const next = !c.isActive;
    setData((prev) =>
      prev
        ? { ...prev, collections: prev.collections.map((row) => (row.id === c.id ? { ...row, isActive: next } : row)) }
        : prev,
    );
    try {
      await apiClient(`/admin/collections/${c.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: next }),
      });
    } catch {
      fetchCollections(page);
    }
  };

  // Phase 38 (2026-05-21) — bulk activate/deactivate via the existing
  // PATCH endpoint. Sequential per-row because there's no bulk-update
  // backend route today — that's another phase. Still ~10 RTT for a
  // bulk of 10, which is acceptable for the admin workflow.
  const runBulk = async (mode: 'activate' | 'deactivate') => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    setBulkSaving(mode);
    try {
      await Promise.all(
        ids.map((id) =>
          apiClient(`/admin/collections/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ isActive: mode === 'activate' }),
          }).catch(() => undefined),
        ),
      );
      clearSelection();
      fetchCollections(page);
    } finally {
      setBulkSaving(null);
    }
  };

  const allOnPageSelected =
    !!data && data.collections.length > 0 &&
    data.collections.every((c) => selected.has(c.id));

  const togglePageSelection = () => {
    if (!data) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        for (const c of data.collections) next.delete(c.id);
      } else {
        for (const c of data.collections) next.add(c.id);
      }
      return next;
    });
  };

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

      {/* Phase 38 (2026-05-21) — bulk action bar; renders only when
          at least one row is selected. */}
      {selected.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', marginBottom: 12,
          background: '#f0f7ff', border: '1px solid #bfdbfe', borderRadius: 8,
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1e40af' }}>
            {selected.size} selected
          </span>
          <button
            onClick={() => runBulk('activate')}
            disabled={!!bulkSaving}
            style={bulkBtn}
          >
            {bulkSaving === 'activate' ? 'Activating…' : 'Activate'}
          </button>
          <button
            onClick={() => runBulk('deactivate')}
            disabled={!!bulkSaving}
            style={{ ...bulkBtn, background: '#fff' }}
          >
            {bulkSaving === 'deactivate' ? 'Deactivating…' : 'Deactivate'}
          </button>
          <button onClick={clearSelection} style={{ ...bulkBtn, background: 'transparent', border: 'none', color: '#1e40af' }}>
            Clear
          </button>
        </div>
      )}

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
                  <th style={{ ...th, width: 36, paddingLeft: 16 }}>
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={togglePageSelection}
                      aria-label="Select all collections on this page"
                    />
                  </th>
                  <th style={th}>Title</th>
                  <th style={{ ...th, width: 120 }}>Products</th>
                  {/* Phase 38 (2026-05-21) — Active column (audit #19). */}
                  <th style={{ ...th, width: 110 }}>Active</th>
                  <th style={{ ...th, width: 100 }}>Audit</th>
                </tr>
              </thead>
              <tbody>
                {data.collections.map((c, i) => (
                  <tr
                    key={c.id}
                    style={{
                      borderTop: i > 0 ? '1px solid #f3f4f6' : 'none',
                      transition: 'background 0.1s',
                      background: selected.has(c.id) ? '#f0f7ff' : 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (!selected.has(c.id)) e.currentTarget.style.background = '#f9fafb';
                    }}
                    onMouseLeave={(e) => {
                      if (!selected.has(c.id)) e.currentTarget.style.background = '';
                    }}
                  >
                    <td style={{ ...td, paddingLeft: 16 }}>
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(c.id)) next.delete(c.id);
                            else next.add(c.id);
                            return next;
                          });
                        }}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select ${c.name}`}
                      />
                    </td>
                    <td
                      style={{ ...td, cursor: 'pointer' }}
                      onClick={() => router.push(`/dashboard/products/collections/${c.id}`)}
                    >
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
                    <td style={td}>
                      <button
                        onClick={(e) => handleToggleActive(e, c)}
                        style={{
                          padding: '4px 10px', fontSize: 11, fontWeight: 700,
                          letterSpacing: 0.4, textTransform: 'uppercase',
                          borderRadius: 999, border: 'none', cursor: 'pointer',
                          background: c.isActive ? '#dcfce7' : '#f3f4f6',
                          color: c.isActive ? '#166534' : '#6b7280',
                        }}
                        title="Click to toggle"
                      >
                        {c.isActive ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td style={td}>
                      <Link
                        href={`/dashboard/products/collections/${c.id}/audit-log`}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          padding: '4px 10px', fontSize: 11, borderRadius: 4,
                          border: '1px solid #d1d5db', background: '#fff',
                          textDecoration: 'none', fontWeight: 500, color: '#374151',
                        }}
                      >
                        Audit
                      </Link>
                    </td>
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
const bulkBtn: React.CSSProperties = {
  padding: '6px 14px', fontSize: 12, fontWeight: 600,
  borderRadius: 6, border: '1px solid #bfdbfe',
  background: '#fff', cursor: 'pointer', color: '#1e40af',
};
