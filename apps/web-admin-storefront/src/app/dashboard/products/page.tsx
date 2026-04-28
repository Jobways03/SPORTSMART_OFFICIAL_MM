'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  adminProductsService,
  ProductListItem,
  ListProductsParams,
} from '@/services/admin-products.service';
import { ApiError, apiClient } from '@/lib/api-client';
import { useModal } from '@sportsmart/ui';

// ── Inventory panel types ───────────────────────────────────────
// These mirror the response shape of the admin seller-mappings and
// franchise-mappings endpoints. Defined locally because they're
// only used by the inline panel; promoting them to the service file
// would couple two unrelated views to the same shape.
interface AdminSellerMapping {
  id: string;
  seller: { id: string; sellerName: string; sellerShopName: string; status: string; sellerZipCode: string | null };
  variant: { id: string; masterSku: string; title: string; sku: string } | null;
  stockQty: number;
  reservedQty: number;
  availableQty: number;
  lowStockThreshold: number;
  mappingDisplayStatus: string;
  approvalStatus: string | null;
  sellerInternalSku: string | null;
  pickupPincode: string | null;
  dispatchSla: number;
  isActive: boolean;
  updatedAt: string;
}
interface AdminFranchiseMapping {
  id: string;
  franchise: { id: string; businessName: string; status: string; warehousePincode: string | null };
  variant: { id: string; sku: string; title: string } | null;
  variantId: string | null;
  globalSku: string;
  franchiseSku: string | null;
  stockQty: number;
  reservedQty: number;
  availableQty: number;
  lowStockThreshold: number;
  mappingDisplayStatus: string;
  approvalStatus: string;
  isActive: boolean;
  isListedForOnlineFulfillment: boolean;
  updatedAt: string;
}
interface InventoryPanelData {
  loading: boolean;
  sellers: AdminSellerMapping[];
  franchises: AdminFranchiseMapping[];
  error?: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

type PillTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/* ── Formatting & mapping ───────────────────────────────────── */

function statusPill(status: string): { label: string; tone: PillTone } {
  switch (status) {
    case 'DRAFT':
      return { label: 'Draft', tone: 'neutral' };
    case 'SUBMITTED':
      return { label: 'Pending review', tone: 'warning' };
    case 'APPROVED':
      return { label: 'Approved', tone: 'info' };
    case 'ACTIVE':
      return { label: 'Active', tone: 'success' };
    case 'REJECTED':
      return { label: 'Rejected', tone: 'danger' };
    case 'CHANGES_REQUESTED':
      return { label: 'Changes requested', tone: 'warning' };
    case 'SUSPENDED':
      return { label: 'Suspended', tone: 'neutral' };
    case 'ARCHIVED':
      return { label: 'Archived', tone: 'neutral' };
    default:
      return { label: status.replace(/_/g, ' ').toLowerCase(), tone: 'neutral' };
  }
}

const formatPrice = (price: string | null) => {
  if (!price) return null;
  const n = parseFloat(price);
  if (isNaN(n)) return price;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
};

/* ── Page ───────────────────────────────────────────────────── */

export default function ProductsPage() {
  const { confirmDialog } = useModal();
  const router = useRouter();
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [moderationFilter, setModerationFilter] = useState('');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState<
    null | 'approve' | 'reject' | 'request-changes'
  >(null);
  const [bulkModal, setBulkModal] = useState<null | 'reject' | 'request-changes'>(
    null,
  );
  const [bulkNote, setBulkNote] = useState('');
  const [bulkMessage, setBulkMessage] = useState('');

  // Inline inventory panel — track which rows are expanded and cache
  // their per-product breakdown so reopening doesn't re-fetch.
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [inventoryCache, setInventoryCache] = useState<
    Record<string, InventoryPanelData>
  >({});

  const toggleExpanded = useCallback((productId: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
    // Lazy-load on first expansion. The cache is keyed per product
    // so a refresh-after-edit can be done by clearing one entry.
    setInventoryCache((cache) => {
      if (cache[productId]) return cache;
      // Fire-and-forget; the panel renders the loading state until
      // setInventoryCache below replaces the entry.
      void loadInventory(productId);
      return { ...cache, [productId]: { loading: true, sellers: [], franchises: [] } };
    });
  }, []);

  const loadInventory = useCallback(async (productId: string) => {
    try {
      const [sellersRes, franchisesRes] = await Promise.allSettled([
        apiClient<{ mappings: AdminSellerMapping[] }>(
          `/admin/products/${productId}/seller-mappings`,
        ),
        apiClient<{ mappings: AdminFranchiseMapping[] }>(
          `/admin/products/${productId}/franchise-mappings`,
        ),
      ]);
      const sellers =
        sellersRes.status === 'fulfilled' ? sellersRes.value.data?.mappings ?? [] : [];
      const franchises =
        franchisesRes.status === 'fulfilled' ? franchisesRes.value.data?.mappings ?? [] : [];
      setInventoryCache((cache) => ({
        ...cache,
        [productId]: { loading: false, sellers, franchises },
      }));
    } catch {
      setInventoryCache((cache) => ({
        ...cache,
        [productId]: { loading: false, sellers: [], franchises: [], error: 'Failed to load inventory' },
      }));
    }
  }, []);

  const selectableIds = products
    .filter((p) => p.status === 'SUBMITTED')
    .map((p) => p.id);

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => {
      if (selectableIds.every((id) => prev.has(id))) return new Set();
      return new Set(selectableIds);
    });

