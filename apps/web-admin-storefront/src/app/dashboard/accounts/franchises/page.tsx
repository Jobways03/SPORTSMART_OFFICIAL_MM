'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { adminAccountsService, FranchiseListItem } from '@/services/admin-accounts.service';

const LIMIT = 25;

export default function FranchisesFinanceListPage() {
  const router = useRouter();
  const [items, setItems] = useState<FranchiseListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminAccountsService.listFranchises({ page, limit: LIMIT, search: applied || undefined });
      if (res.data) {
        setItems(res.data.franchises);
        setTotal(res.data.pagination.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, applied]);

  useEffect(() => { void load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div style={{ padding: '24px 32px' }}>
      <Link href="/dashboard/accounts" style={{ fontSize: 13, color: '#525A65', textDecoration: 'none' }}>← Accounts overview</Link>
      <div style={{ marginTop: 12, marginBottom: 16 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#0F1115' }}>Franchise finances</h1>
        <p style={{ marginTop: 4, marginBottom: 0, fontSize: 14, color: '#525A65' }}>
          Select a franchise to see its full financial picture (revenue, POS, procurement, payables, settlements).
        </p>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(search.trim()); }}
        style={{ display: 'flex', gap: 8, margin: '16px 0' }}
      >
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or code…"
          style={{ padding: '8px 12px', border: '1px solid #D2D6DC', borderRadius: 8, fontSize: 13, minWidth: 280 }}
        />
        <button type="submit" style={primaryBtn}>Search</button>
        {applied && <button type="button" onClick={() => { setSearch(''); setApplied(''); setPage(1); }} style={pageBtn}>Clear</button>}
      </form>

      {loading ? (
        <div style={{ padding: 32, color: '#7A828F' }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 32, color: '#7A828F', textAlign: 'center' }}>No franchises found.</div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: '#F9FAFB' }}>
              <tr>
                <th style={th}>Code</th>
                <th style={th}>Business name</th>
                <th style={th}>Status</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((f) => (
                <tr
                  key={f.id}
                  style={{ borderTop: '1px solid #F3F4F6', cursor: 'pointer' }}
                  onClick={() => router.push(`/dashboard/accounts/franchises/${f.id}`)}
                >
                  <td style={td}><code>{f.franchiseCode}</code></td>
                  <td style={{ ...td, fontWeight: 600 }}>{f.businessName}</td>
                  <td style={td}><span style={{ background: '#EEF2FF', color: '#3730A3', padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{f.status}</span></td>
                  <td style={{ ...td, textAlign: 'right', color: '#2563eb' }}>View finances →</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' }}>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} style={pageBtn}>← Prev</button>
          <span style={{ fontSize: 13, color: '#525A65' }}>Page {page} of {totalPages} · {total} total</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={pageBtn}>Next →</button>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#525A65', textTransform: 'uppercase', letterSpacing: 0.5 };
const td: React.CSSProperties = { padding: '12px 14px', fontSize: 13, color: '#0F1115' };
const pageBtn: React.CSSProperties = { background: '#fff', border: '1px solid #D2D6DC', borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: 'pointer', color: '#0F1115' };
const primaryBtn: React.CSSProperties = { ...pageBtn, background: '#0F1115', color: '#fff', border: '1px solid #0F1115', fontWeight: 600 };
