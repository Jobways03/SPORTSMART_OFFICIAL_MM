'use client';

import { useState } from 'react';
import { adminProductsService } from '@/services/admin-products.service';
import { ApiError } from '@/lib/api-client';
import { validateText } from '@/lib/validators';
import './modal.css';

// Minimal structural shape — callers pass either a ProductListItem (list page)
// or a ProductDetail (edit page); the modal only reads id/title/seller.
interface Props {
  product: { id: string; title: string; seller?: { sellerShopName?: string | null } | null };
  onClose: () => void;
  onSuccess: () => void;
}

const MIN_REASON = 10;

export default function RejectModal({ product, onClose, onSuccess }: Props) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Backend requires >= 10 chars; gate the button so the admin sees the
  // requirement up front instead of a round-trip 400.
  const canSubmit = reason.trim().length >= MIN_REASON;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const reasonError = validateText(reason, {
      min: 5,
      max: 1000,
      label: 'Reason',
    });
    if (reasonError) {
      setError(reasonError);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await adminProductsService.rejectProduct(product.id, reason.trim());
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reject product');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ color: 'var(--color-error)' }}>Reject Product</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="modal-product-info">
            <div className="product-icon">&#128230;</div>
            <div className="product-details">
              <div className="name">{product.title}</div>
              <div className="seller">{product.seller?.sellerShopName || 'Unknown seller'}</div>
            </div>
          </div>

          {error && <div className="modal-alert modal-alert-error">{error}</div>}

          <div className="modal-form-group">
            <label>Reason for rejection <span style={{ color: 'var(--color-error)' }}>*</span></label>
            <textarea
              placeholder="Explain why this product is being rejected..."
              value={reason}
              onChange={e => setReason(e.target.value)}
              maxLength={1000}
            />
            <div className="char-count">
              {reason.trim().length < MIN_REASON
                ? `Minimum ${MIN_REASON} characters (${reason.trim().length}/${MIN_REASON})`
                : `${reason.length}/1000`}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            className="modal-btn modal-btn-danger"
            onClick={handleSubmit}
            disabled={submitting || !canSubmit}
          >
            {submitting ? 'Rejecting...' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}
