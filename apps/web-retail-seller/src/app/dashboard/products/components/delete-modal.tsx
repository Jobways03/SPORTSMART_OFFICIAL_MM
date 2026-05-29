'use client';

import { useState } from 'react';
import { sellerProductService, ProductListItem } from '@/services/product.service';
import { ApiError } from '@/lib/api-client';
import './modal.css';

interface DeleteModalProps {
  product: ProductListItem;
  onClose: () => void;
  onSuccess: () => void;
}

export default function DeleteProductModal({ product, onClose, onSuccess }: DeleteModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    setLoading(true);
    setError('');
    try {
      const token = sessionStorage.getItem('accessToken') || '';
      await sellerProductService.deleteProduct(token, product.id);
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
          <h2>Delete Product</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="modal-body">
          {error && (
            <div className="modal-alert error">{error}</div>
          )}
          <p style={{ fontSize: 14, color: 'var(--color-text)' }}>
            Are you sure you want to delete <strong>&lsquo;{product.title}&rsquo;</strong>?
          </p>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 8 }}>
            This action cannot be undone.
          </p>
        </div>

        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button className="modal-btn danger" onClick={handleDelete} disabled={loading}>
            {loading ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
