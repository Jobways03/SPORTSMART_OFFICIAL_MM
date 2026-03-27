'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, ApiError } from '@/lib/api-client';

// ---- Types ----

interface InventoryOverview {
  totalMappedProducts: number;
  totalMappedVariants: number;
  totalStock: number;
  totalReserved: number;
  totalAvailable: number;
  lowStockCount: number;
  outOfStockCount: number;
}

interface LowStockItem {
  id: string;
  sellerId: string;
  sellerName: string;
  productId: string;
  productTitle: string;
  variantId: string | null;
  variantSku: string | null;
  masterSku: string | null;
  stockQty: number;
  reservedQty: number;
  availableStock: number;
  lowStockThreshold: number;
  isActive: boolean;
}

interface OutOfStockProduct {
  productId: string;
  productTitle: string;
  productCode: string;
  hasVariants: boolean;
  variantId: string | null;
  variantSku: string | null;
  totalStock: number;
  totalReserved: number;
  sellerCount: number;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

type TabKey = 'overview' | 'lowStock' | 'outOfStock';

// ---- Component ----

export default function InventoryDashboardPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  // Overview data
  const [overview, setOverview] = useState<InventoryOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);

  // Low stock data
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([]);
  const [lowStockPagination, setLowStockPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [lowStockLoading, setLowStockLoading] = useState(false);

  // Out of stock data
  const [outOfStockItems, setOutOfStockItems] = useState<OutOfStockProduct[]>([]);
  const [outOfStockPagination, setOutOfStockPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [outOfStockLoading, setOutOfStockLoading] = useState(false);

  const fetchOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const res = await apiClient<InventoryOverview>('/admin/inventory/overview');
      if (res.data) setOverview(res.data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
    } finally {
      setOverviewLoading(false);
    }
  }, [router]);

  const fetchLowStock = useCallback(async (page = 1) => {
    setLowStockLoading(true);
    try {
      const res = await apiClient<{ items: LowStockItem[]; pagination: Pagination }>(
        `/admin/inventory/low-stock?page=${page}&limit=20`,
      );
      if (res.data) {
        setLowStockItems(res.data.items);
        setLowStockPagination(res.data.pagination);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
    } finally {
      setLowStockLoading(false);
    }
  }, [router]);

  const fetchOutOfStock = useCallback(async (page = 1) => {
    setOutOfStockLoading(true);
    try {
      const res = await apiClient<{ items: OutOfStockProduct[]; pagination: Pagination }>(
        `/admin/inventory/out-of-stock?page=${page}&limit=20`,
      );
      if (res.data) {
        setOutOfStockItems(res.data.items);
        setOutOfStockPagination(res.data.pagination);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
    } finally {
      setOutOfStockLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  useEffect(() => {
    if (activeTab === 'lowStock' && lowStockItems.length === 0 && !lowStockLoading) {
      fetchLowStock();
    }
    if (activeTab === 'outOfStock' && outOfStockItems.length === 0 && !outOfStockLoading) {
      fetchOutOfStock();
    }
  }, [activeTab, lowStockItems.length, outOfStockItems.length, lowStockLoading, outOfStockLoading, fetchLowStock, fetchOutOfStock]);

  // ---- Styles ----

  const pageStyle: React.CSSProperties = {
    padding: '28px 32px 40px',
    maxWidth: '100%',
    minHeight: '100vh',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  };

  const headerStyle: React.CSSProperties = {
    marginBottom: 28,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: 24,
    fontWeight: 700,
    color: '#1a1a1a',
    letterSpacing: -0.3,
  };

  const cardStyle: React.CSSProperties = {
    background: '#fff',
    border: '1px solid #e3e3e3',
    borderRadius: 12,
    padding: '20px 24px',
    marginBottom: 20,
  };

  const statGridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 16,
    marginBottom: 24,
  };

  const statCardStyle: React.CSSProperties = {
    background: '#fff',
    border: '1px solid #e3e3e3',
    borderRadius: 12,
    padding: '20px 24px',
    textAlign: 'center',
  };

  const statValueStyle: React.CSSProperties = {
    fontSize: 28,
    fontWeight: 700,
    color: '#1a1a1a',
    lineHeight: 1.2,
  };

  const statLabelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 500,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
  };

  const tabBarStyle: React.CSSProperties = {
    display: 'flex',
    gap: 0,
    borderBottom: '2px solid #e3e3e3',
    marginBottom: 20,
  };

  const getTabStyle = (tab: TabKey): React.CSSProperties => ({
    padding: '10px 20px',
    fontSize: 14,
    fontWeight: 600,
    color: activeTab === tab ? '#1a1a1a' : '#6b7280',
    background: 'none',
    border: 'none',
    borderBottom: activeTab === tab ? '2px solid #1a1a1a' : '2px solid transparent',
    cursor: 'pointer',
    marginBottom: -2,
    transition: 'color 0.15s, border-color 0.15s',
  });

  const thStyle: React.CSSProperties = {
    textAlign: 'left',
    padding: '8px 10px',
    fontWeight: 600,
    color: '#374151',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    whiteSpace: 'nowrap',
    borderBottom: '2px solid #e3e3e3',
  };

  const tdStyle: React.CSSProperties = {
    padding: '10px 10px',
    fontSize: 13,
    color: '#374151',
    borderBottom: '1px solid #f3f4f6',
  };

  const paginationStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    fontSize: 13,
    color: '#6b7280',
  };

  const paginationBtnStyle = (disabled: boolean): React.CSSProperties => ({
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 500,
    border: '1px solid #e3e3e3',
    borderRadius: 8,
    background: disabled ? '#f9fafb' : '#fff',
    color: disabled ? '#d1d5db' : '#374151',
    cursor: disabled ? 'not-allowed' : 'pointer',
  });

  function getMappingStatusBadge(status: string): React.CSSProperties {
    switch (status) {
      case 'ACTIVE': return { background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' };
      case 'LOW_STOCK': return { background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' };
      case 'OUT_OF_STOCK': return { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' };
      case 'INACTIVE': return { background: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb' };
      default: return { background: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb' };
    }
  }

  // ---- Render ----

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <h1 style={titleStyle}>Inventory Overview</h1>
        <p style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>
          Monitor stock levels across all sellers and products
        </p>
      </div>

      {/* Summary Stats */}
      {overviewLoading ? (
        <div style={statGridStyle}>
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} style={{ ...statCardStyle, minHeight: 90 }}>
              <div style={{ width: 60, height: 28, background: '#f3f4f6', borderRadius: 6, margin: '0 auto 6px' }} />
              <div style={{ width: 80, height: 14, background: '#f3f4f6', borderRadius: 4, margin: '0 auto' }} />
            </div>
          ))}
        </div>
      ) : overview ? (
        <div style={statGridStyle}>
          <div style={statCardStyle}>
            <div style={statValueStyle}>{overview.totalMappedProducts.toLocaleString()}</div>
            <div style={statLabelStyle}>Total Products</div>
          </div>
          <div style={statCardStyle}>
            <div style={statValueStyle}>{overview.totalStock.toLocaleString()}</div>
            <div style={statLabelStyle}>Total Stock</div>
          </div>
          <div style={statCardStyle}>
            <div style={statValueStyle}>{overview.totalAvailable.toLocaleString()}</div>
            <div style={statLabelStyle}>Total Available</div>
          </div>
          <div style={statCardStyle}>
            <div style={{ ...statValueStyle, color: overview.lowStockCount > 0 ? '#d97706' : '#1a1a1a' }}>
              {overview.lowStockCount.toLocaleString()}
            </div>
            <div style={statLabelStyle}>Low Stock</div>
          </div>
          <div style={statCardStyle}>
            <div style={{ ...statValueStyle, color: overview.outOfStockCount > 0 ? '#dc2626' : '#1a1a1a' }}>
              {overview.outOfStockCount.toLocaleString()}
            </div>
            <div style={statLabelStyle}>Out of Stock</div>
          </div>
        </div>
      ) : null}

      {/* Tabs */}
      <div style={tabBarStyle}>
        <button style={getTabStyle('overview')} onClick={() => setActiveTab('overview')}>Overview</button>
        <button style={getTabStyle('lowStock')} onClick={() => setActiveTab('lowStock')}>
          Low Stock {overview && overview.lowStockCount > 0 ? `(${overview.lowStockCount})` : ''}
        </button>
        <button style={getTabStyle('outOfStock')} onClick={() => setActiveTab('outOfStock')}>
          Out of Stock {overview && overview.outOfStockCount > 0 ? `(${overview.outOfStockCount})` : ''}
        </button>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div style={cardStyle}>
          {overviewLoading ? (
            <p style={{ fontSize: 14, color: '#6b7280' }}>Loading overview...</p>
          ) : overview ? (
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a', marginBottom: 16 }}>Inventory Summary</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '10px 0', fontSize: 14, color: '#6b7280' }}>Mapped Products</td>
                    <td style={{ padding: '10px 0', fontSize: 14, fontWeight: 600, textAlign: 'right' }}>{overview.totalMappedProducts.toLocaleString()}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '10px 0', fontSize: 14, color: '#6b7280' }}>Mapped Variants</td>
                    <td style={{ padding: '10px 0', fontSize: 14, fontWeight: 600, textAlign: 'right' }}>{overview.totalMappedVariants.toLocaleString()}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '10px 0', fontSize: 14, color: '#6b7280' }}>Total Stock Quantity</td>
                    <td style={{ padding: '10px 0', fontSize: 14, fontWeight: 600, textAlign: 'right' }}>{overview.totalStock.toLocaleString()}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '10px 0', fontSize: 14, color: '#6b7280' }}>Reserved Quantity</td>
                    <td style={{ padding: '10px 0', fontSize: 14, fontWeight: 600, textAlign: 'right' }}>{overview.totalReserved.toLocaleString()}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '10px 0', fontSize: 14, color: '#6b7280' }}>Available Quantity</td>
                    <td style={{ padding: '10px 0', fontSize: 14, fontWeight: 600, textAlign: 'right', color: '#008060' }}>{overview.totalAvailable.toLocaleString()}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '10px 0', fontSize: 14, color: '#d97706' }}>Low Stock Items</td>
                    <td style={{ padding: '10px 0', fontSize: 14, fontWeight: 600, textAlign: 'right', color: '#d97706' }}>{overview.lowStockCount.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '10px 0', fontSize: 14, color: '#dc2626' }}>Out of Stock Items</td>
                    <td style={{ padding: '10px 0', fontSize: 14, fontWeight: 600, textAlign: 'right', color: '#dc2626' }}>{overview.outOfStockCount.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ fontSize: 14, color: '#6b7280' }}>Failed to load overview data.</p>
          )}
        </div>
      )}

      {/* Low Stock Tab */}
      {activeTab === 'lowStock' && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a' }}>Low Stock Items</div>
            <button
              onClick={() => fetchLowStock(lowStockPagination.page)}
              disabled={lowStockLoading}
              style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 500,
                border: '1px solid #e3e3e3', borderRadius: 8, background: '#fff', cursor: 'pointer',
              }}
            >
              {lowStockLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {lowStockLoading && lowStockItems.length === 0 ? (
            <p style={{ fontSize: 13, color: '#6b7280' }}>Loading...</p>
          ) : lowStockItems.length === 0 ? (
            <p style={{ fontSize: 13, color: '#6b7280' }}>No low stock items found.</p>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Product</th>
                      <th style={thStyle}>Variant</th>
                      <th style={thStyle}>Seller</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Stock</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Threshold</th>
                      <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowStockItems.map((item) => (
                      <tr key={item.id}>
                        <td style={{ ...tdStyle, fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.productTitle}
                        </td>
                        <td style={{ ...tdStyle, color: '#6b7280' }}>
                          {item.masterSku || item.variantSku || '\u2014'}
                        </td>
                        <td style={tdStyle}>{item.sellerName}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{item.stockQty}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{item.lowStockThreshold}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <span style={{
                            display: 'inline-block',
                            padding: '2px 10px',
                            borderRadius: 12,
                            fontSize: 11,
                            fontWeight: 600,
                            ...getMappingStatusBadge('LOW_STOCK'),
                          }}>
                            LOW STOCK
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {lowStockPagination.totalPages > 1 && (
                <div style={paginationStyle}>
                  <span>
                    Page {lowStockPagination.page} of {lowStockPagination.totalPages}
                    {' '}&middot;{' '}{lowStockPagination.total} items
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      style={paginationBtnStyle(lowStockPagination.page <= 1)}
                      disabled={lowStockPagination.page <= 1}
                      onClick={() => fetchLowStock(lowStockPagination.page - 1)}
                    >
                      Previous
                    </button>
                    <button
                      style={paginationBtnStyle(lowStockPagination.page >= lowStockPagination.totalPages)}
                      disabled={lowStockPagination.page >= lowStockPagination.totalPages}
                      onClick={() => fetchLowStock(lowStockPagination.page + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Out of Stock Tab */}
      {activeTab === 'outOfStock' && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a' }}>Out of Stock Products</div>
            <button
              onClick={() => fetchOutOfStock(outOfStockPagination.page)}
              disabled={outOfStockLoading}
              style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 500,
                border: '1px solid #e3e3e3', borderRadius: 8, background: '#fff', cursor: 'pointer',
              }}
            >
              {outOfStockLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {outOfStockLoading && outOfStockItems.length === 0 ? (
            <p style={{ fontSize: 13, color: '#6b7280' }}>Loading...</p>
          ) : outOfStockItems.length === 0 ? (
            <p style={{ fontSize: 13, color: '#6b7280' }}>No out-of-stock products found.</p>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Product</th>
                      <th style={thStyle}>Code</th>
                      <th style={thStyle}>Variant</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Stock</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Sellers</th>
                      <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outOfStockItems.map((item, idx) => (
                      <tr key={`${item.productId}-${item.variantId || idx}`}>
                        <td style={{ ...tdStyle, fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.productTitle}
                        </td>
                        <td style={{ ...tdStyle, color: '#6b7280', fontSize: 12 }}>{item.productCode}</td>
                        <td style={{ ...tdStyle, color: '#6b7280' }}>
                          {item.variantSku || (item.hasVariants ? '\u2014' : 'Base')}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{item.totalStock}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{item.sellerCount}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <span style={{
                            display: 'inline-block',
                            padding: '2px 10px',
                            borderRadius: 12,
                            fontSize: 11,
                            fontWeight: 600,
                            ...getMappingStatusBadge('OUT_OF_STOCK'),
                          }}>
                            OUT OF STOCK
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {outOfStockPagination.totalPages > 1 && (
                <div style={paginationStyle}>
                  <span>
                    Page {outOfStockPagination.page} of {outOfStockPagination.totalPages}
                    {' '}&middot;{' '}{outOfStockPagination.total} items
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      style={paginationBtnStyle(outOfStockPagination.page <= 1)}
                      disabled={outOfStockPagination.page <= 1}
                      onClick={() => fetchOutOfStock(outOfStockPagination.page - 1)}
                    >
                      Previous
                    </button>
                    <button
                      style={paginationBtnStyle(outOfStockPagination.page >= outOfStockPagination.totalPages)}
                      disabled={outOfStockPagination.page >= outOfStockPagination.totalPages}
                      onClick={() => fetchOutOfStock(outOfStockPagination.page + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
