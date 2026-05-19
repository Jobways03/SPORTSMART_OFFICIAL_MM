'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  adminInventoryService,
  InventoryOverview,
  LowStockItem,
  OutOfStockProduct,
  ActiveReservation,
  Pagination,
} from '@/services/admin-inventory.service';

type Tab = 'overview' | 'low-stock' | 'out-of-stock' | 'reservations';

export default function InventoryPage() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<InventoryOverview | null>(null);
  const [lowStock, setLowStock] = useState<LowStockItem[]>([]);
  const [lowStockPagination, setLowStockPagination] = useState<Pagination | null>(null);
  const [outOfStock, setOutOfStock] = useState<OutOfStockProduct[]>([]);
  const [outOfStockPagination, setOutOfStockPagination] = useState<Pagination | null>(null);
  const [reservations, setReservations] = useState<ActiveReservation[]>([]);
  const [reservationsPagination, setReservationsPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Data fetching ──────────────────────────────────────────────────

  const fetchOverview = useCallback(async () => {
    try {
      const res = await adminInventoryService.getOverview();
      if (res.data) setOverview(res.data);
    } catch (err: any) {
      setError(err.message || 'Failed to load overview');
    }
  }, []);

  const fetchLowStock = useCallback(async (page = 1) => {
    try {
      const res = await adminInventoryService.getLowStock({ page, limit: 20 });
      if (res.data) {
        setLowStock(res.data.items);
        setLowStockPagination(res.data.pagination);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load low stock items');
    }
  }, []);

  const fetchOutOfStock = useCallback(async (page = 1) => {
    try {
      const res = await adminInventoryService.getOutOfStock({ page, limit: 20 });
      if (res.data) {
        setOutOfStock(res.data.items);
        setOutOfStockPagination(res.data.pagination);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load out of stock products');
    }
  }, []);

  const fetchReservations = useCallback(async (page = 1) => {
    try {
      const res = await adminInventoryService.getReservations({ page, limit: 20 });
      if (res.data) {
        setReservations(res.data.reservations);
        setReservationsPagination(res.data.pagination);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load reservations');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const load = async () => {
      if (activeTab === 'overview') {
        await fetchOverview();
      } else if (activeTab === 'low-stock') {
        await fetchLowStock();
      } else if (activeTab === 'out-of-stock') {
        await fetchOutOfStock();
      } else if (activeTab === 'reservations') {
        await fetchReservations();
      }
      setLoading(false);
    };

    load();
  }, [activeTab, fetchOverview, fetchLowStock, fetchOutOfStock, fetchReservations]);

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div style={{ padding: 32 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          Inventory Management
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
          Monitor stock levels, low-stock alerts, out-of-stock products, and active reservations.
        </p>
      </div>

      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '1px solid #e5e7eb' }}>
        {([
          { key: 'overview', label: 'Overview' },
          { key: 'low-stock', label: 'Low Stock' },
          { key: 'out-of-stock', label: 'Out of Stock' },
          { key: 'reservations', label: 'Reservations' },
        ] as { key: Tab; label: string }[]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? '#2563eb' : '#6b7280',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #2563eb' : '2px solid transparent',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{
          padding: '12px 16px',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: 8,
          color: '#dc2626',
          fontSize: 14,
          marginBottom: 16,
        }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#9ca3af' }}>
          Loading...
        </div>
      ) : (
        <>
          {activeTab === 'overview' && overview && <OverviewTab data={overview} />}
          {activeTab === 'low-stock' && (
            <LowStockTab
              items={lowStock}
              pagination={lowStockPagination}
              onPageChange={fetchLowStock}
            />
          )}
          {activeTab === 'out-of-stock' && (
            <OutOfStockTab
              items={outOfStock}
              pagination={outOfStockPagination}
              onPageChange={fetchOutOfStock}
            />
          )}
          {activeTab === 'reservations' && (
            <ReservationsTab
              items={reservations}
              pagination={reservationsPagination}
              onPageChange={fetchReservations}
            />
          )}
        </>
      )}
    </div>
  );
}

// ── Overview Tab ─────────────────────────────────────────────────────────

function OverviewTab({ data }: { data: InventoryOverview }) {
  const cards = [
    { label: 'Mapped Products', value: data.totalMappedProducts, bg: '#eff6ff' },
    { label: 'Mapped Variants', value: data.totalMappedVariants, bg: '#f0fdf4' },
    { label: 'Total Stock', value: data.totalStock, bg: '#faf5ff' },
    { label: 'Reserved', value: data.totalReserved, bg: '#fffbeb' },
    { label: 'Available', value: data.totalAvailable, bg: '#ecfdf5' },
    { label: 'Low Stock', value: data.lowStockCount, bg: '#fffbeb' },
    { label: 'Out of Stock', value: data.outOfStockCount, bg: '#fef2f2' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
      {cards.map(card => (
        <div
          key={card.label}
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            padding: 20,
          }}
        >
          <div style={{
            fontSize: 12,
            fontWeight: 500,
            color: '#6b7280',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            marginBottom: 8,
          }}>
            {card.label}
          </div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>
            {card.value.toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Low Stock Tab ────────────────────────────────────────────────────────

function LowStockTab({
  items,
  pagination,
  onPageChange,
}: {
  items: LowStockItem[];
  pagination: Pagination | null;
  onPageChange: (page: number) => void;
}) {
  if (items.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 48, color: '#9ca3af' }}>
        No low-stock items found. All stock levels are healthy.
      </div>
    );
  }

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              <th style={thStyle}>Product</th>
              <th style={thStyle}>Variant / SKU</th>
              <th style={thStyle}>Seller</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Stock</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Reserved</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Available</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Threshold</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={tdStyle}>{item.productTitle}</td>
                <td style={tdStyle}>
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#6b7280' }}>
                    {item.masterSku || item.variantSku || '-'}
                  </span>
                </td>
                <td style={tdStyle}>{item.sellerName}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{item.stockQty}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{item.reservedQty}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <span style={{
                    color: item.availableStock <= 0 ? '#dc2626' : '#d97706',
                    fontWeight: 600,
                  }}>
                    {item.availableStock}
                  </span>
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{item.lowStockThreshold}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pagination && <PaginationBar pagination={pagination} onPageChange={onPageChange} />}
    </div>
  );
}

// ── Out of Stock Tab ─────────────────────────────────────────────────────

function OutOfStockTab({
  items,
  pagination,
  onPageChange,
}: {
  items: OutOfStockProduct[];
  pagination: Pagination | null;
  onPageChange: (page: number) => void;
}) {
  if (items.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 48, color: '#9ca3af' }}>
        No out-of-stock products found. All products have available stock.
      </div>
    );
  }

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              <th style={thStyle}>Product</th>
              <th style={thStyle}>Code</th>
              <th style={thStyle}>Variant SKU</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Total Stock</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Total Reserved</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Sellers</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={`${item.productId}-${item.variantId}-${idx}`} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={tdStyle}>{item.productTitle}</td>
                <td style={tdStyle}>
                  <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {item.productCode}
                  </span>
                </td>
                <td style={tdStyle}>
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#6b7280' }}>
                    {item.variantSku || '-'}
                  </span>
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{item.totalStock}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{item.totalReserved}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{item.sellerCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pagination && <PaginationBar pagination={pagination} onPageChange={onPageChange} />}
    </div>
  );
}

