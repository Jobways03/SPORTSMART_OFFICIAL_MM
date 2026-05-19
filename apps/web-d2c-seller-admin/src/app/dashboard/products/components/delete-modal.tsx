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

export default function DeleteModal({ product, onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    setLoading(true);
    setError('');
    try {
      await adminProductsService.deleteProduct(product.id);
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || 'Failed to delete product.');
      } else {
        setError('Failed to delete product. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ color: 'var(--color-error)' }}>Delete Product</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-product-info">
            <div className="product-icon">&#128230;</div>
            <div className="product-details">
              <div className="name">{product.title}</div>
              <div className="seller">{product.seller?.sellerShopName || 'Unknown seller'}</div>
            </div>
          </div>

          {error && (
            <div className="modal-alert modal-alert-error">{error}</div>
          )}

          <div className="modal-warning" style={{ background: 'var(--color-error-bg)', color: 'var(--color-error)', borderColor: '#fecaca' }}>
            <strong>Warning:</strong> This will permanently delete this product and all associated variants, images, and data. This action cannot be undone.
          </div>

          <p style={{ fontSize: 14, color: 'var(--color-text)' }}>
            Are you sure you want to delete <strong>&lsquo;{product.title}&rsquo;</strong>?
          </p>
        </div>

        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button className="modal-btn modal-btn-danger" onClick={handleDelete} disabled={loading}>
            {loading ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
