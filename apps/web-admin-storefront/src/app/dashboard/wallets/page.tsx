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
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#0F1115' }}>
            Wallets
          </h1>
          <p style={{ marginTop: 4, fontSize: 14, color: '#525A65' }}>
            {pagination.total.toLocaleString('en-IN')} wallet{pagination.total === 1 ? '' : 's'}
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
              <tr>
                <td colSpan={5} style={{ ...td, textAlign: 'center', color: '#7A828F', padding: 32 }}>
                  Loading wallets…
                </td>
              </tr>
            ) : wallets.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ ...td, textAlign: 'center', color: '#7A828F', padding: 32 }}>
                  No wallets found.
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
                        color: BigInt(w.balanceInPaise) > 0n ? '#15803d' : '#0F1115',
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
                        color: '#2A8595',
                        fontWeight: 600,
                        textDecoration: 'none',
                        fontSize: 13,
                      }}
                    >
                      View →
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
