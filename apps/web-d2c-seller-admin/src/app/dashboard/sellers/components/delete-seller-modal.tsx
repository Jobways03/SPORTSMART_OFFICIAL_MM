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

export default function DeleteSellerModal({ seller, onClose, onSuccess }: Props) {
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const confirmRequired = 'DELETE';
  const canSubmit = confirmText === confirmRequired;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      await adminSellersService.deleteSeller(seller.sellerId, reason || undefined);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete seller');
    } finally {
      setSubmitting(false);
    }
  };

  const initials = seller.sellerName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ color: 'var(--color-error)' }}>Delete Seller</h2>
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

          <div className="modal-warning" style={{ background: 'var(--color-error-bg)', color: 'var(--color-error)', borderColor: '#fecaca' }}>
            <strong>Warning:</strong> This will soft-delete the seller, deactivate their account, and revoke all their sessions. This action cannot be easily undone.
          </div>

          {error && <div className="modal-alert modal-alert-error">{error}</div>}

          <div className="modal-form-group">
            <label>Reason (optional)</label>
            <textarea
              placeholder="Why is this seller being deleted?"
              value={reason}
              onChange={e => setReason(e.target.value)}
              maxLength={500}
            />
          </div>

          <div className="modal-form-group">
            <label>Type <strong>DELETE</strong> to confirm</label>
            <input
              type="text"
              placeholder="Type DELETE to confirm"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            className="modal-btn modal-btn-danger"
            onClick={handleSubmit}
            disabled={submitting || !canSubmit}
          >
            {submitting ? 'Deleting...' : 'Delete Seller'}
          </button>
        </div>
      </div>
    </div>
  );
}
