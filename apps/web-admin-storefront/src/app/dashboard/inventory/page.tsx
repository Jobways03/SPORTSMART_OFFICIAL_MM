'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, ApiError } from '@/lib/api-client';

/* ── Types ──────────────────────────────────────────────────── */

interface InventoryOverview {
  totalMappedProducts: number;
  totalMappedVariants: number;
  totalStock: number;
  totalReserved: number;
  totalAvailable: number;
  lowStockCount: number;
  outOfStockCount: number;
}

type NodeType = 'SELLER' | 'FRANCHISE';
type NodeFilter = 'ALL' | NodeType;
type RowStatus = 'HEALTHY' | 'LOW' | 'OUT' | 'INACTIVE';
type StatusFilter = 'ALL' | RowStatus;

interface FulfillmentNode {
  type: NodeType;
  id: string;
  name: string;
}

interface InventoryRow {
  id: string;
  node: FulfillmentNode;
  productId: string;
  productTitle: string;
  productCode: string | null;
  variantId: string | null;
  variantSku: string | null;
  masterSku: string | null;
  stockQty: number;
  reservedQty: number;
  availableStock: number;
  lowStockThreshold: number;
  status: RowStatus;
  isActive: boolean;
}

interface ReservationRow {
  id: string;
  mappingId: string;
  quantity: number;
  status: string;
  orderId: string | null;
  expiresAt: string;
  createdAt: string;
  seller: { id: string; name: string };
  product: { id: string; title: string; code: string | null };
  variant: { id: string; sku: string | null; masterSku: string | null } | null;
}

interface MovementRow {
  id: string;
  kind: string;
  quantityDelta: number;
  beforeStockQty: number;
  afterStockQty: number;
  beforeReservedQty: number | null;
  afterReservedQty: number | null;
  reason: string;
  referenceType: string | null;
  referenceId: string | null;
  actorId: string | null;
  actorRole: string | null;
  createdAt: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

type TabKey = 'all' | 'low' | 'out' | 'reservations';

/* ── Page ───────────────────────────────────────────────────── */

export default function InventoryPage() {
  const router = useRouter();

  /* KPI state */
  const [overview, setOverview] = useState<InventoryOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);