  const clearSelection = () => setSelected(new Set());
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchProducts = useCallback(
    async (params: ListProductsParams = {}) => {
      setLoading(true);
      setError('');
      try {
        const res = await adminProductsService.listProducts({
          page: params.page || pagination.page,
          limit: 20,
          search: params.search !== undefined ? params.search : search,
          status: params.status !== undefined ? params.status : statusFilter,
          moderationStatus:
            params.moderationStatus !== undefined
              ? params.moderationStatus
              : moderationFilter,
        });
        if (res.data) {
          setProducts(res.data.products);
          setPagination(res.data.pagination);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace('/login');
          return;
        }
        setError('Failed to load products. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [pagination.page, search, statusFilter, moderationFilter, router],
  );

  useEffect(() => {
    fetchProducts({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, moderationFilter]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      fetchProducts({ page: 1, search: value });
    }, 400);
  };

  const handlePageChange = (page: number) => {
    fetchProducts({ page });
  };

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setModerationFilter('');
    fetchProducts({ page: 1, search: '', status: '', moderationStatus: '' });
  };

  const runBulkApprove = async () => {
    if (selected.size === 0) return;
    if (!(await confirmDialog(`Approve ${selected.size} selected product(s)?`)))
      return;
    setBulkSaving('approve');
    setBulkMessage('');
    try {
      const res = await adminProductsService.bulkApprove([...selected]);
      const d = res.data;
      setBulkMessage(
        d
          ? `Approved ${d.ok.length}${d.failed.length ? ` — ${d.failed.length} failed` : ''}`
          : 'Done',
      );
      clearSelection();
      await fetchProducts({ page: pagination.page });
    } catch (err) {
      setBulkMessage(
        err instanceof ApiError
          ? err.body.message || 'Bulk approve failed'
          : 'Bulk approve failed',
      );
    } finally {
      setBulkSaving(null);
    }
  };

  const runBulkRejectOrChanges = async () => {
    if (selected.size === 0 || !bulkModal) return;
    const text = bulkNote.trim();
    if (!text) {
      setBulkMessage(
        bulkModal === 'reject' ? 'Reason is required' : 'Note is required',
      );
      return;
    }
    setBulkSaving(bulkModal);
    setBulkMessage('');
    try {
      const res =
        bulkModal === 'reject'
          ? await adminProductsService.bulkReject([...selected], text)
          : await adminProductsService.bulkRequestChanges([...selected], text);
      const d = res.data;
      setBulkMessage(
        d
          ? `${bulkModal === 'reject' ? 'Rejected' : 'Changes requested on'} ${d.ok.length}${d.failed.length ? ` — ${d.failed.length} failed` : ''}`
          : 'Done',
      );
      setBulkModal(null);
      setBulkNote('');
      clearSelection();
      await fetchProducts({ page: pagination.page });
    } catch (err) {
      setBulkMessage(
        err instanceof ApiError
          ? err.body.message || 'Bulk action failed'
          : 'Bulk action failed',
      );
    } finally {
      setBulkSaving(null);
    }
  };

  const hasFilters = !!(search || statusFilter || moderationFilter);
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const someSelected =
    selectableIds.length > 0 && !allSelected && selectableIds.some((id) => selected.has(id));

  const tabs: {
    key: string;
    label: string;
    active: boolean;
    onSelect: () => void;
  }[] = [
    {
      key: 'all',
      label: 'All products',
      active: !moderationFilter && !statusFilter,
      onSelect: () => {
        setModerationFilter('');
        setStatusFilter('');
      },
    },
    {
      key: 'pending',
      label: 'Pending review',
      active: moderationFilter === 'PENDING',
      onSelect: () => {
        setModerationFilter('PENDING');
        setStatusFilter('');
      },
    },
    {
      key: 'active',
      label: 'Active',
      active: statusFilter === 'ACTIVE' && !moderationFilter,
      onSelect: () => {
        setStatusFilter('ACTIVE');
        setModerationFilter('');
      },
    },
    {
      key: 'drafts',
      label: 'Drafts',
      active: statusFilter === 'DRAFT' && !moderationFilter,
      onSelect: () => {
        setStatusFilter('DRAFT');
        setModerationFilter('');
      },
    },
  ];

  return (
    <div style={styles.page}>
      {/* ── Header ─────────────────────────────────────────── */}
      <header style={styles.header}>
        <div style={{ minWidth: 0 }}>
          <h1 style={styles.h1}>
            Products
            {!loading && (
              <span style={styles.headerCount}>
                {pagination.total.toLocaleString('en-IN')}
              </span>
            )}
          </h1>
          <p style={styles.headerSub}>
            Moderate seller products, approve submissions, and manage the
            catalog.
          </p>
        </div>
        <Link href="/dashboard/products/new" style={styles.btnPrimary}>
          <svg viewBox="0 0 20 20" style={styles.btnIcon} aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              d="M10 4v12M4 10h12"
            />
          </svg>
          Add product
        </Link>
      </header>

      {/* ── Tabs + Toolbar ─────────────────────────────────── */}
      <div style={styles.toolbar}>
        <div style={styles.tabs} role="tablist" aria-label="Product filter">
          {tabs.map((t) => (
            <Tab
              key={t.key}
              label={t.label}
              active={t.active}
              onSelect={t.onSelect}
            />
          ))}
        </div>

        <div style={styles.searchWrap}>
          <svg
            style={styles.searchIcon}
            viewBox="0 0 20 20"
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
            placeholder="Search by title or category"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            style={styles.searchInput}
            aria-label="Search products"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={styles.select}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="SUBMITTED">Pending review</option>
          <option value="APPROVED">Approved</option>
          <option value="ACTIVE">Active</option>
          <option value="REJECTED">Rejected</option>
          <option value="CHANGES_REQUESTED">Changes requested</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="ARCHIVED">Archived</option>
        </select>

        {hasFilters && (
          <button type="button" onClick={clearFilters} style={styles.btnGhost}>
            Clear
          </button>
        )}
      </div>

      {/* ── Bulk bar ───────────────────────────────────────── */}
      {selected.size > 0 && (
        <div style={styles.bulkBar} role="toolbar" aria-label="Bulk actions">
          <span style={styles.bulkCount}>
            <strong>{selected.size}</strong> selected
          </span>
          <button
            type="button"
            onClick={runBulkApprove}
            disabled={bulkSaving !== null}
            style={{
              ...styles.bulkBtn,
              ...styles.bulkBtnApprove,
              ...(bulkSaving ? styles.disabled : {}),
            }}
          >
            {bulkSaving === 'approve' ? 'Approving…' : 'Approve'}
          </button>
          <button
            type="button"
            onClick={() => {
              setBulkModal('request-changes');
              setBulkNote('');
              setBulkMessage('');
            }}
            disabled={bulkSaving !== null}
            style={{
              ...styles.bulkBtn,
              ...styles.bulkBtnWarning,
              ...(bulkSaving ? styles.disabled : {}),
            }}
          >
            Request changes
          </button>
          <button
            type="button"
            onClick={() => {
              setBulkModal('reject');
              setBulkNote('');
              setBulkMessage('');
            }}
            disabled={bulkSaving !== null}
            style={{
              ...styles.bulkBtn,
              ...styles.bulkBtnDanger,
              ...(bulkSaving ? styles.disabled : {}),
            }}
          >
            Reject
          </button>
          <button
            type="button"
            onClick={clearSelection}
            style={styles.bulkBtnClear}
          >
            Clear
          </button>
        </div>
      )}

      {bulkMessage && !bulkModal && selected.size === 0 && (
        <div style={styles.bulkMessage} role="status">
          {bulkMessage}
        </div>
      )}

      {/* ── States ─────────────────────────────────────────── */}
      {loading ? (
        <SkeletonTable />
      ) : error ? (
        <ErrorState
          message={error}
          onRetry={() => fetchProducts({ page: pagination.page })}
        />
      ) : products.length === 0 ? (
        <EmptyState hasFilters={hasFilters} />
      ) : (
        <>
          {/* Select-all bar — appears only when there are selectable
              (SUBMITTED) products on this page. The cards don't repeat
              column headers, so this bar is the only way to bulk-tick. */}
          {selectableIds.length > 0 && (
            <div style={styles.selectAllBar}>
              <label style={styles.selectAllLabel}>
                <input
                  type="checkbox"
                  aria-label="Select all pending products on this page"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={toggleAll}
                  style={styles.checkbox}
                />
                <span>
                  {allSelected
                    ? `All ${selectableIds.length} selected`
                    : someSelected
                      ? `${selected.size} of ${selectableIds.length} selected`
                      : `Select all ${selectableIds.length} pending`}
                </span>
              </label>
            </div>
          )}

          <div role="list" style={styles.cardList}>
            {products.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                selected={selected.has(p.id)}
                onToggle={() => toggleOne(p.id)}
                onOpen={() =>
                  router.push(`/dashboard/products/${p.id}/edit`)
                }
                expanded={expandedRows.has(p.id)}
                onToggleExpand={() => toggleExpanded(p.id)}
                inventoryData={inventoryCache[p.id]}
              />
            ))}
          </div>

          {pagination.totalPages > 1 && (
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              total={pagination.total}
              limit={pagination.limit}
              onChange={handlePageChange}
            />
          )}
        </>
      )}

      {/* ── Bulk modal ─────────────────────────────────────── */}
      {bulkModal && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !bulkSaving) setBulkModal(null);
          }}
          style={styles.modalBackdrop}
        >
          <div style={styles.modal}>
            <h2 style={styles.modalTitle}>
              {bulkModal === 'reject'
                ? `Reject ${selected.size} product${selected.size === 1 ? '' : 's'}`
                : `Request changes on ${selected.size} product${selected.size === 1 ? '' : 's'}`}
            </h2>
            <p style={styles.modalBody}>
              This {bulkModal === 'reject' ? 'reason' : 'note'} will be sent to
              every seller whose product is in this batch. Each seller receives
              an email with the text below.
            </p>
            {bulkMessage && (
              <div style={styles.modalError} role="alert">
                {bulkMessage}
              </div>
            )}
            <label style={styles.modalLabel}>
              {bulkModal === 'reject'
                ? 'Rejection reason'
                : 'What needs to change'}
            </label>
            <textarea
              rows={5}
              placeholder={
                bulkModal === 'reject'
                  ? 'Explain why these products were rejected…'
                  : 'Describe the changes you need the seller to make…'
              }
              value={bulkNote}
              onChange={(e) => setBulkNote(e.target.value)}
              style={styles.textarea}
              disabled={bulkSaving !== null}
              autoFocus
            />
            <div style={styles.modalFooter}>
              <button
                type="button"
                onClick={() => setBulkModal(null)}
                disabled={bulkSaving !== null}
                style={{
                  ...styles.btnGhost,
                  ...(bulkSaving ? styles.disabled : {}),
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={runBulkRejectOrChanges}
                disabled={bulkSaving !== null}
                style={{
                  ...styles.btnPrimary,
                  ...(bulkModal === 'reject'
                    ? styles.btnDanger
                    : styles.btnWarning),
                  ...(bulkSaving ? styles.disabled : {}),
                }}
              >
                {bulkSaving
                  ? bulkModal === 'reject'
                    ? 'Rejecting…'
                    : 'Saving…'
                  : bulkModal === 'reject'
                    ? 'Confirm rejection'
                    : 'Send changes note'}
              </button>
            </div>
          </div>
        </div>
      )}
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
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...styles.tab,
        ...(active ? styles.tabActive : hover ? styles.tabHover : {}),
      }}
    >
      {label}
    </button>
  );
}

