'use client';

// Seller-portal inventory dashboard. All data is scoped to the logged-in
// seller by the backend (SellerAuthGuard). Mirrors the Super Admin
// inventory page shape so admins and sellers see a consistent view.

import { useCallback, useEffect, useState } from 'react';
import {
  sellerInventoryService,
  InventoryOverview,
  InventoryItem,
  Pagination,
} from '@/services/inventory.service';

type Tab = 'overview' | 'low-stock' | 'out-of-stock';

export default function SellerInventoryPage() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<InventoryOverview | null>(null);
  const [lowStock, setLowStock] = useState<InventoryItem[]>([]);
  const [lowStockPage, setLowStockPage] = useState<Pagination | null>(null);
  const [outOfStock, setOutOfStock] = useState<InventoryItem[]>([]);
  const [outOfStockPage, setOutOfStockPage] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    try {
      const res = await sellerInventoryService.getOverview();
      if (res.data) setOverview(res.data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load overview');
    }
  }, []);

  const fetchLowStock = useCallback(async (page = 1) => {
    try {
      const res = await sellerInventoryService.getLowStock({ page, limit: 20 });
      if (res.data) {
        setLowStock(res.data.items);
        setLowStockPage(res.data.pagination);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load low stock items');
    }
  }, []);

  const fetchOutOfStock = useCallback(async (page = 1) => {
    try {
      const res = await sellerInventoryService.getOutOfStock({ page, limit: 20 });
      if (res.data) {
        setOutOfStock(res.data.items);
        setOutOfStockPage(res.data.pagination);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load out of stock items');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const load = async () => {
      if (activeTab === 'overview') await fetchOverview();
      else if (activeTab === 'low-stock') await fetchLowStock();
      else if (activeTab === 'out-of-stock') await fetchOutOfStock();
      setLoading(false);
    };
    void load();
  }, [activeTab, fetchOverview, fetchLowStock, fetchOutOfStock]);

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Inventory</h1>
      <p style={{ color: '#666', marginBottom: 20 }}>
        Stock levels for your products — only items mapped to your shop are shown.
      </p>

      {error && (
        <div style={{
          background: '#fee2e2', color: '#991b1b', padding: 12,
          borderRadius: 6, marginBottom: 16, fontSize: 13,
        }}>{error}</div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e5e7eb', marginBottom: 20 }}>
        {([
          { key: 'overview', label: 'Overview' },
          { key: 'low-stock', label: `Low Stock${overview ? ` (${overview.lowStockCount})` : ''}` },
          { key: 'out-of-stock', label: `Out of Stock${overview ? ` (${overview.outOfStockCount})` : ''}` },
        ] as Array<{ key: Tab; label: string }>).map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '10px 16px',
              border: 'none',
              borderBottom: activeTab === t.key ? '2px solid #2563eb' : '2px solid transparent',
              background: 'transparent',
              color: activeTab === t.key ? '#2563eb' : '#6b7280',
              fontWeight: activeTab === t.key ? 600 : 500,
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: '#666' }}>Loading…</p>
      ) : activeTab === 'overview' ? (
        <OverviewCards overview={overview} />
      ) : activeTab === 'low-stock' ? (
        <InventoryTable
          items={lowStock}
          pagination={lowStockPage}
          emptyMessage="No low-stock items. All your mapped products have sufficient stock."
          showThreshold
          onPageChange={(p) => fetchLowStock(p)}
        />
      ) : (
        <InventoryTable
          items={outOfStock}
          pagination={outOfStockPage}
          emptyMessage="No out-of-stock items. Everything is in stock."
          onPageChange={(p) => fetchOutOfStock(p)}
        />
      )}
    </div>
  );
}

function OverviewCards({ overview }: { overview: InventoryOverview | null }) {
  if (!overview) {
    return <p style={{ color: '#666' }}>No data.</p>;
  }
  const cards: Array<{ label: string; value: number; color: string }> = [
    { label: 'Total products', value: overview.totalMappedProducts, color: '#111827' },
    { label: 'Total stock', value: overview.totalStock, color: '#111827' },
    { label: 'Total available', value: overview.totalAvailable, color: '#16a34a' },
    { label: 'Reserved', value: overview.totalReserved, color: '#6b7280' },
    { label: 'Low stock', value: overview.lowStockCount, color: '#d97706' },
    { label: 'Out of stock', value: overview.outOfStockCount, color: '#dc2626' },
  ];
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12,
    }}>
      {cards.map((c) => (
        <div key={c.label} style={{
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16,
        }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{c.label}</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: c.color }}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}

function InventoryTable({
  items,
  pagination,
  emptyMessage,
  showThreshold,
  onPageChange,
}: {
  items: InventoryItem[];
  pagination: Pagination | null;
  emptyMessage: string;
  showThreshold?: boolean;
  onPageChange: (p: number) => void;
}) {
  if (items.length === 0) {
    return <p style={{ color: '#6b7280', padding: 16 }}>{emptyMessage}</p>;
  }
  return (
    <>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: '#f9fafb', textAlign: 'left' }}>
            <tr>
              <th style={th}>Product</th>
              <th style={th}>Variant / SKU</th>
              <th style={{ ...th, textAlign: 'right' }}>Stock</th>
              <th style={{ ...th, textAlign: 'right' }}>Reserved</th>
              <th style={{ ...th, textAlign: 'right' }}>Available</th>
              {showThreshold && <th style={{ ...th, textAlign: 'right' }}>Threshold</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                <td style={td}>{it.productTitle}</td>
                <td style={{ ...td, color: '#6b7280', fontFamily: 'monospace', fontSize: 11 }}>
                  {it.variantSku ?? '—'}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>{it.stockQty}</td>
                <td style={{ ...td, textAlign: 'right' }}>{it.reservedQty}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600,
                  color: it.availableStock <= 0 ? '#dc2626' : it.availableStock <= it.lowStockThreshold ? '#d97706' : '#16a34a',
                }}>
                  {it.availableStock}
                </td>
                {showThreshold && <td style={{ ...td, textAlign: 'right', color: '#6b7280' }}>{it.lowStockThreshold}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pagination && pagination.totalPages > 1 && (
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
          <span style={{ color: '#6b7280' }}>
            Page {pagination.page} of {pagination.totalPages} · {pagination.total} item{pagination.total === 1 ? '' : 's'}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              style={btnPagination(pagination.page <= 1)}
            >
              Previous
            </button>
            <button
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              style={btnPagination(pagination.page >= pagination.totalPages)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
}

const th: React.CSSProperties = { padding: '10px 12px', fontWeight: 600, fontSize: 12, color: '#374151' };
const td: React.CSSProperties = { padding: '10px 12px' };
const btnPagination = (disabled: boolean): React.CSSProperties => ({
  background: '#fff',
  border: '1px solid #d1d5db',
  padding: '6px 12px',
  borderRadius: 4,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
  fontSize: 12,
});