  /* Active tab + per-tab data */
  const [activeTab, setActiveTab] = useState<TabKey>('all');

  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [rowsPagination, setRowsPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState('');

  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [reservationsPagination, setReservationsPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [reservationsLoading, setReservationsLoading] = useState(false);
  const [reservationsError, setReservationsError] = useState('');

  /* Filters */
  const [search, setSearch] = useState('');
  const [nodeFilter, setNodeFilter] = useState<NodeFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Drill-down panel state */
  const [drawerRow, setDrawerRow] = useState<InventoryRow | null>(null);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [movementsError, setMovementsError] = useState('');

  /* ── Loaders ────────────────────────────────────────────── */

  const handle401 = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return true;
      }
      return false;
    },
    [router],
  );

  const fetchOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const res = await apiClient<InventoryOverview>('/admin/inventory/overview');
      if (res.data) setOverview(res.data);
    } catch (err) {
      handle401(err);
    } finally {
      setOverviewLoading(false);
    }
  }, [handle401]);

  const fetchRows = useCallback(
    async (
      tab: TabKey,
      page: number,
      opts: { search?: string; node?: NodeFilter; status?: StatusFilter } = {},
    ) => {
      if (tab === 'reservations') return;
      setRowsLoading(true);
      setRowsError('');
      try {
        const params = new URLSearchParams();
        params.set('page', String(page));
        params.set('limit', '20');
        const node = opts.node ?? nodeFilter;
        if (node !== 'ALL') params.set('nodeType', node);

        let endpoint: string;
        if (tab === 'all') {
          endpoint = '/admin/inventory/all';
          const s = opts.search ?? search;
          if (s) params.set('search', s);
          const status = opts.status ?? statusFilter;
          if (status !== 'ALL') params.set('status', status);
        } else if (tab === 'low') {
          endpoint = '/admin/inventory/low-stock';
        } else {
          endpoint = '/admin/inventory/out-of-stock';
        }

        const res = await apiClient<{ items: InventoryRow[]; pagination: Pagination }>(
          `${endpoint}?${params.toString()}`,
        );
        if (res.data) {
          // The low/out endpoints return rows in a slightly older
          // shape (no `status` field). Synthesize it client-side so
          // the table pill renders consistently across tabs.
          const items = res.data.items.map((r: any) => ({
            ...r,
            status:
              r.status ??
              ((): RowStatus => {
                if (!r.isActive) return 'INACTIVE';
                if (r.availableStock <= 0) return 'OUT';
                if (r.availableStock <= r.lowStockThreshold) return 'LOW';
                return 'HEALTHY';
              })(),
            productCode: r.productCode ?? null,
          })) as InventoryRow[];
          setRows(items);
          setRowsPagination(res.data.pagination);
        }
      } catch (err) {
        if (!handle401(err)) {
          setRowsError('Failed to load inventory. Please try again.');
        }
      } finally {
        setRowsLoading(false);
      }
    },
    [handle401, nodeFilter, search, statusFilter],
  );

  const fetchReservations = useCallback(
    async (page: number) => {
      setReservationsLoading(true);
      setReservationsError('');
      try {
        const params = new URLSearchParams();
        params.set('page', String(page));
        params.set('limit', '20');
        const res = await apiClient<{
          reservations: ReservationRow[];
          pagination: Pagination;
        }>(`/admin/inventory/reservations?${params.toString()}`);
        if (res.data) {
          setReservations(res.data.reservations);
          setReservationsPagination(res.data.pagination);
        }
      } catch (err) {
        if (!handle401(err)) {
          setReservationsError('Failed to load reservations. Please try again.');
        }
      } finally {
        setReservationsLoading(false);
      }
    },
    [handle401],
  );

  const fetchMovements = useCallback(
    async (mappingId: string) => {
      setMovementsLoading(true);
      setMovementsError('');
      setMovements([]);
      try {
        const res = await apiClient<{ movements: MovementRow[] }>(
          `/admin/inventory/mappings/${mappingId}/movements?page=1&limit=50`,
        );
        if (res.data) setMovements(res.data.movements);
      } catch (err) {
        if (!handle401(err)) {
          setMovementsError('Failed to load stock movement history.');
        }
      } finally {
        setMovementsLoading(false);
      }
    },
    [handle401],
  );

  // Franchise nodes keep their movements on the FranchiseInventoryLedger,
  // exposed by GET /admin/franchises/:franchiseId/inventory/ledger. Map those
  // rows onto the shared MovementRow shape so the same timeline renders them.
  const fetchFranchiseMovements = useCallback(
    async (franchiseId: string, productId: string) => {
      setMovementsLoading(true);
      setMovementsError('');
      setMovements([]);
      try {
        const res = await apiClient<{ entries: any[]; total: number }>(
          `/admin/franchises/${franchiseId}/inventory/ledger?productId=${productId}&page=1&limit=50`,
        );
        const entries = res.data?.entries ?? [];
        setMovements(
          entries.map((e: any) => ({
            id: e.id,
            kind: e.movementType,
            quantityDelta: e.quantityDelta,
            beforeStockQty: e.beforeQty,
            afterStockQty: e.afterQty,
            beforeReservedQty: null,
            afterReservedQty: null,
            reason: e.remarks || e.movementType,
            referenceType: e.referenceType ?? null,
            referenceId: e.referenceId ?? null,
            actorId: e.actorId ?? null,
            actorRole: e.actorType ?? null,
            createdAt: e.createdAt,
          })),
        );
      } catch (err) {
        if (!handle401(err)) {
          setMovementsError('Failed to load franchise movement history.');
        }
      } finally {
        setMovementsLoading(false);
      }
    },
    [handle401],
  );

  /* ── Effects ─────────────────────────────────────────────── */

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  useEffect(() => {
    if (activeTab === 'reservations') {
      fetchReservations(1);
    } else {
      fetchRows(activeTab, 1);
    }
    // Tab changes reset filters' page only, not values; deps cover
    // node/status changes via separate effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'reservations') {
      fetchRows(activeTab, 1, { node: nodeFilter, status: statusFilter });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeFilter, statusFilter]);

  /* ── Handlers ────────────────────────────────────────────── */

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      if (activeTab !== 'reservations') {
        fetchRows(activeTab, 1, { search: value });
      }
    }, 350);
  };

  const handlePageChange = (page: number) => {
    if (activeTab === 'reservations') {
      fetchReservations(page);
    } else {
      fetchRows(activeTab, page);
    }
  };

  const openRow = (row: InventoryRow) => {
    setDrawerRow(row);
    // Seller mappings use the marketplace stock_movement history; franchise
    // nodes use the FranchiseInventoryLedger (node.id is the franchiseId).
    if (row.node.type === 'SELLER') {
      fetchMovements(row.id);
    } else {
      fetchFranchiseMovements(row.node.id, row.productId);
    }
  };

  const closeDrawer = () => {
    setDrawerRow(null);
    setMovements([]);
  };

  const exportCsv = () => {
    if (rows.length === 0) return;
    const headers = [
      'Product', 'Product Code', 'Variant SKU', 'Master SKU',
      'Source Type', 'Source', 'On Hand', 'Reserved', 'Available',
      'Threshold', 'Status',
    ];
    const lines = [
      headers.join(','),
      ...rows.map((r) =>
        [
          quote(r.productTitle),
          quote(r.productCode ?? ''),
          quote(r.variantSku ?? ''),
          quote(r.masterSku ?? ''),
          r.node.type,
          quote(r.node.name),
          r.stockQty,
          r.reservedQty,
          r.availableStock,
          r.lowStockThreshold,
          r.status,
        ].join(','),
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory-${activeTab}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const clearFilters = () => {
    setSearch('');
    setNodeFilter('ALL');
    setStatusFilter('ALL');
    fetchRows(activeTab, 1, { search: '', node: 'ALL', status: 'ALL' });
  };

  const hasFilters = !!search || nodeFilter !== 'ALL' || statusFilter !== 'ALL';

  /* ── KPI cards ───────────────────────────────────────────── */

  const kpis = useMemo(() => {
    if (!overview) return [];
    return [
      { label: 'Products', value: overview.totalMappedProducts, tone: 'neutral' as const },
      { label: 'On hand', value: overview.totalStock, tone: 'neutral' as const },
      { label: 'Available', value: overview.totalAvailable, tone: 'success' as const },
      { label: 'Reserved', value: overview.totalReserved, tone: 'info' as const },
      { label: 'Low stock', value: overview.lowStockCount, tone: 'warning' as const },
      { label: 'Out of stock', value: overview.outOfStockCount, tone: 'danger' as const },
    ];
  }, [overview]);

  const currentPagination =
    activeTab === 'reservations' ? reservationsPagination : rowsPagination;

  return (
    <div style={styles.page}>
      {/* Header */}
      <header style={styles.header}>
        <div style={{ minWidth: 0 }}>
          <h1 style={styles.h1}>Inventory</h1>
          <p style={styles.headerSub}>
            Monitor stock across all sellers and franchises.
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={rows.length === 0 || activeTab === 'reservations'}
          style={{
            ...styles.btnGhost,
            ...(rows.length === 0 || activeTab === 'reservations'
              ? styles.disabled
              : {}),
          }}
        >
          <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 3v10m0 0l-4-4m4 4l4-4M4 17h12"
            />
          </svg>
          Export CSV
        </button>
      </header>

      {/* KPI strip */}
      <div style={styles.kpiStrip}>
        {overviewLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ ...styles.kpiCard, ...styles.shimmer }} />
          ))
        ) : (
          kpis.map((k) => <KpiCard key={k.label} {...k} />)
        )}
      </div>

      {/* Tabs */}
      <div style={styles.tabs} role="tablist" aria-label="Inventory views">
        <Tab
          label="All inventory"
          active={activeTab === 'all'}
          onSelect={() => setActiveTab('all')}
        />
        <Tab
          label={`Low stock${overview ? ` (${overview.lowStockCount})` : ''}`}
          active={activeTab === 'low'}
          onSelect={() => setActiveTab('low')}
        />
        <Tab
          label={`Out of stock${overview ? ` (${overview.outOfStockCount})` : ''}`}
          active={activeTab === 'out'}
          onSelect={() => setActiveTab('out')}
        />
        <Tab
          label="Reservations"
          active={activeTab === 'reservations'}
          onSelect={() => setActiveTab('reservations')}
        />
      </div>

      {/* Filter bar — hidden for Reservations (different shape) */}
      {activeTab !== 'reservations' && (
        <div style={styles.filterBar}>
          <div style={styles.searchWrap}>
            <svg
              viewBox="0 0 20 20"
              style={styles.searchIcon}
              aria-hidden="true"
            >
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                d="M9 3a6 6 0 104.472 10.03L17 17M9 15A6 6 0 109 3a6 6 0 000 12z"
              />
            </svg>
            <input
              type="search"
              placeholder="Search product, SKU, or seller"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              style={styles.searchInput}
              aria-label="Search inventory"
              disabled={activeTab !== 'all'}
              title={
                activeTab === 'all'
                  ? ''
                  : 'Search is available on the All Inventory tab'
              }
            />
          </div>

          <select
            value={nodeFilter}
            onChange={(e) => setNodeFilter(e.target.value as NodeFilter)}
            style={styles.select}
            aria-label="Filter by source"
          >
            <option value="ALL">All sources</option>
            <option value="SELLER">Sellers only</option>
            <option value="FRANCHISE">Franchises only</option>
          </select>

          {activeTab === 'all' && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              style={styles.select}
              aria-label="Filter by status"
            >
              <option value="ALL">All statuses</option>
              <option value="HEALTHY">Healthy</option>
              <option value="LOW">Low stock</option>
              <option value="OUT">Out of stock</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          )}

          {hasFilters && (
            <button type="button" onClick={clearFilters} style={styles.btnGhost}>
              Clear
            </button>
          )}
        </div>
      )}

      {/* Body */}
      <div style={styles.card}>
        {activeTab === 'reservations' ? (
          reservationsLoading ? (
            <SkeletonTable />
          ) : reservationsError ? (
            <ErrorState
              message={reservationsError}
              onRetry={() => fetchReservations(reservationsPagination.page)}
            />
          ) : reservations.length === 0 ? (
            <EmptyState
              title="No active reservations"
              body="When customers add items to their cart or check out, stock is reserved here until the order completes."
            />
          ) : (
            <ReservationsTable rows={reservations} />
          )
        ) : rowsLoading ? (
          <SkeletonTable />
        ) : rowsError ? (
          <ErrorState
            message={rowsError}
            onRetry={() => fetchRows(activeTab, rowsPagination.page)}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={
              activeTab === 'all'
                ? hasFilters
                  ? 'No items match your filters'
                  : 'No inventory yet'
                : activeTab === 'low'
                  ? 'Nothing is low on stock'
                  : 'Nothing is out of stock'
            }
            body={
              activeTab === 'all' && hasFilters
                ? 'Try adjusting the search or filters above.'
                : activeTab === 'low'
                  ? 'When seller or franchise stock drops below its threshold, it will show up here.'
                  : 'Products with zero available stock will show up here.'
            }
          />
        ) : (
          <InventoryTable rows={rows} onRowClick={openRow} />
        )}
      </div>

      {/* Pagination */}
      {currentPagination.totalPages > 1 && (
        <Pagination
          page={currentPagination.page}
          totalPages={currentPagination.totalPages}
          total={currentPagination.total}
          limit={currentPagination.limit}
          onChange={handlePageChange}
        />
      )}

      {/* Drill-down side drawer */}
      {drawerRow && (
        <Drawer
          row={drawerRow}
          movements={movements}
          loading={movementsLoading}
          error={movementsError}
          onClose={closeDrawer}
        />
      )}

      <style>{shimmerKeyframes}</style>
    </div>
  );
}