/* ── Card ───────────────────────────────────────────────────── */
/* Each product is now its own card — same shape as the seller
   cards inside the inventory panel. The expand chevron opens the
   inventory breakdown *inside* the card, so the relationship
   between a product and its sources is visually contained. */

function ProductCard({
  product: p,
  selected,
  onToggle,
  onOpen,
  expanded,
  onToggleExpand,
  inventoryData,
}: {
  product: ProductListItem;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  expanded: boolean;
  onToggleExpand: () => void;
  inventoryData: InventoryPanelData | undefined;
}) {
  const [hover, setHover] = useState(false);
  const pill = statusPill(p.status);
  const isSelectable = p.status === 'SUBMITTED';

  // Status tone stripe on the left edge — single colour signal
  // identifying the product's lifecycle stage at a glance, same
  // pattern the seller/franchise cards already use.
  const stripe =
    pill.tone === 'success'
      ? '#16a34a'
      : pill.tone === 'warning'
        ? '#d97706'
        : pill.tone === 'danger'
          ? '#dc2626'
          : pill.tone === 'info'
            ? '#2563eb'
            : '#cbd5e1';

  return (
    <div
      role="listitem"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        borderLeft: `3px solid ${stripe}`,
        overflow: 'hidden',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: hover ? '0 2px 8px rgba(15, 23, 42, 0.06)' : 'none',
      }}
    >
      {/* Header row — clickable area, links to /edit. The chevron
          and checkbox stop propagation so they don't navigate. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onOpen();
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '14px 18px',
          cursor: 'pointer',
          background: expanded ? '#f8fafc' : '#fff',
        }}
      >
        {/* Selection checkbox — only enabled for SUBMITTED items.
            For others, render an empty box of the same width to keep
            cards aligned across the list. */}
        <div
          style={{ width: 18, flexShrink: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          {isSelectable && (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggle}
              aria-label={`Select ${p.title}`}
              style={styles.checkbox}
            />
          )}
        </div>

        {/* Product image */}
        {p.primaryImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.primaryImageUrl} alt="" style={styles.thumb} />
        ) : (
          <div style={styles.thumbPlaceholder} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" style={{ color: '#94a3b8' }}>
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 6h16v12H4zM4 14l4-4 5 5M14 10l2-2 4 4"
              />
            </svg>
          </div>
        )}

        {/* Title + meta line — primary identifier of the card.
            Title is the heaviest text on the card. The meta line
            collapses category, type, and price into one calm row. */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.productTitle}>
            <span title={p.title}>{p.title}</span>
            {p.potentialDuplicateOf && (
              <span
                style={styles.duplicateBadge}
                title="Possible duplicate"
                aria-label="Possible duplicate"
              >
                <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
                  <path fill="currentColor" d="M8 1l7 13H1L8 1zm0 5v3.5m0 2V11" />
                  <circle cx="8" cy="11.5" r="0.8" fill="currentColor" />
                </svg>
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: 12,
              color: '#64748b',
              marginTop: 3,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              alignItems: 'center',
            }}
          >
            {p.category && <span>{p.category.name}</span>}
            {p.category && <span style={{ color: '#cbd5e1' }}>·</span>}
            <span
              style={{
                ...styles.typePill,
                ...(p.hasVariants ? styles.typePillVariant : styles.typePillNormal),
              }}
            >
              {p.hasVariants ? 'Variant' : 'Normal'}
            </span>
            <span style={{ color: '#cbd5e1' }}>·</span>
            <span style={{ fontWeight: 600, color: '#475569', fontVariantNumeric: 'tabular-nums' }}>
              {p.hasVariants ? 'Multiple prices' : (formatPrice(p.basePrice) || '—')}
            </span>
          </div>
        </div>

        {/* Stock summary — uses the same StockCell helper but
            right-aligned to give the eye a numeric anchor. */}
        <div style={{ flexShrink: 0 }}>
          <StockCell product={p} />
        </div>

        {/* Status pill — kept compact; the left-edge stripe
            already speaks the tone, so the pill is supporting. */}
        <div style={{ flexShrink: 0 }}>
          <Pill label={pill.label} tone={pill.tone} />
        </div>

        {/* Expand chevron — opens the inventory panel inside
            this card. Rotates 90° when open. */}
        <button
          type="button"
          aria-label={expanded ? 'Hide inventory' : 'Show inventory'}
          aria-expanded={expanded}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            padding: 0,
            background: expanded ? '#e0e7ff' : 'transparent',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            color: expanded ? '#3730a3' : '#64748b',
            transition: 'background 0.15s, color 0.15s, transform 0.15s',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            flexShrink: 0,
          }}
        >
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
        </button>
      </div>

      {/* Expanded body — inventory panel inside the card itself.
          The top border ties it visually to the header above so
          the relationship is unambiguous. */}
      {expanded && (
        <div style={{ borderTop: '1px solid #e2e8f0' }}>
          <InventoryPanel product={p} data={inventoryData} />
        </div>
      )}
    </div>
  );
}

