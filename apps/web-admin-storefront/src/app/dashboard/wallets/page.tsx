'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  adminWalletService,
  AdminWalletListItem,
  formatPaise,
} from '@/services/admin-wallet.service';
import { ApiError } from '@/lib/api-client';

interface Pagination {
  page: number;
  limit: number;
  total: number;
}

export default function WalletsPage() {
  const router = useRouter();
  const [wallets, setWallets] = useState<AdminWalletListItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchWallets = useCallback(
    async (params: { page?: number; search?: string } = {}) => {
      setLoading(true);
      setError('');
      try {
        const res = await adminWalletService.list({
          page: params.page ?? pagination.page,
          limit: 20,
          search: params.search !== undefined ? params.search : search,
        });
        if (res.data) {
          setWallets(res.data.items);
          setPagination({
            page: res.data.page,
            limit: res.data.limit,
            total: res.data.total,
          });
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace('/login');
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load wallets');
      } finally {
        setLoading(false);
      }
    },
    [pagination.page, search, router],
  );

  useEffect(() => {
    fetchWallets({ page: 1, search: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSearchChange = (v: string) => {
    setSearch(v);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      fetchWallets({ page: 1, search: v });
    }, 300);
  };

  const goToPage = (p: number) => {
    fetchWallets({ page: p });
  };

  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.limit));

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0F1115' }}>
            Wallets
          </h1>
          <p style={{ marginTop: 6, fontSize: 13, color: '#525A65' }}>
            {pagination.total.toLocaleString('en-IN')} wallet{pagination.total === 1 ? '' : 's'} on file.
          </p>
        </div>

        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by email or name…"
          style={{
            width: 320,
            height: 40,
            padding: '0 14px',
            border: '1px solid #D2D6DC',
            borderRadius: 9999,
            fontSize: 14,
            outline: 'none',
          }}
        />
      </div>

      {error && (
        <div
          style={{
            padding: 12,
            border: '1px solid #fca5a5',
            background: '#fef2f2',
            color: '#b91c1c',
            borderRadius: 12,
            fontSize: 14,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          background: '#fff',
          border: '1px solid #E5E7EB',
          borderRadius: 16,
          overflow: 'hidden',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
              <th style={th}>Customer</th>
              <th style={th}>Email</th>
              <th style={{ ...th, textAlign: 'right' }}>Balance</th>
              <th style={th}>Updated</th>
              <th style={{ ...th, textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading && wallets.length === 0 ? (
              [0, 1, 2, 3, 4].map((i) => (
                <tr key={`skel-${i}`} style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <td style={td}>
                    <div style={{ width: '60%', height: 14, background: '#F3F4F6', borderRadius: 4 }} />
                  </td>
                  <td style={td}>
                    <div style={{ width: '80%', height: 14, background: '#F3F4F6', borderRadius: 4 }} />
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <div style={{ width: 90, height: 14, background: '#F3F4F6', borderRadius: 4, marginLeft: 'auto' }} />
                  </td>
                  <td style={td}>
                    <div style={{ width: 100, height: 14, background: '#F3F4F6', borderRadius: 4 }} />
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <div style={{ width: 50, height: 14, background: '#F3F4F6', borderRadius: 4, marginLeft: 'auto' }} />
                  </td>
                </tr>
              ))
            ) : wallets.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ ...td, textAlign: 'center', color: '#7A828F', padding: 48 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 9999, background: '#F3F4F6',
                    margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M3 7a2 2 0 0 1 2-2h13v4" />
                      <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" />
                      <path d="M16 13h5v-3h-5a1.5 1.5 0 0 0 0 3z" />
                    </svg>
                  </div>
                  <div style={{ fontSize: 14, color: '#0F1115', fontWeight: 600 }}>No wallets found</div>
                  <div style={{ fontSize: 13, color: '#525A65', marginTop: 4 }}>
                    Try a different search term.
                  </div>
                </td>
              </tr>
            ) : (
              wallets.map((w) => (
                <tr key={w.walletId} style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <td style={td}>
                    <span style={{ fontWeight: 600, color: '#0F1115' }}>
                      {w.userFullName || '—'}
                    </span>
                  </td>
                  <td style={td}>
                    <span style={{ color: '#525A65' }}>{w.userEmail}</span>
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    <span
                      style={{
                        fontWeight: 600,
                        // Compare via BigInt so the sign check works
                        // identically for `number` and `string` inputs
                        // (BigInt-serialised balances arrive as strings).
                        color: BigInt(w.balanceInPaise) > BigInt(0) ? '#15803d' : '#0F1115',
                      }}
                    >
                      {formatPaise(w.balanceInPaise)}
                    </span>
                  </td>
                  <td style={{ ...td, color: '#525A65' }}>
                    {new Date(w.updatedAt).toLocaleString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <Link
                      href={`/dashboard/wallets/${w.userId}`}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        height: 28, padding: '0 12px',
                        color: '#0F1115', fontWeight: 600, fontSize: 12,
                        background: '#fff', border: '1px solid #D2D6DC', borderRadius: 9999,
                        textDecoration: 'none',
                      }}
                    >
                      View
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                           stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 }}>
          <button
            type="button"
            onClick={() => goToPage(Math.max(1, pagination.page - 1))}
            disabled={pagination.page <= 1 || loading}
            style={paginationBtn(pagination.page <= 1)}
          >
            ‹ Prev
          </button>
          <span style={{ fontSize: 14, color: '#525A65', padding: '0 8px', fontVariantNumeric: 'tabular-nums' }}>
            {pagination.page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => goToPage(Math.min(totalPages, pagination.page + 1))}
            disabled={pagination.page >= totalPages || loading}
            style={paginationBtn(pagination.page >= totalPages)}
          >
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '12px 16px',
  textAlign: 'left',
  fontSize: 12,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#525A65',
};

const td: React.CSSProperties = {
  padding: '14px 16px',
  fontSize: 14,
};

const paginationBtn = (disabled: boolean): React.CSSProperties => ({
  height: 36,
  padding: '0 14px',
  border: '1px solid #D2D6DC',
  background: '#fff',
  borderRadius: 9999,
  fontSize: 13,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.4 : 1,
});
