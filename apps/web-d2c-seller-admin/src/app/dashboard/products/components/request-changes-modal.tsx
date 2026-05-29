'use client';

import { useState } from 'react';
import { ProductListItem, adminProductsService } from '@/services/admin-products.service';
import { ApiError } from '@/lib/api-client';
import './modal.css';

interface Props {
  product: ProductListItem;
  onClose: () => void;
  onSuccess: () => void;
}

export default function RequestChangesModal({ product, onClose, onSuccess }: Props) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = note.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      await adminProductsService.requestChanges(product.id, note.trim());
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to request changes');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Request Changes</h2>
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
            <label>Note for seller <span style={{ color: 'var(--color-error)' }}>*</span></label>
            <textarea
              placeholder="Describe what changes are needed..."
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={1000}
            />
            <div className="char-count">{note.length}/1000</div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            className="modal-btn modal-btn-primary"
            onClick={handleSubmit}
            disabled={submitting || !canSubmit}
          >
            {submitting ? 'Sending...' : 'Send Request'}
          </button>
        </div>
      </div>
    </div>
  );
}
