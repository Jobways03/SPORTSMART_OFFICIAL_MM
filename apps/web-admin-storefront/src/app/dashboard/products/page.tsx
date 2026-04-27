'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  adminProductsService,
  ProductListItem,
  ListProductsParams,
} from '@/services/admin-products.service';
import { ApiError } from '@/lib/api-client';
import { useModal } from '@sportsmart/ui';

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
          <div style={styles.card}>
            <div style={styles.tableScroll}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={{ ...styles.th, width: 36 }}>
                      <input
                        type="checkbox"
                        aria-label="Select all pending products on this page"
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someSelected;
                        }}
                        onChange={toggleAll}
                        disabled={selectableIds.length === 0}
                        style={styles.checkbox}
                      />
                    </th>
                    <th style={styles.th}>Product</th>
                    <th style={styles.th}>Type</th>
                    <th style={{ ...styles.th, textAlign: 'right' as const }}>
                      Price
                    </th>
                    <th style={{ ...styles.th, textAlign: 'right' as const }}>
                      Stock
                    </th>
                    <th style={styles.th}>Status</th>
                    <th
                      style={{ ...styles.th, width: 36 }}
                      aria-hidden="true"
                    />
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <ProductRow
                      key={p.id}
                      product={p}
                      selected={selected.has(p.id)}
                      onToggle={() => toggleOne(p.id)}
                      onOpen={() =>
                        router.push(`/dashboard/products/${p.id}/edit`)
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
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

/* ── Row ────────────────────────────────────────────────────── */

function ProductRow({
  product: p,
  selected,
  onToggle,
  onOpen,
}: {
  product: ProductListItem;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const [hover, setHover] = useState(false);
  const pill = statusPill(p.status);
  const isSelectable = p.status === 'SUBMITTED';

  return (
    <tr
      style={{
        ...styles.tr,
        background: hover ? '#f8fafc' : 'transparent',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <td
        style={{ ...styles.td, width: 36 }}
        onClick={(e) => e.stopPropagation()}
      >
        {isSelectable ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`Select ${p.title}`}
            style={styles.checkbox}
          />
        ) : null}
      </td>
      <td style={styles.td} onClick={onOpen}>
        <div style={styles.productCell}>
          {p.primaryImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={p.primaryImageUrl}
              alt=""
              style={styles.thumb}
            />
          ) : (
            <div style={styles.thumbPlaceholder} aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                style={{ color: '#94a3b8' }}
              >
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
          <div style={{ minWidth: 0 }}>
            <div style={styles.productTitle}>
              <span title={p.title}>{p.title}</span>
              {p.potentialDuplicateOf && (
                <span
                  style={styles.duplicateBadge}
                  title="Possible duplicate"
                  aria-label="Possible duplicate"
                >
                  <svg
                    viewBox="0 0 16 16"
                    width="10"
                    height="10"
                    aria-hidden="true"
                  >
                    <path
                      fill="currentColor"
                      d="M8 1l7 13H1L8 1zm0 5v3.5m0 2V11"
                    />
                    <circle cx="8" cy="11.5" r="0.8" fill="currentColor" />
                  </svg>
                </span>
              )}
            </div>
            {p.category && (
              <div style={styles.productCategory}>{p.category.name}</div>
            )}
          </div>
        </div>
      </td>
      <td style={styles.td} onClick={onOpen}>
        <span
          style={{
            ...styles.typePill,
            ...(p.hasVariants ? styles.typePillVariant : styles.typePillNormal),
          }}
        >
          {p.hasVariants ? 'Variant' : 'Normal'}
        </span>
      </td>
      <td
        style={{
          ...styles.td,
          textAlign: 'right' as const,
          fontVariantNumeric: 'tabular-nums',
        }}
        onClick={onOpen}
      >
        {p.hasVariants ? (
          <span style={{ color: '#475569' }}>Multiple</span>
        ) : (
          <span style={{ fontWeight: 600 }}>
            {formatPrice(p.basePrice) || '—'}
          </span>
        )}
      </td>
      <td
        style={{
          ...styles.td,
          textAlign: 'right' as const,
          fontVariantNumeric: 'tabular-nums',
          color:
            (p.totalStock ?? p.baseStock ?? 0) === 0
              ? '#b91c1c'
              : (p.totalStock ?? p.baseStock ?? 0) <= 5
                ? '#b45309'
                : '#0f172a',
        }}
        onClick={onOpen}
      >
        {p.totalStock ?? p.baseStock ?? 0}
      </td>
      <td style={styles.td} onClick={onOpen}>
        <Pill label={pill.label} tone={pill.tone} />
      </td>
      <td
        style={{ ...styles.td, padding: 0, textAlign: 'right' }}
        onClick={onOpen}
      >
        <svg
          viewBox="0 0 20 20"
          style={{
            ...styles.rowChevron,
            opacity: hover ? 1 : 0,
            color: hover ? '#64748b' : 'transparent',
          }}
          aria-hidden="true"
        >
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 4l6 6-6 6"
          />
        </svg>
      </td>
    </tr>
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
    <div style={styles.card}>
      <div style={styles.tableScroll}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={{ ...styles.th, width: 36 }} />
              <th style={styles.th}>Product</th>
              <th style={styles.th}>Type</th>
              <th style={{ ...styles.th, textAlign: 'right' as const }}>
                Price
              </th>
              <th style={{ ...styles.th, textAlign: 'right' as const }}>
                Stock
              </th>
              <th style={styles.th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }).map((_, i) => (
              <tr key={i} style={styles.tr}>
                <td style={{ ...styles.td, width: 36 }} />
                <td style={styles.td}>
                  <div style={styles.productCell}>
                    <div style={{ ...styles.thumb, ...styles.shimmer }} />
                    <div>
                      <div style={{ ...styles.skelLine, width: 220 }} />
                      <div
                        style={{ ...styles.skelLine, width: 120, marginTop: 6 }}
                      />
                    </div>
                  </div>
                </td>
                <td style={styles.td}>
                  <div style={{ ...styles.skelLine, width: 70, height: 20 }} />
                </td>
                <td style={{ ...styles.td, textAlign: 'right' as const }}>
                  <div
                    style={{
                      ...styles.skelLine,
                      width: 60,
                      marginLeft: 'auto',
                    }}
                  />
                </td>
                <td style={{ ...styles.td, textAlign: 'right' as const }}>
                  <div
                    style={{
                      ...styles.skelLine,
                      width: 30,
                      marginLeft: 'auto',
                    }}
                  />
                </td>
                <td style={styles.td}>
                  <div style={{ ...styles.skelLine, width: 96, height: 22 }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
