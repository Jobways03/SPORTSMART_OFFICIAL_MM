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

const VERIFICATION_OPTIONS = ['NOT_VERIFIED', 'VERIFIED', 'REJECTED', 'UNDER_REVIEW'];

function formatStatus(s: string) {
  return s.replace(/_/g, ' ');
}

export default function VerificationModal({ seller, onClose, onSuccess }: Props) {
  const [newVerification, setNewVerification] = useState(
    VERIFICATION_OPTIONS.find(v => v !== seller.verificationStatus) || 'VERIFIED'
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      await adminSellersService.updateVerification(seller.sellerId, newVerification, reason || undefined);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update verification');
    } finally {
      setSubmitting(false);
    }
  };

  const initials = seller.sellerName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Update Verification</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="modal-seller-info">
            <div className="seller-avatar">{initials}</div>
            <div className="seller-details">
              <div className="name">{seller.sellerName}</div>
              <div className="email">{seller.email}</div>
            </div>
          </div>

          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
            Current: <strong style={{ color: 'var(--color-text)' }}>{formatStatus(seller.verificationStatus)}</strong>
          </div>

          {error && <div className="modal-alert modal-alert-error">{error}</div>}

          <div className="modal-form-group">
            <label>Verification Status *</label>
            <select value={newVerification} onChange={e => setNewVerification(e.target.value)}>
              {VERIFICATION_OPTIONS.filter(v => v !== seller.verificationStatus).map(s => (
                <option key={s} value={s}>{formatStatus(s)}</option>
              ))}
            </select>
          </div>

          <div className="modal-form-group">
            <label>Reason (optional)</label>
            <textarea
              placeholder="Provide a reason..."
              value={reason}
              onChange={e => setReason(e.target.value)}
              maxLength={500}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="modal-btn modal-btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Updating...' : 'Update Verification'}
          </button>
        </div>
      </div>
    </div>
  );
}