/* ── KPI card ───────────────────────────────────────────────── */

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'neutral' | 'success' | 'info' | 'warning' | 'danger';
}) {
  const palette = {
    neutral: { fg: '#0f172a' },
    success: { fg: '#15803d' },
    info:    { fg: '#1d4ed8' },
    warning: { fg: '#b45309' },
    danger:  { fg: '#b91c1c' },
  };
  const p = palette[tone];
  return (
    <div style={styles.kpiCard}>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: p.fg,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.1,
          letterSpacing: '-0.01em',
        }}
      >
        {value.toLocaleString('en-IN')}
      </div>
      <div style={styles.kpiLabel}>{label}</div>
    </div>
  );
}

/* ── Tab ────────────────────────────────────────────────────── */

function Tab({
  label,
  active,
  onSelect,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      style={{ ...styles.tab, ...(active ? styles.tabActive : {}) }}
    >
      {label}
    </button>
  );
}

/* ── Inventory table ───────────────────────────────────────── */

function InventoryTable({
  rows,
  onRowClick,
}: {
  rows: InventoryRow[];
  onRowClick: (r: InventoryRow) => void;
}) {
  return (
    <div style={styles.tableScroll}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Product / SKU</th>
            <th style={styles.th}>Source</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>On hand</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Reserved</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Available</th>
            <th style={styles.th}>Status</th>
            <th style={{ ...styles.th, width: 28 }} aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              style={styles.tr}
              onClick={() => onRowClick(r)}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLTableRowElement).style.background = '#f8fafc';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLTableRowElement).style.background = '#fff';
              }}
            >
              <td style={styles.td}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a', lineHeight: 1.3 }}>
                  {r.productTitle}
                </div>
                <div
                  style={{
                    fontSize: 11.5,
                    color: '#64748b',
                    marginTop: 3,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  }}
                >
                  {r.variantSku || r.masterSku || r.productCode || '—'}
                </div>
              </td>
              <td style={styles.td}>
                <div style={{ fontSize: 12.5, color: '#0f172a' }}>{r.node.name}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                  {r.node.type === 'SELLER' ? 'Seller' : 'Franchise'}
                </div>
              </td>
              <td style={{ ...styles.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {r.stockQty}
              </td>
              <td style={{ ...styles.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.reservedQty > 0 ? '#b45309' : '#94a3b8' }}>
                {r.reservedQty}
              </td>
              <td
                style={{
                  ...styles.td,
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 600,
                  color:
                    r.status === 'OUT' ? '#b91c1c'
                    : r.status === 'LOW' ? '#b45309'
                    : '#0f172a',
                }}
              >
                {r.availableStock}
              </td>
              <td style={styles.td}>
                <StatusPill status={r.status} />
              </td>
              <td style={{ ...styles.td, color: '#cbd5e1' }}>
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 3l5 5-5 5"
                  />
                </svg>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Reservations table ─────────────────────────────────────── */

function ReservationsTable({ rows }: { rows: ReservationRow[] }) {
  return (
    <div style={styles.tableScroll}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Product / SKU</th>
            <th style={styles.th}>Seller</th>
            <th style={styles.th}>Order</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Qty</th>
            <th style={styles.th}>Status</th>
            <th style={styles.th}>Expires</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={styles.tr}>
              <td style={styles.td}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a', lineHeight: 1.3 }}>
                  {r.product.title}
                </div>
                <div
                  style={{
                    fontSize: 11.5,
                    color: '#64748b',
                    marginTop: 3,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  }}
                >
                  {r.variant?.sku || r.variant?.masterSku || r.product.code || '—'}
                </div>
              </td>
              <td style={styles.td}>
                <span style={{ fontSize: 12.5, color: '#334155' }}>{r.seller.name}</span>
              </td>
              <td style={styles.td}>
                <span style={{ fontSize: 11.5, color: '#64748b', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                  {r.orderId ? r.orderId.slice(0, 8) + '…' : '—'}
                </span>
              </td>
              <td style={{ ...styles.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: '#b45309' }}>
                {r.quantity}
              </td>
              <td style={styles.td}>
                <StatusPill
                  status={r.status === 'RESERVED' ? 'LOW' : r.status === 'CONFIRMED' ? 'HEALTHY' : 'INACTIVE'}
                  customLabel={r.status.toLowerCase()}
                />
              </td>
              <td style={styles.td}>
                <span style={{ fontSize: 12, color: '#64748b' }}>
                  {new Date(r.expiresAt).toLocaleString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Status pill ────────────────────────────────────────────── */

function StatusPill({
  status,
  customLabel,
}: {
  status: RowStatus;
  customLabel?: string;
}) {
  const palette: Record<RowStatus, { dot: string; bg: string; fg: string; label: string }> = {
    HEALTHY:  { dot: '#16a34a', bg: '#f0fdf4', fg: '#15803d', label: 'Healthy' },
    LOW:      { dot: '#d97706', bg: '#fffbeb', fg: '#b45309', label: 'Low' },
    OUT:      { dot: '#dc2626', bg: '#fef2f2', fg: '#b91c1c', label: 'Out of stock' },
    INACTIVE: { dot: '#94a3b8', bg: '#f1f5f9', fg: '#475569', label: 'Inactive' },
  };
  const p = palette[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px 3px 8px',
        fontSize: 11.5,
        fontWeight: 600,
        borderRadius: 999,
        background: p.bg,
        color: p.fg,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: p.dot,
          flexShrink: 0,
        }}
      />
      {customLabel ?? p.label}
    </span>
  );
}

/* ── Drill-down drawer ──────────────────────────────────────── */

function Drawer({
  row,
  movements,
  loading,
  error,
  onClose,
}: {
  row: InventoryRow;
  movements: MovementRow[];
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 60,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.35)',
          zIndex: 250,
        }}
      />
      <aside
        role="dialog"
        aria-label="Stock movement history"
        style={{
          position: 'fixed',
          top: 60,
          right: 0,
          bottom: 0,
          width: '100%',
          maxWidth: 520,
          background: '#fff',
          borderLeft: '1px solid #e2e8f0',
          boxShadow: '-8px 0 24px rgba(15, 23, 42, 0.08)',
          zIndex: 251,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Drawer header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            padding: '20px 22px 16px',
            borderBottom: '1px solid #e2e8f0',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
              Stock movement
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', lineHeight: 1.3 }}>
              {row.productTitle}
            </div>
            <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 4 }}>
              {row.node.name} · {row.node.type === 'SELLER' ? 'Seller' : 'Franchise'}
              {row.variantSku && (
                <>
                  {' · '}
                  <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                    {row.variantSku}
                  </span>
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 30,
              height: 30,
              padding: 0,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#64748b',
              flexShrink: 0,
            }}
          >
            <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                d="M5 5l10 10M15 5L5 15"
              />
            </svg>
          </button>
        </div>

        {/* Current stock summary */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 0,
            padding: '14px 22px',
            background: '#fafbfc',
            borderBottom: '1px solid #e2e8f0',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {[
            { label: 'On hand', value: row.stockQty, color: '#0f172a' },
            { label: 'Reserved', value: row.reservedQty, color: row.reservedQty > 0 ? '#b45309' : '#0f172a' },
            { label: 'Available', value: row.availableStock,
              color: row.status === 'OUT' ? '#b91c1c' : row.status === 'LOW' ? '#b45309' : '#15803d' },
            { label: 'Threshold', value: row.lowStockThreshold, color: '#64748b' },
          ].map((s) => (
            <div key={s.label}>
              <div style={{ fontSize: 16, fontWeight: 700, color: s.color, lineHeight: 1.1 }}>
                {s.value}
              </div>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* Timeline body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 22px 24px' }}>
          {loading ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
              Loading history…
            </div>
          ) : error ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: '#b91c1c', fontSize: 13 }}>
              {error}
            </div>
          ) : movements.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
              No stock movements recorded yet.
            </div>
          ) : (
            <MovementTimeline movements={movements} />
          )}
        </div>
      </aside>
    </>
  );
}

function MovementTimeline({ movements }: { movements: MovementRow[] }) {
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {movements.map((m, idx) => {
        const isIncrease = m.quantityDelta > 0;
        const isDecrease = m.quantityDelta < 0;
        const dotColor = isIncrease ? '#16a34a' : isDecrease ? '#b45309' : '#94a3b8';
        return (
          <li key={m.id} style={{ display: 'flex', gap: 12, position: 'relative' }}>
            {/* Connector line */}
            {idx < movements.length - 1 && (
              <span
                style={{
                  position: 'absolute',
                  left: 5,
                  top: 18,
                  bottom: -14,
                  width: 1,
                  background: '#e2e8f0',
                }}
              />
            )}
            <span
              style={{
                width: 11,
                height: 11,
                borderRadius: '50%',
                background: dotColor,
                marginTop: 4,
                flexShrink: 0,
                border: '2px solid #fff',
                boxShadow: '0 0 0 1px #e2e8f0',
                zIndex: 1,
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: 13.5,
                    fontWeight: 700,
                    color: isIncrease ? '#15803d' : isDecrease ? '#b45309' : '#475569',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {isIncrease ? '+' : ''}{m.quantityDelta}
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {m.kind.replace(/_/g, ' ')}
                </span>
                <span style={{ flex: 1, minWidth: 8 }} />
                <span style={{ fontSize: 11, color: '#94a3b8' }}>
                  {new Date(m.createdAt).toLocaleString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: '#334155', marginTop: 3, lineHeight: 1.4 }}>
                {m.reason}
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: '#94a3b8',
                  marginTop: 4,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                Stock {m.beforeStockQty} → {m.afterStockQty}
                {m.beforeReservedQty !== null && m.afterReservedQty !== null && (
                  m.beforeReservedQty !== m.afterReservedQty ? (
                    <>{' · Reserved '}{m.beforeReservedQty} → {m.afterReservedQty}</>
                  ) : null
                )}
                {m.referenceType && m.referenceId && (
                  <>
                    {' · '}
                    <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                      {m.referenceType.toLowerCase()}:{m.referenceId.slice(0, 8)}…
                    </span>
                  </>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ── Pagination ─────────────────────────────────────────────── */

function Pagination({
  page,
  totalPages,
  total,
  limit,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onChange: (p: number) => void;
}) {
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return (
    <div style={styles.pagination}>
      <span style={styles.paginationLabel}>
        Showing <strong>{from}</strong>–<strong>{to}</strong> of{' '}
        <strong>{total.toLocaleString('en-IN')}</strong>
      </span>
      <div style={styles.paginationControls}>
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          style={{
            ...styles.pageBtn,
            ...(page <= 1 ? styles.pageBtnDisabled : {}),
          }}
          aria-label="Previous page"
        >
          <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
            <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M12 4l-6 6 6 6" />
          </svg>
        </button>
        <span style={styles.pageIndicator}>
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          style={{
            ...styles.pageBtn,
            ...(page >= totalPages ? styles.pageBtnDisabled : {}),
          }}
          aria-label="Next page"
        >
          <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
            <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M8 4l6 6-6 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/* ── Skeleton / Empty / Error states ─────────────────────────── */

function SkeletonTable() {
  return (
    <div style={{ padding: 14 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '12px 0',
            borderBottom: i === 5 ? 'none' : '1px solid #f1f5f9',
          }}
        >
          <div style={{ ...styles.skelLine, flex: 1, height: 14 }} />
          <div style={{ ...styles.skelLine, width: 120, height: 14 }} />
          <div style={{ ...styles.skelLine, width: 60, height: 14 }} />
          <div style={{ ...styles.skelLine, width: 60, height: 14 }} />
          <div style={{ ...styles.skelLine, width: 60, height: 14 }} />
          <div style={{ ...styles.skelLine, width: 80, height: 22, borderRadius: 999 }} />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div style={styles.empty}>
      <svg viewBox="0 0 48 48" style={styles.emptyIcon} aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 14h32v26a4 4 0 01-4 4H12a4 4 0 01-4-4V14zM8 14l4-6h24l4 6M18 24h12"
        />
      </svg>
      <h3 style={styles.emptyTitle}>{title}</h3>
      <p style={styles.emptyBody}>{body}</p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={styles.empty}>
      <svg viewBox="0 0 48 48" style={styles.emptyIcon} aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M24 4a20 20 0 100 40 20 20 0 000-40zm0 10v14m0 4v2"
        />
      </svg>
      <h3 style={styles.emptyTitle}>Couldn&apos;t load inventory</h3>
      <p style={styles.emptyBody}>{message}</p>
      <button type="button" onClick={onRetry} style={{ ...styles.btnGhost, marginTop: 16 }}>
        Try again
      </button>
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────────────── */

function quote(v: string): string {
  // CSV-safe quoting — only wrap when needed.
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/* ── Styles ─────────────────────────────────────────────────── */

const shimmerKeyframes = `
@keyframes inventory-shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position:  400px 0; }
}
`;

const styles: Record<string, React.CSSProperties> = {
  page: {
    color: '#0f172a',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  },

  /* Header */
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  h1: {
    margin: 0,
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: '-0.01em',
    color: '#0f172a',
  },
  headerSub: {
    margin: '4px 0 0',
    fontSize: 13,
    color: '#64748b',
  },

  /* KPI strip */
  kpiStrip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 10,
    marginBottom: 16,
  },
  kpiCard: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: '14px 16px',
    minHeight: 72,
  },
  kpiLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginTop: 6,
  },

  /* Tabs (underline style — matches products page) */
  tabs: {
    display: 'flex',
    gap: 4,
    borderBottom: '1px solid #e2e8f0',
    marginBottom: 14,
    flexWrap: 'wrap',
  },
  tab: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 38,
    padding: '0 14px',
    fontSize: 13,
    fontWeight: 500,
    color: '#64748b',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    marginBottom: -1,
    cursor: 'pointer',
    transition: 'color 0.12s, border-color 0.12s',
    fontFamily: 'inherit',
  },
  tabActive: {
    color: '#0f172a',
    // Full shorthand — pairs with the base tab's `borderBottom` so
    // React doesn't warn about mixing shorthand and longhand.
    borderBottom: '2px solid #0f172a',
    fontWeight: 600,
  },

  /* Filter bar */
  filterBar: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    marginBottom: 14,
    flexWrap: 'wrap',
  },
  searchWrap: {
    position: 'relative',
    flex: '1 1 260px',
    minWidth: 220,
    maxWidth: 360,
  },
  searchIcon: {
    position: 'absolute',
    left: 12,
    top: '50%',
    transform: 'translateY(-50%)',
    width: 16,
    height: 16,
    color: '#94a3b8',
    pointerEvents: 'none',
  },
  searchInput: {
    width: '100%',
    height: 38,
    padding: '0 12px 0 36px',
    fontSize: 14,
    color: '#0f172a',
    background: '#ffffff',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 8,
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.12s',
    fontFamily: 'inherit',
  },
  select: {
    height: 38,
    padding: '0 12px',
    fontSize: 13.5,
    color: '#0f172a',
    background: '#fff',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 8,
    outline: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minWidth: 150,
  },

  /* Buttons */
  btnGhost: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 38,
    padding: '0 14px',
    fontSize: 13,
    fontWeight: 500,
    color: '#334155',
    background: '#fff',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  disabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },

  /* Card + Table */
  card: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    overflow: 'hidden',
  },
  tableScroll: { overflowX: 'auto' },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  th: {
    textAlign: 'left',
    padding: '10px 16px',
    fontSize: 11,
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
    whiteSpace: 'nowrap',
  },
  tr: {
    borderBottom: '1px solid #f1f5f9',
    cursor: 'pointer',
    transition: 'background-color 0.08s',
    background: '#fff',
  },
  td: {
    padding: '14px 16px',
    verticalAlign: 'middle',
    fontSize: 13,
    color: '#0f172a',
  },

  /* Pagination */
  pagination: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    padding: '0 4px',
    flexWrap: 'wrap',
    gap: 12,
  },
  paginationLabel: {
    fontSize: 13,
    color: '#475569',
  },
  paginationControls: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  pageBtn: {
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 8,
    background: '#fff',
    cursor: 'pointer',
    color: '#334155',
    transition: 'background-color 0.12s, border-color 0.12s, color 0.12s',
  },
  pageBtnDisabled: {
    color: '#cbd5e1',
    cursor: 'not-allowed',
    background: '#f8fafc',
  },
  pageIndicator: {
    padding: '0 10px',
    fontSize: 13,
    color: '#475569',
    fontVariantNumeric: 'tabular-nums',
  },

  /* Empty */
  empty: {
    padding: '56px 24px',
    textAlign: 'center',
  },
  emptyIcon: {
    width: 40,
    height: 40,
    color: '#94a3b8',
    marginBottom: 12,
  },
  emptyTitle: {
    margin: 0,
    fontSize: 15,
    fontWeight: 600,
    color: '#0f172a',
  },
  emptyBody: {
    margin: '6px auto 0',
    fontSize: 12.5,
    color: '#64748b',
    maxWidth: 380,
    lineHeight: 1.5,
  },

  /* Shimmer */
  skelLine: {
    display: 'block',
    borderRadius: 4,
    background:
      'linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 37%, #f1f5f9 63%) 0 0 / 800px 100%',
    animation: 'inventory-shimmer 1.2s ease-in-out infinite',
  },
  shimmer: {
    background:
      'linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 37%, #f1f5f9 63%) 0 0 / 800px 100%',
    animation: 'inventory-shimmer 1.2s ease-in-out infinite',
  },
};
