'use client';

/**
 * Seller approval queue.
 *
 * Lists every seller currently in verificationStatus=UNDER_REVIEW —
 * i.e. they've submitted onboarding and are waiting for an admin
 * decision. The admin reviewer reads the KYC details inline and
 * clicks Approve or Reject (rejection requires a reason).
 *
 * Endpoints used:
 *   GET  /admin/sellers?verificationStatus=UNDER_REVIEW         (list)
 *   GET  /admin/sellers/:sellerId                               (detail)
 *   POST /admin/sellers/:sellerId/approve  { notes? }           (approve)
 *   POST /admin/sellers/:sellerId/reject   { reason }           (reject)
 *
 * UX choices:
 *   - Two-column layout: left = list of pending sellers, right = the
 *     selected seller's KYC details + decision buttons. Reviewer can
 *     walk the queue without page reloads.
 *   - Reject opens an inline panel that captures the reason (min 10
 *     chars — matches the DTO validator). The reason is shown to the
 *     seller in their portal so they know what to fix.
 *   - Approve opens an inline notes box (optional) so the reviewer
 *     can leave context for finance/audit (e.g. "GST manually
 *     verified on portal").
 */

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

interface PendingSeller {
  sellerId: string;
  sellerName: string;
  sellerShopName: string;
  email: string;
  phoneNumber: string | null;
  status: string;
  verificationStatus: string;
  isEmailVerified: boolean;
  profileCompletionPercentage: number;
  createdAt: string;
  lastLoginAt: string | null;
}

interface SellerDetail extends PendingSeller {
  legalBusinessName?: string | null;
  gstin?: string | null;
  gstStateCode?: string | null;
  gstRegistrationType?: string | null;
  panNumber?: string | null;
  panLast4?: string | null;
  registeredBusinessAddressJson?: Record<string, unknown> | null;
  storeAddress?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  sellerZipCode?: string | null;
  shortStoreDescription?: string | null;
  detailedStoreDescription?: string | null;
  gstVerificationNotes?: string | null;
}

interface SellersResponse {
  sellers: PendingSeller[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const fmtDate = (d: string | null) =>
  d
    ? new Date(d).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';

const maskPan = (pan?: string | null) =>
  pan ? `${pan.slice(0, 3)}XXXX${pan.slice(-3)}` : '—';

export default function SellerApprovalsPage() {
  const [sellers, setSellers] = useState<PendingSeller[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SellerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [actionState, setActionState] = useState<
    | { mode: 'idle' }
    | { mode: 'approve'; submitting: boolean; notes: string }
    | { mode: 'reject'; submitting: boolean; reason: string; touched: boolean }
  >({ mode: 'idle' });

  const [banner, setBanner] = useState<
    { tone: 'success' | 'error'; message: string } | null
  >(null);

  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const res = await apiClient<SellersResponse>(
        '/admin/sellers?verificationStatus=UNDER_REVIEW&limit=50',
      );
      const data = (res?.data as SellersResponse) ?? res;
      setSellers(data.sellers ?? []);
      // Auto-select first row if nothing selected yet.
      if (!selectedId && data.sellers?.length) {
        setSelectedId(data.sellers[0].sellerId);
      }
    } catch (err) {
      setListError((err as Error).message || 'Failed to load pending sellers');
    } finally {
      setListLoading(false);
    }
  }, [selectedId]);