/* ── Stock cell ─────────────────────────────────────────────── */
/* Two-line stat for the table: top line is the headline available
   number + total in lighter weight; bottom line is the source mix
   (sellers + franchises) so the admin can tell at a glance whether
   stock is concentrated or distributed. The cell intentionally
   stays narrow — it's a summary, not a breakdown.                  */

function StockCell({ product: p }: { product: ProductListItem }) {
  const summary = p.inventorySummary;
  const total = summary?.totalStock ?? p.totalStock ?? p.baseStock ?? 0;
  const available = summary?.totalAvailable ?? total;
  const sellerCount = summary?.sellerCount ?? 0;
  const franchiseCount = summary?.franchiseCount ?? 0;
  const lowStockCount = summary?.lowStockCount ?? 0;

  const tone = available === 0 ? '#b91c1c' : available <= 5 ? '#b45309' : '#0f172a';
  const captionParts: string[] = [];
  if (sellerCount > 0) captionParts.push(`${sellerCount} seller${sellerCount === 1 ? '' : 's'}`);
  if (franchiseCount > 0) captionParts.push(`${franchiseCount} franchise${franchiseCount === 1 ? '' : 's'}`);

  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 1,
        lineHeight: 1.2,
      }}
    >
      <span
        style={{
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          fontSize: 14,
          color: tone,
        }}
        title={
          summary
            ? `${available} available · ${summary.totalReserved} reserved · ${total} total`
            : `${total} total`
        }
      >
        {available}
        {total !== available && (
          <span style={{ fontWeight: 400, color: '#94a3b8' }}> / {total}</span>
        )}
      </span>
      {captionParts.length > 0 && (
        <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>
          {captionParts.join(' · ')}
        </span>
      )}
      {lowStockCount > 0 && available > 0 && (
        <span style={{ fontSize: 10, color: '#b45309', fontWeight: 600 }}>
          ⚠ {lowStockCount} low
        </span>
      )}
    </div>
  );
}

/* ── Inventory panel (expanded row) ─────────────────────────── */
/* Shown when the user clicks the chevron next to a product. The
   panel has three pieces, in order of importance:
     1. KPI strip — the four numbers an admin actually wants to see.
     2. Source tabs — Sellers / Franchises (only shown if both have
        data; one alone gets shown without tabs).
     3. Grouped accordion of partners with their per-variant rows.
   Pre-aggregated summary lives on the product list response, so
   this panel only fetches the per-mapping detail on first expand. */

