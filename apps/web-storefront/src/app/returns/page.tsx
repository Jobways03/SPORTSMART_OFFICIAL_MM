'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import {
  returnsService,
  ListReturnsResponse,
  getReturnStatusLabel,
  getReturnStatusColor,
} from '@/services/returns.service';

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'REQUESTED', label: 'Pending Review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'IN_TRANSIT', label: 'In Transit' },
  { value: 'RECEIVED', label: 'Received' },
  { value: 'REFUNDED', label: 'Refunded' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export default function ReturnsPage() {
  const router = useRouter();
  const [data, setData] = useState<ListReturnsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');

  const fetchReturns = (p: number, status: string) => {
    setLoading(true);
    returnsService
      .list(p, 20, status || undefined)
      .then((res) => {
        if (res.data) setData(res.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    try {
      if (!sessionStorage.getItem('accessToken')) {
        router.push('/login');
        return;
      }
    } catch {
      router.push('/login');
      return;
    }
    fetchReturns(page, statusFilter);
  }, [page, statusFilter]);

  const formatPrice = (price: number | null) =>
    price == null ? '-' : `\u20B9${Number(price).toLocaleString('en-IN')}`;
  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  if (loading && !data) {
    return (
      <>
        <Navbar />
        <div className="products-loading">Loading returns...</div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px 60px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>My Returns</h1>
          <Link
            href="/orders"
            style={{ fontSize: 14, color: '#6b7280', textDecoration: 'none' }}
          >
            &#8592; Back to Orders
          </Link>
        </div>

        {/* Status filter */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: 20,
            flexWrap: 'wrap',
          }}
        >
          {STATUS_FILTERS.map((s) => {
            const active = statusFilter === s.value;
            return (
              <button
                key={s.value || 'all'}
                onClick={() => {
                  setStatusFilter(s.value);
                  setPage(1);
                }}
                style={{
                  padding: '6px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  border: active ? '1px solid #2563eb' : '1px solid #e5e7eb',
                  background: active ? '#2563eb' : '#fff',
                  color: active ? '#fff' : '#374151',
                  borderRadius: 20,
                  cursor: 'pointer',
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        {!data || data.returns.length === 0 ? (
          <div
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 10,
              padding: '60px 20px',
              textAlign: 'center',
              background: '#fafafa',
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 12 }}>&#128230;</div>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
              No returns found
            </h3>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
              {statusFilter
                ? 'Try changing the status filter.'
                : 'Your return requests will appear here.'}
            </p>
            <Link
              href="/orders"
              style={{
                display: 'inline-block',
                padding: '10px 20px',
                background: '#2563eb',
                color: '#fff',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              View Orders
            </Link>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {data.returns.map((ret) => {
              const statusLabel = getReturnStatusLabel(ret.status);
              const statusColor = getReturnStatusColor(ret.status);
              const itemCount = ret.items.reduce((sum, it) => sum + it.quantity, 0);
              return (
                <Link
                  key={ret.id}
                  href={`/returns/${ret.id}`}
                  style={{
                    display: 'block',
                    border: '1px solid #e5e7eb',
                    borderRadius: 10,
                    padding: 16,
                    background: '#fff',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 8,
                      flexWrap: 'wrap',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 15, fontWeight: 700 }}>
                        {ret.returnNumber}
                      </span>
                      <span style={{ fontSize: 12, color: '#6b7280' }}>
                        Order {ret.masterOrder?.orderNumber || '-'} &middot;{' '}
                        {formatDate(ret.createdAt)}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        padding: '3px 10px',
                        borderRadius: 4,
                        background: statusColor + '20',
                        color: statusColor,
                      }}
                    >
                      {statusLabel}
                    </span>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: 13,
                      color: '#6b7280',
                    }}
                  >
                    <span>
                      {itemCount} item{itemCount !== 1 ? 's' : ''}
                    </span>
                    <span style={{ fontWeight: 600, color: '#111' }}>
                      {ret.refundAmount != null
                        ? `Refund: ${formatPrice(Number(ret.refundAmount))}`
                        : 'Refund: Pending'}
                    </span>
                  </div>
                </Link>
              );
            })}

            {data.pagination.totalPages > 1 && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: 12,
                  marginTop: 20,
                }}
              >
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  style={{
                    padding: '8px 16px',
                    fontSize: 13,
                    border: '1px solid #e5e7eb',
                    background: '#fff',
                    borderRadius: 8,
                    cursor: page <= 1 ? 'not-allowed' : 'pointer',
                    opacity: page <= 1 ? 0.5 : 1,
                  }}
                >
                  Previous
                </button>
                <span style={{ fontSize: 13, color: '#6b7280' }}>
                  Page {page} of {data.pagination.totalPages}
                </span>
                <button
                  disabled={page >= data.pagination.totalPages}
                  onClick={() => setPage(page + 1)}
                  style={{
                    padding: '8px 16px',
                    fontSize: 13,
                    border: '1px solid #e5e7eb',
                    background: '#fff',
                    borderRadius: 8,
                    cursor: page >= data.pagination.totalPages ? 'not-allowed' : 'pointer',
                    opacity: page >= data.pagination.totalPages ? 0.5 : 1,
                  }}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
