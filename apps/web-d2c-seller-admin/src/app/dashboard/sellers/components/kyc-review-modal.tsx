'use client';

import { useState } from 'react';
import { SellerListItem, adminSellersService } from '@/services/admin-sellers.service';
import { ApiError } from '@/lib/api-client';
import './modal.css';

interface Props {
  seller: SellerListItem;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * KYC review modal — the proper "verify a seller's onboarding" surface.
 *
 * Approve calls POST /admin/sellers/:id/approve (backend requires the seller
 * to have submitted GSTIN+PAN, then sets ACTIVE+VERIFIED). Reject calls
 * POST /admin/sellers/:id/reject with a reason the seller sees. This is
 * distinct from the raw VerificationModal override which can flip the status
 * without any KYC on file.
 */
export default function KycReviewModal({ seller, onClose, onSuccess }: Props) {
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const initials = seller.sellerName
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const isUnderReview = seller.verificationStatus === 'UNDER_REVIEW';

  const handleApprove = async () => {
    setSubmitting(true);
    setError('');
    try {
      await adminSellersService.approveKyc(seller.sellerId, notes.trim() || undefined);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to approve KYC');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (reason.trim().length < 10) {
      setError('Rejection reason must be at least 10 characters so the seller understands what to fix.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await adminSellersService.rejectKyc(seller.sellerId, reason.trim());
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reject KYC');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Verify KYC</h2>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body">
          <div className="modal-seller-info">
            <div className="seller-avatar">{initials}</div>
            <div className="seller-details">
              <div className="name">{seller.sellerName}</div>
              <div className="email">{seller.email}</div>
            </div>
          </div>

          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
            Current verification:{' '}
            <strong style={{ color: 'var(--color-text)' }}>
              {seller.verificationStatus.replace(/_/g, ' ')}
            </strong>
          </div>

          {/* Submitted KYC — review these before approving. */}
          <div
            style={{
              background: '#f9fafb',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              padding: '12px 14px',
              marginBottom: 14,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#6b7280',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                marginBottom: 8,
              }}
            >
              Submitted KYC
            </div>
            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: '6px 14px',
                margin: 0,
                fontSize: 13,
              }}
            >
              <dt style={{ color: '#6b7280' }}>Legal business name</dt>
              <dd style={{ margin: 0, color: '#111827', fontWeight: 500 }}>
                {seller.legalBusinessName || '—'}
              </dd>
              <dt style={{ color: '#6b7280' }}>GSTIN</dt>
              <dd style={{ margin: 0, color: '#111827', fontFamily: 'monospace' }}>
                {seller.gstin || '— (not submitted)'}
              </dd>
              <dt style={{ color: '#6b7280' }}>GST state code</dt>
              <dd style={{ margin: 0, color: '#111827' }}>{seller.gstStateCode || '—'}</dd>
              <dt style={{ color: '#6b7280' }}>PAN (last 4)</dt>
              <dd style={{ margin: 0, color: '#111827', fontFamily: 'monospace' }}>
                {seller.panLast4 ? `••••••${seller.panLast4}` : '—'}
              </dd>
            </dl>
          </div>

          {!isUnderReview && (
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                background: '#fef9c3',
                border: '1px solid #fde68a',
                color: '#854d0e',
                borderRadius: 8,
                padding: '10px 12px',
                marginBottom: 14,
              }}
            >
              This seller isn&apos;t awaiting review. KYC approval is meant for sellers in{' '}
              <strong>UNDER&nbsp;REVIEW</strong> (they&apos;ve submitted GSTIN/PAN via onboarding).
              Approving without a submitted GSTIN/PAN will be rejected by the server.
            </div>
          )}

          {error && <div className="modal-alert modal-alert-error">{error}</div>}

          <div className="modal-form-group">
            <label>Approval notes (optional)</label>
            <textarea
              placeholder="Internal note recorded on the approval audit log…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={1000}
            />
          </div>

          <div className="modal-form-group">
            <label>Rejection reason (required only to reject — min 10 characters)</label>
            <textarea
              placeholder="Explain what the seller must fix — this is shown to the seller…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="modal-btn"
            onClick={handleReject}
            disabled={submitting}
            style={{ background: '#dc2626', borderColor: '#dc2626', color: '#fff' }}
          >
            {submitting ? '…' : 'Reject KYC'}
          </button>
          <button className="modal-btn modal-btn-primary" onClick={handleApprove} disabled={submitting}>
            {submitting ? '…' : 'Approve & Verify'}
          </button>
        </div>
      </div>
    </div>
  );
}