function InventoryPanel({
  product,
  data,
}: {
  product: ProductListItem;
  data: InventoryPanelData | undefined;
}) {
  const [tab, setTab] = useState<'sellers' | 'franchises'>('sellers');
  const summary = product.inventorySummary;
  const sellers = data?.sellers ?? [];
  const franchises = data?.franchises ?? [];

  // Default-tab heuristic: if sellers carry the stock, start there;
  // if the only data is on franchises, start on franchises. Saves
  // the admin one click on the most common cases.
  useEffect(() => {
    if (!data || data.loading) return;
    if (sellers.length === 0 && franchises.length > 0) setTab('franchises');
  }, [data?.loading, sellers.length, franchises.length]);

  const showBothTabs = sellers.length > 0 && franchises.length > 0;
  const onlySellers = sellers.length > 0 && franchises.length === 0;
  const onlyFranchises = franchises.length > 0 && sellers.length === 0;

  const totalStock = summary?.totalStock ?? product.totalStock ?? 0;
  const totalAvailable = summary?.totalAvailable ?? 0;
  const totalReserved = summary?.totalReserved ?? 0;
  const lowStockCount = summary?.lowStockCount ?? 0;
  const sellerCount = summary?.sellerCount ?? 0;
  const franchiseCount = summary?.franchiseCount ?? 0;

  // Available is the headline number — the one number an admin
  // actually wants to see when scanning. Total + reserved are
  // supporting context. Source counts are already shown by the tabs.
  const availableTone: 'success' | 'warning' | 'danger' =
    totalAvailable === 0 ? 'danger' : totalAvailable <= 5 ? 'warning' : 'success';

  return (
    // Padding matches the product card's header padding (14px 18px)
    // so the inventory panel reads as the natural body of the card,
    // not a separately-padded section.
    <div style={{ padding: '18px 18px 22px' }}>
      {/* Hero summary card — replaces the four-tile strip. One big
          available number leads, total and reserved are quieter
          stats stacked to the right. The chip row underneath
          carries the partner-mix and low-stock callout in one
          horizontally-scannable line.                                */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 28,
          padding: '18px 22px',
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span
            style={{
              fontSize: 32,
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
              letterSpacing: '-0.5px',
              color:
                availableTone === 'danger'
                  ? '#b91c1c'
                  : availableTone === 'warning'
                    ? '#b45309'
                    : '#16a34a',
            }}
          >
            {totalAvailable}
          </span>
          <span style={{ fontSize: 16, fontWeight: 500, color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
            / {totalStock}
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginLeft: 4 }}>
            available
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            flex: 1,
            justifyContent: 'flex-end',
          }}
        >
          {totalReserved > 0 && (
            <SummaryChip tone="info" label={`${totalReserved} reserved`} />
          )}
          {sellerCount > 0 && (
            <SummaryChip tone="neutral" label={`${sellerCount} seller${sellerCount === 1 ? '' : 's'}`} />
          )}
          {franchiseCount > 0 && (
            <SummaryChip tone="neutral" label={`${franchiseCount} franchise${franchiseCount === 1 ? '' : 's'}`} />
          )}
          {lowStockCount > 0 && (
            <SummaryChip tone="warning" label={`${lowStockCount} low stock`} />
          )}
          {sellerCount === 0 && franchiseCount === 0 && (
            <SummaryChip tone="neutral" label="No partners" />
          )}
        </div>
      </div>

      {/* Loading / empty / error states — bare states beat fancy
          ones here; this panel is content-dense already. */}
      {data?.loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
          Loading inventory breakdown…
        </div>
      ) : data?.error ? (
        <div style={{ padding: 16, fontSize: 13, color: '#b91c1c' }}>{data.error}</div>
      ) : sellers.length === 0 && franchises.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: '#64748b' }}>
          No sellers or franchises mapped to this product yet.
        </div>
      ) : (
        <>
          {showBothTabs && (
            <div
              role="tablist"
              style={{
                display: 'flex',
                gap: 4,
                marginBottom: 16,
                borderBottom: '1px solid #e2e8f0',
              }}
            >
              <PanelTab active={tab === 'sellers'} count={sellers.length} label="Sellers" onClick={() => setTab('sellers')} />
              <PanelTab active={tab === 'franchises'} count={franchises.length} label="Franchises" onClick={() => setTab('franchises')} />
            </div>
          )}

          {(onlySellers || (showBothTabs && tab === 'sellers')) && (
            <SellerGroupedList sellers={sellers} />
          )}
          {(onlyFranchises || (showBothTabs && tab === 'franchises')) && (
            <FranchiseGroupedList franchises={franchises} />
          )}
        </>
      )}
    </div>
  );
}

/* SummaryChip — semantic, single dot + label. The dot carries the
   tone so the chip can stay near-monochrome and not compete with
   the headline available number. */
function SummaryChip({
  tone,
  label,
}: {
  tone: 'neutral' | 'info' | 'warning';
  label: string;
}) {
  const palette: Record<typeof tone, { dot: string; bg: string; fg: string }> = {
    neutral: { dot: '#94a3b8', bg: '#f8fafc', fg: '#475569' },
    info: { dot: '#2563eb', bg: '#eff6ff', fg: '#1d4ed8' },
    warning: { dot: '#d97706', bg: '#fffbeb', fg: '#b45309' },
  };
  const p = palette[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        background: p.bg,
        color: p.fg,
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.dot }} />
      {label}
    </span>
  );
}

function PanelTab({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        background: 'transparent',
        border: 'none',
        padding: '8px 14px',
        fontFamily: 'inherit',
        fontSize: 13,
        fontWeight: 600,
        color: active ? '#1d4ed8' : '#64748b',
        borderBottom: active ? '2px solid #1d4ed8' : '2px solid transparent',
        marginBottom: -1,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {label}
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 20,
          height: 20,
          padding: '0 6px',
          fontSize: 11,
          fontWeight: 700,
          borderRadius: 999,
          background: active ? '#dbeafe' : '#f1f5f9',
          color: active ? '#1d4ed8' : '#64748b',
        }}
      >
        {count}
      </span>
    </button>
  );
}

/* ── Health dot ──────────────────────────────────────────────── */
/* Replaces the 3-pill stack from the old design. One signal: green
   = healthy, amber = low, red = out, slate = pending/inactive. */
function HealthDot({
  status,
}: {
  status: 'healthy' | 'low' | 'out' | 'inactive';
}) {
  const palette = {
    healthy: { bg: '#16a34a', label: 'Healthy' },
    low: { bg: '#d97706', label: 'Low stock' },
    out: { bg: '#dc2626', label: 'Out of stock' },
    inactive: { bg: '#94a3b8', label: 'Inactive' },
  };
  const p = palette[status];
  return (
    <span
      title={p.label}
      aria-label={p.label}
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: p.bg,
        flexShrink: 0,
      }}
    />
  );
}

function rowHealth(
  available: number,
  threshold: number,
  approval: string | null,
  isActive: boolean,
): 'healthy' | 'low' | 'out' | 'inactive' {
  if (!isActive || (approval && approval !== 'APPROVED')) return 'inactive';
  if (available === 0) return 'out';
  if (available <= threshold) return 'low';
  return 'healthy';
}