// ── Reservations Tab ─────────────────────────────────────────────────────

function ReservationsTab({
  items,
  pagination,
  onPageChange,
}: {
  items: ActiveReservation[];
  pagination: Pagination | null;
  onPageChange: (page: number) => void;
}) {
  if (items.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 48, color: '#9ca3af' }}>
        No active reservations found.
      </div>
    );
  }

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              <th style={thStyle}>Product</th>
              <th style={thStyle}>Variant</th>
              <th style={thStyle}>Seller</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Qty</th>
              <th style={thStyle}>Order ID</th>
              <th style={thStyle}>Expires At</th>
              <th style={thStyle}>Created</th>
            </tr>
          </thead>
          <tbody>
            {items.map(r => {
              const expiresAt = new Date(r.expiresAt);
              const isExpiringSoon = expiresAt.getTime() - Date.now() < 5 * 60 * 1000;

              return (
                <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={tdStyle}>{r.product.title}</td>
                  <td style={tdStyle}>
                    <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#6b7280' }}>
                      {r.variant?.sku || '-'}
                    </span>
                  </td>
                  <td style={tdStyle}>{r.seller.name}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{r.quantity}</td>
                  <td style={tdStyle}>
                    <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {r.orderId ? r.orderId.slice(0, 8) + '...' : '-'}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ color: isExpiringSoon ? '#dc2626' : '#6b7280', fontWeight: isExpiringSoon ? 600 : 400 }}>
                      {expiresAt.toLocaleString()}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pagination && <PaginationBar pagination={pagination} onPageChange={onPageChange} />}
    </div>
  );
}

// ── Shared Components ────────────────────────────────────────────────────

function PaginationBar({
  pagination,
  onPageChange,
}: {
  pagination: Pagination;
  onPageChange: (page: number) => void;
}) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '16px 0',
      fontSize: 14,
      color: '#6b7280',
    }}>
      <span>
        Showing page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => onPageChange(pagination.page - 1)}
          disabled={pagination.page <= 1}
          style={paginationBtnStyle(pagination.page <= 1)}
        >
          Previous
        </button>
        <button
          onClick={() => onPageChange(pagination.page + 1)}
          disabled={pagination.page >= pagination.totalPages}
          style={paginationBtnStyle(pagination.page >= pagination.totalPages)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: 12,
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  verticalAlign: 'middle',
};

function paginationBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '6px 14px',
    fontSize: 13,
    border: '1px solid #d1d5db',
    borderRadius: 6,
    background: disabled ? '#f9fafb' : '#fff',
    color: disabled ? '#d1d5db' : '#374151',
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}
