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

const VERIF_BADGE: Record<string, { bg: string; color: string; dot: string }> = {
  UNDER_REVIEW: { bg: '#fef3c7', color: '#92400e', dot: '#f59e0b' },
  VERIFIED: { bg: '#dcfce7', color: '#166534', dot: '#22c55e' },
  REJECTED: { bg: '#fee2e2', color: '#991b1b', dot: '#ef4444' },
  NOT_VERIFIED: { bg: '#f1f5f9', color: '#475569', dot: '#94a3b8' },
};

const CheckIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const XIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

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

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0 16px' }}>
            <span style={{ fontSize: 13, color: '#6b7280' }}>Current verification</span>
            {(() => {
              const b = VERIF_BADGE[seller.verificationStatus] ?? VERIF_BADGE.NOT_VERIFIED;
              return (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.03em',
                    padding: '4px 10px',
                    borderRadius: 999,
                    background: b.bg,
                    color: b.color,
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: b.dot }} />
                  {seller.verificationStatus.replace(/_/g, ' ')}
                </span>
              );
            })()}
          </div>

          {/* Submitted KYC — review before approving. */}
          <div
            style={{
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 10,
              overflow: 'hidden',
              marginBottom: 16,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '10px 14px',
                background: '#f9fafb',
                borderBottom: '1px solid #f1f5f9',
                fontSize: 11,
                fontWeight: 700,
                color: '#6b7280',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M16 13H8" />
                <path d="M16 17H8" />
              </svg>
              Submitted KYC
            </div>
            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: '10px 16px',
                margin: 0,
                padding: 14,
                fontSize: 13,
              }}
            >
              <dt style={{ color: '#6b7280' }}>Legal business name</dt>
              <dd style={{ margin: 0, color: '#111827', fontWeight: 600 }}>
                {seller.legalBusinessName || '—'}
              </dd>
              <dt style={{ color: '#6b7280' }}>GSTIN</dt>
              <dd style={{ margin: 0, color: '#111827', fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>
                {seller.gstin || '— (not submitted)'}
              </dd>
              <dt style={{ color: '#6b7280' }}>GST state code</dt>
              <dd style={{ margin: 0, color: '#111827', fontWeight: 600 }}>{seller.gstStateCode || '—'}</dd>
              <dt style={{ color: '#6b7280' }}>PAN (last 4)</dt>
              <dd style={{ margin: 0, color: '#111827', fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>
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

          <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 16 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#6b7280',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                marginBottom: 12,
              }}
            >
              Your decision
            </div>

            <div className="modal-form-group">
              <label>
                Approval notes{' '}
                <span style={{ fontWeight: 400, color: '#9ca3af' }}>· optional, internal</span>
              </label>
              <textarea
                placeholder="Internal note recorded on the approval audit log…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={1000}
              />
            </div>

            <div className="modal-form-group" style={{ marginBottom: 0 }}>
              <label>
                Rejection reason{' '}
                <span style={{ fontWeight: 400, color: '#dc2626' }}>· required to reject</span>
              </label>
              <textarea
                placeholder="Explain what the seller must fix…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={1000}
                style={reason ? { borderColor: '#fca5a5' } : undefined}
              />
              <div
                style={{
                  fontSize: 12,
                  color: '#9ca3af',
                  marginTop: 5,
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>Shown to the seller · min 10 characters</span>
                <span>{reason.length}/1000</span>
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="modal-btn modal-btn-danger"
            onClick={handleReject}
            disabled={submitting}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}
          >
            <XIcon />
            {submitting ? '…' : 'Reject KYC'}
          </button>
          <button
            className="modal-btn modal-btn-primary"
            onClick={handleApprove}
            disabled={submitting}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}
          >
            <CheckIcon />
            {submitting ? '…' : 'Approve & Verify'}
          </button>
        </div>
      </div>
    </div>
  );
}
