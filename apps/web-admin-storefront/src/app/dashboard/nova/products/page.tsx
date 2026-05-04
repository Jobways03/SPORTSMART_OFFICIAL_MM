'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { NovaTabs } from '../components/nova-tabs';
import {
  adminNovaService,
  OwnBrandProduct,
  inr,
} from '@/services/admin-nova.service';
import { ApiError } from '@/lib/api-client';

const PAGE_SIZE = 20;

export default function NovaProductsPage() {
  const router = useRouter();
  const [data, setData] = useState<{ items: OwnBrandProduct[]; total: number } | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [convertId, setConvertId] = useState('');
  const [converting, setConverting] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (override?: { page?: number; search?: string }) => {
    setLoading(true);
    try {
      const res = await adminNovaService.listProducts({
        page: override?.page ?? page,
        limit: PAGE_SIZE,
        search: override?.search ?? search,
      });
      if (res.data) setData(res.data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace('/login');
    } finally {
      setLoading(false);
    }
  }, [page, search, router]);

  useEffect(() => {
    fetchData({ page: 1, search: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSearch = (v: string) => {
    setSearch(v);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setPage(1);
      fetchData({ page: 1, search: v });
    }, 300);
  };

  const unconvert = async (productId: string) => {
    if (!confirm('Revert this product to SELLER source? Only allowed when stock is 0.')) return;
    setActioning(productId);
    try {
      await adminNovaService.unconvertProduct(productId);
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not unconvert');
    } finally {
      setActioning(null);
    }
  };

  const convertExisting = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!convertId.trim()) return setError('Product ID is required');
    setConverting(true);
    try {
      await adminNovaService.convertProduct(convertId.trim());
      setConvertId('');
      fetchData({ page: 1, search: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not convert');
    } finally {
      setConverting(false);
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div style={{ padding: '24px 32px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#0F1115' }}>NOVA</h1>
      <p style={{ marginTop: 4, marginBottom: 16, fontSize: 14, color: '#525A65' }}>
        Sportsmart's own-brand warehouses, products, stocks, and procurement.
      </p>
      <NovaTabs />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0, color: '#0F1115' }}>
          Own-brand products{' '}
          <span style={{ color: '#7A828F', fontWeight: 400, fontSize: 14 }}>
            ({data?.total ?? 0})
          </span>
        </h2>
        <input
          type="text" value={search} onChange={(e) => onSearch(e.target.value)}
          placeholder="Search title, slug, NV-SKU…"
          style={{ width: 320, height: 40, padding: '0 14px', border: '1px solid #D2D6DC', borderRadius: 9999, fontSize: 14, outline: 'none' }}
        />
      </div>

      {/* Convert existing helper */}
      <form onSubmit={convertExisting} style={{
        background: '#fefce8', border: '1px solid #facc15', borderRadius: 16, padding: 16, marginBottom: 16,
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#854d0e', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Convert an existing seller product → OWN_BRAND
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={convertId} onChange={(e) => { setConvertId(e.target.value); setError(''); }}
            placeholder="Paste product UUID from /dashboard/products" disabled={converting}
            style={{ flex: 1, height: 38, padding: '0 12px', border: '1px solid #D2D6DC', borderRadius: 9999, fontSize: 13, outline: 'none', fontFamily: 'ui-monospace, monospace' }}
          />
          <button type="submit" disabled={converting || !convertId.trim()} style={{ height: 38, padding: '0 16px', background: '#0F1115', color: '#fff', border: 'none', borderRadius: 9999, fontWeight: 600, fontSize: 13, cursor: converting ? 'not-allowed' : 'pointer', opacity: converting ? 0.5 : 1 }}>
            {converting ? 'Converting…' : 'Convert'}
          </button>
        </div>
        {error && <div style={{ marginTop: 8, padding: 8, border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', borderRadius: 8, fontSize: 13 }}>{error}</div>}
      </form>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
              <th style={th}>NV-SKU</th><th style={th}>Title</th><th style={th}>Slug</th>
              <th style={{ ...th, textAlign: 'right' }}>Base price</th><th style={th}>Status</th>
              <th style={{ ...th, textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#7A828F', padding: 32 }}>Loading…</td></tr>
            ) : !data || data.items.length === 0 ? (
              <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#7A828F', padding: 32 }}>
                No own-brand products yet.
              </td></tr>
            ) : (
              data.items.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#15803d', fontWeight: 600 }}>
                    {p.ownBrandSku || '—'}
                  </td>
                  <td style={{ ...td, fontWeight: 600, color: '#0F1115' }}>{p.title}</td>
                  <td style={{ ...td, color: '#525A65', fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>{p.slug}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{inr(p.basePrice)}</td>
                  <td style={{ ...td, color: '#525A65', textTransform: 'lowercase' }}>{p.status.toLowerCase()}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button type="button" onClick={() => unconvert(p.id)} disabled={actioning === p.id} style={{ ...linkBtn, color: '#b91c1c', opacity: actioning === p.id ? 0.5 : 1 }}>
                      {actioning === p.id ? 'Reverting…' : 'Revert to seller'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={() => { const np = Math.max(1, page - 1); setPage(np); fetchData({ page: np }); }} disabled={page <= 1} style={pgBtn(page <= 1)}>‹ Prev</button>
          <span style={{ fontSize: 14, color: '#525A65', padding: '0 8px' }}>{page} / {totalPages}</span>
          <button type="button" onClick={() => { const np = Math.min(totalPages, page + 1); setPage(np); fetchData({ page: np }); }} disabled={page >= totalPages} style={pgBtn(page >= totalPages)}>Next ›</button>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#525A65' };
const td: React.CSSProperties = { padding: '14px 16px', fontSize: 14 };
const linkBtn: React.CSSProperties = { color: '#2A8595', fontWeight: 600, fontSize: 13, background: 'none', border: 'none', cursor: 'pointer', padding: 0 };
const pgBtn = (disabled: boolean): React.CSSProperties => ({
  height: 36, padding: '0 14px', border: '1px solid #D2D6DC', background: '#fff',
  borderRadius: 9999, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
});
