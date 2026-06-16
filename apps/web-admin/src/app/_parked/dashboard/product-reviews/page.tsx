'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  adminProductReviewsService,
  ProductReview,
  ReviewStatus,
} from '@/services/admin-product-reviews.service';
import { ApiError } from '@/lib/api-client';
// Reuses the flash-sales stylesheet — same table + drawer grammar
import '../flash-sales/flash-sales.css';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

// Renders 5 stars with `count` filled. Tiny helper kept inline because
// it's only used in this file — sharing it package-wide would be
// premature abstraction.
function Stars({ count }: { count: number }) {
  const clamped = Math.max(0, Math.min(5, count));
  return (
    <span style={{ letterSpacing: 1, color: '#c8a878' }}>
      {'★'.repeat(clamped)}
      <span style={{ color: '#e5e7eb' }}>{'★'.repeat(5 - clamped)}</span>
    </span>
  );
}

const FILTERS: Array<{
  key: 'all' | ReviewStatus;
  label: string;
}> = [
  { key: 'PENDING', label: 'Pending' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

const STATUS_PILL: Record<ReviewStatus, string> = {
  PENDING: 'upcoming',
  APPROVED: 'active',
  REJECTED: 'inactive',
};

export default function ProductReviewsPage() {
  const [rows, setRows] = useState<ProductReview[]>([]);
  const [loading, setLoading] = useState(true);
  // Default to PENDING — moderation queue land-and-act flow.
  const [filter, setFilter] = useState<'all' | ReviewStatus>('PENDING');
  const [productSearch, setProductSearch] = useState('');
  const [acting, setActing] = useState<string | null>(null);
  // Rejection drawer state — opens when admin clicks Reject so they
  // can attach a reason that lands in the customer-facing audit log.
  const [rejectFor, setRejectFor] = useState<ProductReview | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminProductReviewsService.list({
        limit: 100,
        status: filter === 'all' ? undefined : filter,
        productSlug: productSearch.trim() || undefined,
      });
      setRows(res.data?.items ?? []);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[product-reviews] list failed', err);
    } finally {
      setLoading(false);
    }
  }, [filter, productSearch]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Counts surface alongside the filter pill labels so moderators
  // can see "23 pending" at a glance without switching tabs.
  const counts = useMemo(() => {
    return {
      all: rows.length,
      PENDING: rows.filter(r => r.status === 'PENDING').length,
      APPROVED: rows.filter(r => r.status === 'APPROVED').length,
      REJECTED: rows.filter(r => r.status === 'REJECTED').length,
    };
  }, [rows]);

  const onApprove = async (row: ProductReview) => {
    setActing(row.id);
    try {
      await adminProductReviewsService.approve(row.id);
      await reload();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setActing(null);
    }
  };

  const openReject = (row: ProductReview) => {
    setRejectFor(row);
    setRejectReason(row.rejectionReason ?? '');
  };

  const submitReject = async () => {
    if (!rejectFor) return;
    setActing(rejectFor.id);
    try {
      await adminProductReviewsService.reject(
        rejectFor.id,
        rejectReason.trim() || undefined,
      );
      setRejectFor(null);
      setRejectReason('');
      await reload();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Reject failed',
      );
    } finally {
      setActing(null);
    }
  };

  const onDelete = async (row: ProductReview) => {
    // eslint-disable-next-line no-alert
    if (
      !confirm(
        `Permanently delete this review? Different from "Reject" — delete removes the row entirely.`,
      )
    ) {
      return;
    }
    setActing(row.id);
    try {
      await adminProductReviewsService.remove(row.id);
      await reload();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="fs-page">
      <div className="fs-header">
        <div>
          <h1>Product reviews</h1>
          <p className="sub">
            User-submitted reviews queue. New reviews land in{' '}
            <strong>Pending</strong> — approve to publish, reject with a
            reason to keep the audit trail, or delete to remove entirely.
          </p>
        </div>
      </div>

      {/* Filter + search row */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
        }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {FILTERS.map(f => {
            const isActive = filter === f.key;
            const count = counts[f.key];
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                style={{
                  padding: '7px 14px',
                  borderRadius: 16,
                  border: '1px solid',
                  borderColor: isActive ? '#111827' : '#e5e7eb',
                  background: isActive ? '#111827' : '#fff',
                  color: isActive ? '#fff' : '#374151',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}>
                {f.label}
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: 18,
                    height: 18,
                    padding: '0 6px',
                    borderRadius: 9,
                    background: isActive
                      ? 'rgba(255,255,255,0.18)'
                      : '#f3f4f6',
                    color: isActive ? '#fff' : '#6b7280',
                    fontSize: 10,
                    fontWeight: 700,
                  }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <input
          type="text"
          placeholder="Filter by product slug…"
          value={productSearch}
          onChange={e => setProductSearch(e.target.value)}
          style={{
            flex: 1,
            minWidth: 240,
            padding: '8px 12px',
            border: '1px solid #d1d5db',
            borderRadius: 8,
            fontSize: 13,
            fontFamily: 'ui-monospace, monospace',
          }}
        />
      </div>

      <div className="fs-table-wrap">
        {loading ? (
          <div className="fs-empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="fs-empty">
            {filter === 'PENDING' ? (
              <>
                Nothing pending — moderation queue is clear. Switch the
                filter to see approved or rejected reviews.
              </>
            ) : (
              <>No reviews match the current filter.</>
            )}
          </div>
        ) : (
          <table className="fs-table">
            <thead>
              <tr>
                <th>Review</th>
                <th>Product</th>
                <th>Author</th>
                <th>Status</th>
                <th>Submitted</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const isActing = acting === row.id;
                return (
                  <tr key={row.id}>
                    <td style={{ maxWidth: 360 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          marginBottom: 4,
                        }}>
                        <Stars count={row.rating} />
                        <span
                          style={{
                            fontSize: 12,
                            color: '#6b7280',
                            fontWeight: 600,
                          }}>
                          {row.rating}/5
                        </span>
                      </div>
                      {row.title ? (
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: 13,
                            color: '#111827',
                            marginBottom: 2,
                          }}>
                          {row.title}
                        </div>
                      ) : null}
                      <div
                        style={{
                          fontSize: 12,
                          color: '#374151',
                          lineHeight: 1.4,
                          // Quote-styled, capped to ~3 lines so the row
                          // doesn't dominate vertical space.
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}>
                        {row.body}
                      </div>
                      {row.rejectionReason ? (
                        <div
                          style={{
                            marginTop: 6,
                            fontSize: 11,
                            color: '#b91c1c',
                            background: '#fef2f2',
                            border: '1px solid #fecaca',
                            padding: '4px 8px',
                            borderRadius: 6,
                          }}>
                          <strong>Reject reason:</strong>{' '}
                          {row.rejectionReason}
                        </div>
                      ) : null}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          color: '#111827',
                        }}>
                        {row.productTitle}
                      </div>
                      <div
                        style={{
                          color: '#6b7280',
                          fontFamily: 'ui-monospace, monospace',
                          fontSize: 11,
                          marginTop: 2,
                        }}>
                        /{row.productSlug}
                      </div>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      <div style={{ fontWeight: 600, color: '#111827' }}>
                        {row.authorName}
                      </div>
                      <div style={{ color: '#6b7280', marginTop: 2 }}>
                        {row.userEmail}
                      </div>
                      {row.verifiedBuyer ? (
                        <span
                          style={{
                            display: 'inline-block',
                            marginTop: 4,
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: 0.5,
                            color: '#065f46',
                            background: '#d1fae5',
                            padding: '2px 6px',
                            borderRadius: 8,
                          }}>
                          VERIFIED BUYER
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <span className={`fs-badge ${STATUS_PILL[row.status]}`}>
                        {row.status[0] + row.status.slice(1).toLowerCase()}
                      </span>
                    </td>
                    <td style={{ fontSize: 11, color: '#6b7280' }}>
                      {formatDate(row.createdAt)}
                    </td>
                    <td>
                      <div className="fs-row-actions">
                        {row.status !== 'APPROVED' ? (
                          <button
                            className="fs-icon-btn"
                            disabled={isActing}
                            onClick={() => onApprove(row)}
                            style={{
                              color: '#065f46',
                              borderColor: '#a7f3d0',
                            }}>
                            ✓ Approve
                          </button>
                        ) : null}
                        {row.status !== 'REJECTED' ? (
                          <button
                            className="fs-icon-btn danger"
                            disabled={isActing}
                            onClick={() => openReject(row)}>
                            Reject
                          </button>
                        ) : null}
                        <button
                          className="fs-icon-btn"
                          disabled={isActing}
                          onClick={() => onDelete(row)}
                          style={{ color: '#6b7280' }}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Reject reason drawer — reusing the flash-sales drawer styles */}
      {rejectFor ? (
        <>
          <div
            className="fs-drawer-backdrop"
            onClick={() => setRejectFor(null)}
          />
          <aside className="fs-drawer" role="dialog" aria-label="Reject review">
            <div className="fs-drawer-header">
              <h2>Reject review</h2>
              <button
                className="fs-drawer-close"
                onClick={() => setRejectFor(null)}>
                ×
              </button>
            </div>
            <div className="fs-drawer-body">
              <div
                style={{
                  background: '#fafafa',
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 16,
                }}>
                <div
                  style={{
                    fontSize: 11,
                    color: '#6b7280',
                    fontWeight: 600,
                    marginBottom: 6,
                  }}>
                  REVIEW IN QUESTION
                </div>
                <Stars count={rejectFor.rating} />
                {rejectFor.title ? (
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#111827',
                      marginTop: 4,
                    }}>
                    {rejectFor.title}
                  </div>
                ) : null}
                <div
                  style={{
                    fontSize: 12,
                    color: '#374151',
                    marginTop: 6,
                    lineHeight: 1.5,
                  }}>
                  {rejectFor.body}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: '#6b7280',
                    marginTop: 8,
                  }}>
                  by {rejectFor.authorName} on{' '}
                  <em>{rejectFor.productTitle}</em>
                </div>
              </div>

              <div className="fs-field">
                <label>Reason (recorded in audit log)</label>
                <textarea
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  placeholder="e.g. Off-topic — review of a different product / Contains profanity / Spam"
                  style={{ minHeight: 100 }}
                  maxLength={500}
                />
                <div className="hint">
                  The reason is kept on the row for the audit trail. It
                  isn't shown to the customer today, but a future
                  notification flow may surface it.
                </div>
              </div>
            </div>
            <div className="fs-drawer-footer">
              <button
                className="fs-cancel"
                onClick={() => setRejectFor(null)}>
                Cancel
              </button>
              <button
                className="fs-submit"
                onClick={submitReject}
                disabled={acting === rejectFor.id}
                style={{ background: '#b91c1c' }}>
                {acting === rejectFor.id ? 'Rejecting…' : 'Reject review'}
              </button>
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}