  const loadDetail = useCallback(async (sellerId: string) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await apiClient<SellerDetail>(`/admin/sellers/${sellerId}`);
      setDetail((res?.data as SellerDetail) ?? (res as unknown as SellerDetail));
    } catch (err) {
      setDetail(null);
      setBanner({
        tone: 'error',
        message: (err as Error).message || 'Failed to load seller detail',
      });
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const handleApprove = async () => {
    if (actionState.mode !== 'approve' || !selectedId) return;
    setActionState({ ...actionState, submitting: true });
    try {
      await apiClient(`/admin/sellers/${selectedId}/approve`, {
        method: 'POST',
        body: JSON.stringify({
          notes: actionState.notes.trim() || undefined,
        }),
      });
      setBanner({ tone: 'success', message: 'Seller approved and activated.' });
      setActionState({ mode: 'idle' });
      // Remove from queue + advance selection.
      setSellers((prev) => prev.filter((s) => s.sellerId !== selectedId));
      setSelectedId(null);
      setDetail(null);
      await loadList();
    } catch (err) {
      setActionState({ ...actionState, submitting: false });
      setBanner({
        tone: 'error',
        message: (err as Error).message || 'Approval failed',
      });
    }
  };

  const handleReject = async () => {
    if (actionState.mode !== 'reject' || !selectedId) return;
    if (actionState.reason.trim().length < 10) {
      setActionState({ ...actionState, touched: true });
      return;
    }
    setActionState({ ...actionState, submitting: true });
    try {
      await apiClient(`/admin/sellers/${selectedId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: actionState.reason.trim() }),
      });
      setBanner({
        tone: 'success',
        message: 'Seller rejected. They can re-submit after fixing the issue.',
      });
      setActionState({ mode: 'idle' });
      setSellers((prev) => prev.filter((s) => s.sellerId !== selectedId));
      setSelectedId(null);
      setDetail(null);
      await loadList();
    } catch (err) {
      setActionState({ ...actionState, submitting: false });
      setBanner({
        tone: 'error',
        message: (err as Error).message || 'Rejection failed',
      });
    }
  };

  return (
    <div className="seller-approval-page">
      <header className="seller-approval-page__header">
        <div>
          <h1>Seller approval queue</h1>
          <p className="seller-approval-page__subtitle">
            Sellers whose onboarding is in <strong>UNDER_REVIEW</strong>. Approve to
            activate the account or reject with a reason the seller will see.
          </p>
        </div>
        <button
          type="button"
          className="seller-approval-page__refresh"
          onClick={loadList}
          disabled={listLoading}
        >
          {listLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {banner && (
        <div
          role="alert"
          className={`seller-approval-page__banner seller-approval-page__banner--${banner.tone}`}
        >
          <span>{banner.message}</span>
          <button type="button" onClick={() => setBanner(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <div className="seller-approval-page__grid">
        {/* Left: list */}
        <aside className="seller-approval-page__list" aria-label="Pending sellers">
          {listLoading && <p className="seller-approval-page__hint">Loading…</p>}
          {!listLoading && listError && (
            <p className="seller-approval-page__hint seller-approval-page__hint--error">
              {listError}
            </p>
          )}
          {!listLoading && !listError && sellers.length === 0 && (
            <p className="seller-approval-page__hint">
              No sellers are waiting for approval right now.
            </p>
          )}
          {sellers.map((s) => (
            <button
              key={s.sellerId}
              type="button"
              className={`seller-approval-page__item ${
                selectedId === s.sellerId
                  ? 'seller-approval-page__item--active'
                  : ''
              }`}
              onClick={() => setSelectedId(s.sellerId)}
            >
              <div className="seller-approval-page__item-name">{s.sellerName}</div>
              <div className="seller-approval-page__item-shop">{s.sellerShopName}</div>
              <div className="seller-approval-page__item-meta">
                Submitted {fmtDate(s.createdAt)}
              </div>
            </button>
          ))}
        </aside>

        {/* Right: detail + action */}
        <section className="seller-approval-page__detail" aria-label="Seller details">
          {!selectedId && (
            <p className="seller-approval-page__hint">
              Select a seller from the list to review their KYC details.
            </p>
          )}
          {selectedId && detailLoading && (
            <p className="seller-approval-page__hint">Loading details…</p>
          )}
          {selectedId && !detailLoading && detail && (
            <>
              <h2 className="seller-approval-page__detail-name">
                {detail.sellerName}{' '}
                <span className="seller-approval-page__detail-shop">
                  ({detail.sellerShopName})
                </span>
              </h2>

              <dl className="seller-approval-page__kv">
                <div>
                  <dt>Contact email</dt>
                  <dd>
                    {detail.email}{' '}
                    {detail.isEmailVerified ? (
                      <span className="seller-approval-page__pill seller-approval-page__pill--success">
                        verified
                      </span>
                    ) : (
                      <span className="seller-approval-page__pill seller-approval-page__pill--warning">
                        unverified
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Phone</dt>
                  <dd>{detail.phoneNumber || '—'}</dd>
                </div>
                <div>
                  <dt>Legal business name</dt>
                  <dd>{detail.legalBusinessName || '—'}</dd>
                </div>
                <div>
                  <dt>GST registration type</dt>
                  <dd>{detail.gstRegistrationType || '—'}</dd>
                </div>
                <div>
                  <dt>GSTIN</dt>
                  <dd>{detail.gstin || '— (unregistered)'}</dd>
                </div>
                <div>
                  <dt>GST state code</dt>
                  <dd>{detail.gstStateCode || '—'}</dd>
                </div>
                <div>
                  <dt>PAN</dt>
                  <dd>
                    <code>{maskPan(detail.panNumber)}</code>{' '}
                    <small>(last 4: {detail.panLast4 || '—'})</small>
                  </dd>
                </div>
                <div>
                  <dt>Registered business address</dt>
                  <dd>
                    {detail.registeredBusinessAddressJson ? (
                      <pre className="seller-approval-page__json">
                        {JSON.stringify(
                          detail.registeredBusinessAddressJson,
                          null,
                          2,
                        )}
                      </pre>
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Store address</dt>
                  <dd>
                    {[detail.storeAddress, detail.city, detail.state, detail.country]
                      .filter(Boolean)
                      .join(', ')}{' '}
                    {detail.sellerZipCode && `— ${detail.sellerZipCode}`}
                  </dd>
                </div>
                {detail.shortStoreDescription && (
                  <div>
                    <dt>Short description</dt>
                    <dd>{detail.shortStoreDescription}</dd>
                  </div>
                )}
                {detail.gstVerificationNotes && (
                  <div>
                    <dt>Previous notes / rejection reason</dt>
                    <dd className="seller-approval-page__prev-notes">
                      {detail.gstVerificationNotes}
                    </dd>
                  </div>
                )}
              </dl>

              <div className="seller-approval-page__actions">
                {actionState.mode === 'idle' && (
                  <>
                    <button
                      type="button"
                      className="seller-approval-page__btn seller-approval-page__btn--approve"
                      onClick={() =>
                        setActionState({
                          mode: 'approve',
                          submitting: false,
                          notes: '',
                        })
                      }
                    >
                      Approve seller
                    </button>
                    <button
                      type="button"
                      className="seller-approval-page__btn seller-approval-page__btn--reject"
                      onClick={() =>
                        setActionState({
                          mode: 'reject',
                          submitting: false,
                          reason: '',
                          touched: false,
                        })
                      }
                    >
                      Reject submission
                    </button>
                  </>
                )}

                {actionState.mode === 'approve' && (
                  <form
                    className="seller-approval-page__form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleApprove();
                    }}
                  >
                    <label htmlFor="approve-notes">
                      Internal notes <small>(optional)</small>
                    </label>
                    <textarea
                      id="approve-notes"
                      rows={3}
                      value={actionState.notes}
                      onChange={(e) =>
                        setActionState({
                          ...actionState,
                          notes: e.target.value,
                        })
                      }
                      placeholder="e.g. GSTIN manually checked on GSTN portal"
                      maxLength={1000}
                    />
                    <div className="seller-approval-page__form-row">
                      <button
                        type="submit"
                        className="seller-approval-page__btn seller-approval-page__btn--approve"
                        disabled={actionState.submitting}
                      >
                        {actionState.submitting
                          ? 'Approving…'
                          : 'Confirm approval'}
                      </button>
                      <button
                        type="button"
                        className="seller-approval-page__btn seller-approval-page__btn--ghost"
                        onClick={() => setActionState({ mode: 'idle' })}
                        disabled={actionState.submitting}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                {actionState.mode === 'reject' && (
                  <form
                    className="seller-approval-page__form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleReject();
                    }}
                  >
                    <label htmlFor="reject-reason">
                      Rejection reason <span aria-hidden="true">*</span>
                    </label>
                    <textarea
                      id="reject-reason"
                      rows={4}
                      value={actionState.reason}
                      onChange={(e) =>
                        setActionState({
                          ...actionState,
                          reason: e.target.value,
                          touched: true,
                        })
                      }
                      placeholder="Explain what the seller needs to fix. They will see this exactly as written."
                      maxLength={1000}
                      required
                      minLength={10}
                    />
                    {actionState.touched &&
                      actionState.reason.trim().length < 10 && (
                        <p className="seller-approval-page__field-error">
                          Reason must be at least 10 characters so the seller
                          understands the issue.
                        </p>
                      )}
                    <div className="seller-approval-page__form-row">
                      <button
                        type="submit"
                        className="seller-approval-page__btn seller-approval-page__btn--reject"
                        disabled={
                          actionState.submitting ||
                          actionState.reason.trim().length < 10
                        }
                      >
                        {actionState.submitting
                          ? 'Rejecting…'
                          : 'Confirm rejection'}
                      </button>
                      <button
                        type="button"
                        className="seller-approval-page__btn seller-approval-page__btn--ghost"
                        onClick={() => setActionState({ mode: 'idle' })}
                        disabled={actionState.submitting}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <style jsx>{`
        .seller-approval-page {
          padding: 24px;
          font-family: inherit;
        }
        .seller-approval-page__header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          margin-bottom: 16px;
        }
        .seller-approval-page__header h1 {
          margin: 0 0 4px;
          font-size: 22px;
        }
        .seller-approval-page__subtitle {
          margin: 0;
          color: #666;
          font-size: 13px;
        }
        .seller-approval-page__refresh {
          padding: 8px 14px;
          border-radius: 6px;
          border: 1px solid #d0d7de;
          background: #fff;
          cursor: pointer;
          font-size: 13px;
        }
        .seller-approval-page__refresh:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .seller-approval-page__banner {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 14px;
          border-radius: 6px;
          margin-bottom: 16px;
          font-size: 13px;
        }
        .seller-approval-page__banner--success {
          background: #e8f5e9;
          color: #2e7d32;
        }
        .seller-approval-page__banner--error {
          background: #ffebee;
          color: #c62828;
        }
        .seller-approval-page__banner button {
          background: transparent;
          border: none;
          font-size: 20px;
          cursor: pointer;
          line-height: 1;
          padding: 0 4px;
          color: inherit;
        }
        .seller-approval-page__grid {
          display: grid;
          grid-template-columns: 320px 1fr;
          gap: 16px;
        }
        @media (max-width: 900px) {
          .seller-approval-page__grid {
            grid-template-columns: 1fr;
          }
        }
        .seller-approval-page__list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 70vh;
          overflow-y: auto;
        }
        .seller-approval-page__hint {
          color: #666;
          font-size: 13px;
          margin: 8px 0;
        }
        .seller-approval-page__hint--error {
          color: #c62828;
        }
        .seller-approval-page__item {
          text-align: left;
          background: #fff;
          border: 1px solid #d0d7de;
          border-radius: 8px;
          padding: 12px 14px;
          cursor: pointer;
          transition: border-color 0.15s, background 0.15s;
        }
        .seller-approval-page__item:hover {
          border-color: #999;
        }
        .seller-approval-page__item--active {
          border-color: #1565c0;
          background: #e3f2fd;
        }
        .seller-approval-page__item-name {
          font-weight: 600;
          font-size: 14px;
        }
        .seller-approval-page__item-shop {
          color: #555;
          font-size: 13px;
        }
        .seller-approval-page__item-meta {
          color: #888;
          font-size: 12px;
          margin-top: 4px;
        }
        .seller-approval-page__detail {
          background: #fff;
          border: 1px solid #d0d7de;
          border-radius: 8px;
          padding: 20px 24px;
        }
        .seller-approval-page__detail-name {
          margin: 0 0 16px;
          font-size: 18px;
        }
        .seller-approval-page__detail-shop {
          color: #666;
          font-weight: normal;
          font-size: 14px;
        }
        .seller-approval-page__kv {
          display: grid;
          grid-template-columns: 1fr;
          gap: 10px;
          margin: 0 0 24px;
        }
        .seller-approval-page__kv > div {
          display: grid;
          grid-template-columns: 220px 1fr;
          gap: 12px;
          font-size: 13px;
        }
        .seller-approval-page__kv dt {
          color: #666;
          margin: 0;
        }
        .seller-approval-page__kv dd {
          margin: 0;
        }
        .seller-approval-page__pill {
          display: inline-block;
          padding: 1px 8px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 600;
        }
        .seller-approval-page__pill--success {
          background: #e8f5e9;
          color: #2e7d32;
        }
        .seller-approval-page__pill--warning {
          background: #fff3e0;
          color: #ef6c00;
        }
        .seller-approval-page__json {
          background: #f6f8fa;
          padding: 8px 10px;
          border-radius: 4px;
          font-size: 12px;
          margin: 0;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .seller-approval-page__prev-notes {
          background: #fff8e1;
          padding: 8px 10px;
          border-radius: 4px;
          font-size: 13px;
        }
        .seller-approval-page__actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }
        .seller-approval-page__btn {
          padding: 10px 18px;
          border-radius: 6px;
          border: none;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
        }
        .seller-approval-page__btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .seller-approval-page__btn--approve {
          background: #2e7d32;
          color: #fff;
        }
        .seller-approval-page__btn--reject {
          background: #c62828;
          color: #fff;
        }
        .seller-approval-page__btn--ghost {
          background: #fff;
          border: 1px solid #d0d7de;
          color: #333;
        }
        .seller-approval-page__form {
          flex: 1 1 100%;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .seller-approval-page__form label {
          font-size: 13px;
          font-weight: 600;
        }
        .seller-approval-page__form textarea {
          width: 100%;
          font-family: inherit;
          font-size: 13px;
          padding: 8px;
          border: 1px solid #d0d7de;
          border-radius: 6px;
          resize: vertical;
        }
        .seller-approval-page__form-row {
          display: flex;
          gap: 10px;
          margin-top: 6px;
        }
        .seller-approval-page__field-error {
          color: #c62828;
          font-size: 12px;
          margin: 0;
        }
      `}</style>
    </div>
  );
}