/* ── Seller / Franchise grouped lists ───────────────────────── */
/* One card per partner; click to expand and see the per-variant
   rows. Mirrors the franchise-admin catalog card pattern so the
   internal users learn one shape, not three.                    */

function SellerGroupedList({ sellers }: { sellers: AdminSellerMapping[] }) {
  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; rows: AdminSellerMapping[] }>();
    for (const m of sellers) {
      const key = m.seller.id;
      if (!map.has(key)) map.set(key, { name: m.seller.sellerName, rows: [] });
      map.get(key)!.rows.push(m);
    }
    return Array.from(map.entries());
  }, [sellers]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {grouped.map(([id, group]) => (
        <PartnerCard
          key={id}
          name={group.name}
          subtitle={group.rows[0]?.seller.sellerZipCode ? `Pincode ${group.rows[0].seller.sellerZipCode}` : undefined}
          totals={{
            stock: group.rows.reduce((s, r) => s + r.stockQty, 0),
            available: group.rows.reduce((s, r) => s + r.availableQty, 0),
            variants: group.rows.length,
          }}
          rows={group.rows.map((r) => ({
            id: r.id,
            sku: r.sellerInternalSku || r.variant?.sku || '—',
            label: r.variant?.title || 'Default',
            stock: r.stockQty,
            available: r.availableQty,
            reserved: r.reservedQty,
            slaDays: r.dispatchSla,
            approval: r.approvalStatus,
            isActive: r.isActive,
            lowThreshold: r.lowStockThreshold,
            updated: r.updatedAt,
            extra: undefined,
          }))}
        />
      ))}
    </div>
  );
}

function FranchiseGroupedList({ franchises }: { franchises: AdminFranchiseMapping[] }) {
  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; pincode: string | null; status: string; rows: AdminFranchiseMapping[] }>();
    for (const m of franchises) {
      const key = m.franchise.id;
      if (!map.has(key)) {
        map.set(key, {
          name: m.franchise.businessName,
          pincode: m.franchise.warehousePincode,
          status: m.franchise.status,
          rows: [],
        });
      }
      map.get(key)!.rows.push(m);
    }
    return Array.from(map.entries());
  }, [franchises]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {grouped.map(([id, group]) => (
        <PartnerCard
          key={id}
          name={group.name}
          tone="franchise"
          subtitle={
            group.pincode
              ? `Pincode ${group.pincode} · ${group.status}`
              : group.status
          }
          totals={{
            stock: group.rows.reduce((s, r) => s + r.stockQty, 0),
            available: group.rows.reduce((s, r) => s + r.availableQty, 0),
            variants: group.rows.length,
          }}
          rows={group.rows.map((r) => ({
            id: r.id,
            sku: r.franchiseSku || r.globalSku || '—',
            label: r.variant?.title || 'Product-level',
            stock: r.stockQty,
            available: r.availableQty,
            reserved: r.reservedQty,
            slaDays: undefined,
            approval: r.approvalStatus,
            isActive: r.isActive,
            lowThreshold: r.lowStockThreshold,
            updated: r.updatedAt,
            extra: r.isListedForOnlineFulfillment ? 'Listed' : 'Hidden',
          }))}
        />
      ))}
    </div>
  );
}

interface PartnerRow {
  id: string;
  sku: string;
  label: string;
  stock: number;
  available: number;
  reserved: number;
  slaDays?: number;
  approval: string | null;
  isActive: boolean;
  lowThreshold: number;
  updated: string;
  extra?: string;
}

