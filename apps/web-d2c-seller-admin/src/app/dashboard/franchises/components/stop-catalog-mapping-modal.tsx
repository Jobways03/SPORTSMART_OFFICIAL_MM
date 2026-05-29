'use client';

import { useState } from 'react';
import { adminFranchisesService, FranchiseCatalogMapping } from '@/services/admin-franchises.service';
import { ApiError } from '@/lib/api-client';
import '../../sellers/components/modal.css';

interface Props {
  mapping: FranchiseCatalogMapping;
  onClose: () => void;
  onSuccess: () => void;
}

export default function StopCatalogMappingModal({ mapping, onClose, onSuccess }: Props) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      await adminFranchisesService.stopCatalogMapping(mapping.id);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to stop mapping');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Stop Catalog Mapping</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          {error && <div className="modal-alert modal-alert-error">{error}</div>}

          <div className="modal-warning">
            This will stop the franchise from fulfilling this product. Orders already placed will
            not be affected.
          </div>

          <p style={{ fontSize: 14, color: 'var(--color-text)', marginBottom: 12 }}>
            Are you sure you want to stop the catalog mapping for:
          </p>
          <div
            style={{
              padding: 12,
              background: 'var(--color-bg-page)',
              borderRadius: 'var(--radius)',
              fontSize: 13,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {mapping.product?.title || 'Unknown product'}
            </div>
            {mapping.variant?.masterSku && (
              <div style={{ color: 'var(--color-text-secondary)' }}>
                SKU: {mapping.variant.masterSku}
              </div>
            )}
            <div style={{ color: 'var(--color-text-secondary)', marginTop: 4 }}>
              Current status: <strong>{mapping.approvalStatus}</strong>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            className="modal-btn modal-btn-danger"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? 'Stopping...' : 'Stop Mapping'}
          </button>
        </div>
      </div>
    </div>
  );
}
