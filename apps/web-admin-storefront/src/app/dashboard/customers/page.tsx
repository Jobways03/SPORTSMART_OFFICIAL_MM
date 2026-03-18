'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  status: string;
  emailVerified: boolean;
  createdAt: string;
  location: string | null;
  orderCount: number;
  amountSpent: number;
}

interface CustomersResponse {
  customers: Customer[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const fmt = (n: number) =>
  `\u20B9${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function CustomersPage() {
  const router = useRouter();
  const [data, setData] = useState<CustomersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const fetchCustomers = useCallback((p: number) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: '50' });
    if (search.trim()) params.set('search', search.trim());

    apiClient<CustomersResponse>(`/admin/customers?${params}`)
      .then((res) => { if (res.data) setData(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [search]);

  useEffect(() => { fetchCustomers(page); }, [page, fetchCustomers]);

  const handleSearch = () => { setPage(1); fetchCustomers(1); };

  return (
    <div>
      {/* Header */}
      {data && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 16,
          fontSize: 13, color: '#374151', marginBottom: 16,
        }}>
          <span style={{ fontWeight: 700 }}>{data.pagination.total} customers</span>
          <span style={{ color: '#9ca3af' }}>100% of your customer base</span>
        </div>
      )}

      {/* Search */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: 14 }}>
            &#128269;
          </span>
          <input
            type="text"
            placeholder="Search customers"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            style={{
              width: '100%', padding: '10px 12px 10px 36px', fontSize: 14,
              border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff',
              outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      {loading && !data ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>Loading customers...</div>
      ) : !data || data.customers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>&#128101;</div>
          <h3 style={{ fontWeight: 600, marginBottom: 8 }}>No customers {search ? 'match your search' : 'yet'}</h3>
          <p style={{ color: '#6b7280' }}>
            {search ? 'Try a different search term.' : 'Customers will appear here once they create an account.'}
          </p>
        </div>
      ) : (
        <>
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <th style={thStyle}>Customer name</th>
                  <th style={thStyle}>Email subscription</th>
                  <th style={thStyle}>Location</th>
                  <th style={thStyle}>Orders</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Amount spent</th>
                </tr>
              </thead>
              <tbody>
                {data.customers.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => router.push(`/dashboard/customers/${c.id}`)}
                    style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f9fafb')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                  >
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 500, color: '#111' }}>
                        {c.firstName} {c.lastName}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      {c.emailVerified ? (
                        <span style={{
                          display: 'inline-block', padding: '3px 10px', fontSize: 12,
                          fontWeight: 600, borderRadius: 4, background: '#dcfce7', color: '#16a34a',
                        }}>
                          Subscribed
                        </span>
                      ) : (
                        <span style={{
                          display: 'inline-block', padding: '3px 10px', fontSize: 12,
                          fontWeight: 500, borderRadius: 4, background: '#f3f4f6', color: '#6b7280',
                        }}>
                          Not subscribed
                        </span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, color: '#374151' }}>
                      {c.location || ''}
                    </td>
                    <td style={{ ...tdStyle, color: '#374151' }}>
                      {c.orderCount} order{c.orderCount !== 1 ? 's' : ''}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 500, color: '#111' }}>
                      {fmt(c.amountSpent)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                style={pageBtnStyle}
              >
                &#8249;
              </button>
              <button
                disabled={page >= data.pagination.totalPages}
                onClick={() => setPage(page + 1)}
                style={pageBtnStyle}
              >
                &#8250;
              </button>
            </div>
            <span style={{ fontSize: 13, color: '#6b7280' }}>
              {(page - 1) * data.pagination.limit + 1}-{Math.min(page * data.pagination.limit, data.pagination.total)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 16px',
  fontWeight: 500,
  fontSize: 13,
  color: '#6b7280',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '12px 16px',
  verticalAlign: 'middle',
  fontSize: 14,
};

const pageBtnStyle: React.CSSProperties = {
  width: 32, height: 32,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  border: '1px solid #d1d5db', borderRadius: 6,
  background: '#fff', fontSize: 16, cursor: 'pointer', color: '#374151',
};