function PartnerCard({
  name,
  subtitle,
  totals,
  rows,
  tone = 'seller',
}: {
  name: string;
  subtitle?: string;
  totals: { stock: number; available: number; variants: number };
  rows: PartnerRow[];
  tone?: 'seller' | 'franchise';
}) {
  const [open, setOpen] = useState(false);
  const initial = (name || '?').charAt(0).toUpperCase();

  // Tone — a single coloured left edge identifies seller vs franchise
  // at a glance. The avatar carries the same hue at lower saturation
  // so the eye gets one signal twice, not two competing ones.
  const palette =
    tone === 'franchise'
      ? { stripe: '#7c3aed', avatarBg: '#ede9fe', avatarFg: '#6d28d9' }
      : { stripe: '#2563eb', avatarBg: '#dbeafe', avatarFg: '#1d4ed8' };

  // Available headline takes the green-amber-red tone that the row
  // health dots already speak. Keeps the inventory panel monochromatic
  // except where the eye should land.
  const availableTone =
    totals.available === 0 ? '#b91c1c' : totals.available <= 5 ? '#b45309' : '#16a34a';

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 10,
        overflow: 'hidden',
        borderLeft: `3px solid ${palette.stripe}`,
      }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(!open);
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '14px 18px',
          cursor: 'pointer',
          userSelect: 'none',
          background: open ? '#f8fafc' : '#fff',
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: palette.avatarBg,
            color: palette.avatarFg,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {initial}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', lineHeight: 1.2 }}>{name}</div>
          {subtitle && (
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
              {subtitle} · {totals.variants} variant{totals.variants === 1 ? '' : 's'} · {totals.stock} in stock
            </div>
          )}
          {!subtitle && (
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
              {totals.variants} variant{totals.variants === 1 ? '' : 's'} · {totals.stock} in stock
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: availableTone, lineHeight: 1 }}>
            {totals.available}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            avail
          </span>
        </div>
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          aria-hidden="true"
          style={{
            color: '#94a3b8',
            transform: open ? 'rotate(180deg)' : 'rotate(0)',
            transition: 'transform 0.15s',
            flexShrink: 0,
          }}
        >
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 6l4 4 4-4"
          />
        </svg>
      </div>
      {open && (
        <div style={{ borderTop: '1px solid #e2e8f0' }}>
          {rows.map((r, idx) => {
            const health = rowHealth(r.available, r.lowThreshold, r.approval, r.isActive);
            const availableColor =
              health === 'out' ? '#b91c1c' : health === 'low' ? '#b45309' : '#0f172a';
            return (
              <div
                key={r.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '12px 18px 12px 14px',
                  borderTop: idx === 0 ? 'none' : '1px solid #f1f5f9',
                }}
              >
                <HealthDot status={health} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', lineHeight: 1.3 }}>
                    {r.label}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#475569' }}>
                      {r.sku}
                    </span>
                    <span style={{ color: '#cbd5e1' }}>·</span>
                    <span>{r.stock} in stock</span>
                    {r.reserved > 0 && (
                      <>
                        <span style={{ color: '#cbd5e1' }}>·</span>
                        <span style={{ color: '#854d0e', fontWeight: 600 }}>{r.reserved} reserved</span>
                      </>
                    )}
                    {r.approval && r.approval !== 'APPROVED' && (
                      <>
                        <span style={{ color: '#cbd5e1' }}>·</span>
                        <span style={{ color: '#475569', fontWeight: 600 }}>{r.approval.replace(/_/g, ' ')}</span>
                      </>
                    )}
                    {r.extra && (
                      <>
                        <span style={{ color: '#cbd5e1' }}>·</span>
                        <span>{r.extra}</span>
                      </>
                    )}
                    {r.slaDays !== undefined && (
                      <>
                        <span style={{ color: '#cbd5e1' }}>·</span>
                        <span>{r.slaDays}d SLA</span>
                      </>
                    )}
                    <span style={{ color: '#cbd5e1' }}>·</span>
                    <span style={{ color: '#94a3b8' }}>
                      {new Date(r.updated).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: availableColor, lineHeight: 1 }}>
                    {r.available}
                  </div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 }}>
                    available
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Pill ───────────────────────────────────────────────────── */

function Pill({ label, tone }: { label: string; tone: PillTone }) {
  const toneStyles = pillTones[tone];
  return (
    <span style={{ ...styles.pill, ...toneStyles.wrap }}>
      <span style={{ ...styles.pillDot, background: toneStyles.dot }} />
      {label}
    </span>
  );
}

const pillTones: Record<
  PillTone,
  { wrap: React.CSSProperties; dot: string }
> = {
  success: {
    wrap: {
      background: 'rgba(22, 163, 74, 0.08)',
      color: '#15803d',
      borderColor: 'rgba(22, 163, 74, 0.2)',
    },
    dot: '#16a34a',
  },
  warning: {
    wrap: {
      background: 'rgba(245, 158, 11, 0.1)',
      color: '#b45309',
      borderColor: 'rgba(245, 158, 11, 0.25)',
    },
    dot: '#f59e0b',
  },
  danger: {
    wrap: {
      background: 'rgba(220, 38, 38, 0.08)',
      color: '#b91c1c',
      borderColor: 'rgba(220, 38, 38, 0.2)',
    },
    dot: '#dc2626',
  },
  info: {
    wrap: {
      background: 'rgba(14, 116, 144, 0.08)',
      color: '#0e7490',
      borderColor: 'rgba(14, 116, 144, 0.2)',
    },
    dot: '#0891b2',
  },
  neutral: {
    wrap: {
      background: '#f1f5f9',
      color: '#475569',
      borderColor: '#e2e8f0',
    },
    dot: '#94a3b8',
  },
};

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
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4l-6 6 6 6"
            />
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
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 4l6 6-6 6"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

/* ── Skeleton / Empty / Error ───────────────────────────────── */

function SkeletonTable() {
  return (
    <div style={styles.cardList}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '14px 18px',
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            borderLeft: '3px solid #e2e8f0',
          }}
        >
          <div style={{ ...styles.thumb, ...styles.shimmer }} />
          <div style={{ flex: 1 }}>
            <div style={{ ...styles.skelLine, width: 240 }} />
            <div style={{ ...styles.skelLine, width: 160, marginTop: 6 }} />
          </div>
          <div style={{ ...styles.skelLine, width: 60, height: 24 }} />
          <div style={{ ...styles.skelLine, width: 80, height: 24 }} />
          <div style={{ ...styles.skelLine, width: 24, height: 24, borderRadius: 6 }} />
        </div>
      ))}
      <style>{shimmerKeyframes}</style>
    </div>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div style={styles.empty}>
      <svg viewBox="0 0 48 48" style={styles.emptyIcon} aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M6 12h36v24a4 4 0 01-4 4H10a4 4 0 01-4-4V12zM6 12l4-6h28l4 6M18 22h12"
        />
      </svg>
      <h3 style={styles.emptyTitle}>
        {hasFilters ? 'No products match your filters' : 'No products yet'}
      </h3>
      <p style={styles.emptyBody}>
        {hasFilters
          ? 'Try adjusting the search, status, or tab above.'
          : 'Products will appear here once sellers submit them.'}
      </p>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
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
      <h3 style={styles.emptyTitle}>Couldn't load products</h3>
      <p style={styles.emptyBody}>{message}</p>
      <button
        type="button"
        onClick={onRetry}
        style={{ ...styles.btnGhost, marginTop: 16 }}
      >
        Try again
      </button>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

const shimmerKeyframes = `
@keyframes products-shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position:  400px 0; }
}
`;

const styles: Record<string, React.CSSProperties> = {
  page: {
    color: '#0f172a',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
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
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
  },
  headerCount: {
    fontSize: 14,
    fontWeight: 500,
    color: '#64748b',
    padding: '2px 10px',
    borderRadius: 999,
    background: '#f1f5f9',
    fontVariantNumeric: 'tabular-nums',
  },
  headerSub: {
    margin: '4px 0 0',
    fontSize: 13,
    color: '#64748b',
  },

  /* Buttons */
  btnPrimary: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 38,
    padding: '0 16px',
    fontSize: 13,
    fontWeight: 600,
    color: '#ffffff',
    background: '#0f172a',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#0f172a',
    borderRadius: 8,
    cursor: 'pointer',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    fontFamily: 'inherit',
  },
  btnIcon: {
    width: 14,
    height: 14,
  },
  btnGhost: {
    height: 38,
    padding: '0 14px',
    fontSize: 13,
    fontWeight: 500,
    color: '#334155',
    background: '#ffffff',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  btnDanger: {
    background: '#b91c1c',
    borderColor: '#b91c1c',
  },
  btnWarning: {
    background: '#b45309',
    borderColor: '#b45309',
  },
  disabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },

  /* Toolbar */
  toolbar: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  tabs: {
    display: 'inline-flex',
    gap: 4,
    padding: 4,
    background: '#f1f5f9',
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
  },
  tab: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 30,
    padding: '0 12px',
    fontSize: 13,
    fontWeight: 500,
    color: '#475569',
    background: 'transparent',
    border: 'none',
    borderRadius: 7,
    cursor: 'pointer',
    transition: 'background-color 0.12s, color 0.12s, box-shadow 0.12s',
    fontFamily: 'inherit',
  },
  tabHover: {
    background: 'rgba(255, 255, 255, 0.6)',
    color: '#0f172a',
  },
  tabActive: {
    background: '#ffffff',
    color: '#0f172a',
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
    fontWeight: 600,
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
    transition: 'border-color 0.12s, box-shadow 0.12s',
    fontFamily: 'inherit',
  },
  select: {
    height: 38,
    padding: '0 12px',
    fontSize: 14,
    color: '#0f172a',
    background: '#ffffff',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 8,
    outline: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minWidth: 170,
  },

  /* Bulk bar */
  bulkBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    marginBottom: 12,
    background: 'rgba(0, 128, 96, 0.06)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'rgba(0, 128, 96, 0.3)',
    borderRadius: 10,
    flexWrap: 'wrap',
  },
  bulkCount: {
    fontSize: 13,
    color: '#00604a',
    marginRight: 4,
  },
  bulkBtn: {
    height: 30,
    padding: '0 12px',
    fontSize: 12,
    fontWeight: 600,
    borderWidth: 1,
    borderStyle: 'solid',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  bulkBtnApprove: {
    background: '#16a34a',
    borderColor: '#16a34a',
    color: '#ffffff',
  },
  bulkBtnWarning: {
    background: '#ffffff',
    borderColor: 'rgba(245, 158, 11, 0.5)',
    color: '#b45309',
  },
  bulkBtnDanger: {
    background: '#ffffff',
    borderColor: 'rgba(220, 38, 38, 0.4)',
    color: '#b91c1c',
  },
  bulkBtnClear: {
    marginLeft: 'auto',
    height: 30,
    padding: '0 10px',
    fontSize: 12,
    color: '#64748b',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  bulkMessage: {
    padding: '10px 14px',
    marginBottom: 12,
    background: 'rgba(22, 163, 74, 0.08)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'rgba(22, 163, 74, 0.2)',
    borderRadius: 8,
    fontSize: 13,
    color: '#15803d',
  },

  /* Card stack — replaces the table layout. Each product is its
     own card with breathable padding; gap between cards gives the
     list a clear rhythm instead of zebra stripes. */
  cardList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },

  /* Compact toolbar that appears above the card list when there
     are selectable (SUBMITTED) products on the page. */
  selectAllBar: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 16px',
    marginBottom: 10,
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    fontSize: 13,
    color: '#475569',
  },
  selectAllLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 10,
    cursor: 'pointer',
    userSelect: 'none',
  },

  /* Card + Table */
  card: {
    background: '#ffffff',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 10,
    overflow: 'hidden',
  },
  tableScroll: { overflowX: 'auto' },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 14,
  },
  th: {
    textAlign: 'left',
    padding: '10px 16px',
    fontSize: 11,
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
    whiteSpace: 'nowrap',
  },
  tr: {
    borderBottom: '1px solid #f1f5f9',
    cursor: 'pointer',
    transition: 'background-color 0.08s',
  },
  td: {
    padding: '12px 16px',
    verticalAlign: 'middle',
    fontSize: 13,
    color: '#0f172a',
  },
  checkbox: {
    width: 16,
    height: 16,
    accentColor: '#00805f',
    cursor: 'pointer',
  },

  /* Product cell */
  productCell: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
  },
  thumb: {
    width: 40,
    height: 40,
    objectFit: 'cover',
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    background: '#f8fafc',
    flexShrink: 0,
  },
  thumbPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 6,
    background: '#f8fafc',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  productTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 14,
    fontWeight: 600,
    color: '#0f172a',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  productCategory: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  duplicateBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 16,
    height: 16,
    color: '#b45309',
    flexShrink: 0,
  },

  /* Type pill */
  typePill: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    fontSize: 11,
    fontWeight: 600,
    borderRadius: 4,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
  },
  typePillNormal: {
    background: '#f1f5f9',
    color: '#475569',
  },
  typePillVariant: {
    background: 'rgba(14, 116, 144, 0.08)',
    color: '#0e7490',
  },

  /* Status pill */
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 10px 3px 8px',
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'solid',
    lineHeight: 1.4,
    whiteSpace: 'nowrap',
  },
  pillDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
  },

  rowChevron: {
    width: 16,
    height: 16,
    display: 'inline-block',
    marginRight: 12,
    transition: 'opacity 0.12s, color 0.12s',
  },

  /* Pagination */
  pagination: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
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
    background: '#ffffff',
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
    background: '#ffffff',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 10,
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
    fontSize: 16,
    fontWeight: 600,
    color: '#0f172a',
  },
  emptyBody: {
    margin: '6px auto 0',
    fontSize: 13,
    color: '#64748b',
    maxWidth: 360,
  },

  /* Modal */
  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    zIndex: 50,
  },
  modal: {
    background: '#ffffff',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 480,
    boxShadow: '0 20px 40px rgba(15, 23, 42, 0.24)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
  },
  modalTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
    color: '#0f172a',
    letterSpacing: '-0.01em',
  },
  modalBody: {
    marginTop: 6,
    marginBottom: 16,
    color: '#64748b',
    fontSize: 13,
    lineHeight: 1.5,
  },
  modalError: {
    padding: '10px 12px',
    background: 'rgba(220, 38, 38, 0.08)',
    color: '#b91c1c',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'rgba(220, 38, 38, 0.2)',
    borderRadius: 8,
    marginBottom: 12,
    fontSize: 13,
  },
  modalLabel: {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: '#0f172a',
    marginBottom: 6,
  },
  textarea: {
    width: '100%',
    padding: '10px 12px',
    fontSize: 14,
    color: '#0f172a',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 8,
    marginBottom: 16,
    resize: 'vertical',
    fontFamily: 'inherit',
    outline: 'none',
    boxSizing: 'border-box',
  },
  modalFooter: {
    display: 'flex',
    gap: 10,
    justifyContent: 'flex-end',
  },

  /* Shimmer */
  skelLine: {
    display: 'block',
    height: 12,
    borderRadius: 4,
    background:
      'linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 37%, #f1f5f9 63%) 0 0 / 800px 100%',
    animation: 'products-shimmer 1.2s ease-in-out infinite',
  },
  shimmer: {
    background:
      'linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 37%, #f1f5f9 63%) 0 0 / 800px 100%',
    animation: 'products-shimmer 1.2s ease-in-out infinite',
  },
};
