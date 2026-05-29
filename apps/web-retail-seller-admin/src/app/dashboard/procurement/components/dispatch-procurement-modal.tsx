'use client';

import { useState } from 'react';
import { adminProcurementService, ProcurementDetail } from '@/services/admin-procurement.service';
import { ApiError } from '@/lib/api-client';
import '../../sellers/components/modal.css';

interface Props {
  request: ProcurementDetail;
  onClose: () => void;
  onSuccess: () => void;
}

export default function DispatchProcurementModal({ request, onClose, onSuccess }: Props) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      await adminProcurementService.dispatch(request.id);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to mark as dispatched');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Mark as Dispatched</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
            Request: <strong style={{ color: 'var(--color-text)' }}>{request.requestNumber}</strong>
            {request.franchise && (
              <>
                {' '}&middot; Franchise:{' '}
                <strong style={{ color: 'var(--color-text)' }}>{request.franchise.businessName}</strong>
              </>
            )}
          </div>

          <p style={{ fontSize: 14, color: 'var(--color-text)', lineHeight: 1.5, marginBottom: 16 }}>
            Are you sure you want to mark this procurement as <strong>dispatched</strong>? This will notify the franchise that goods are on the way.
          </p>

          {error && <div className="modal-alert modal-alert-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            className="modal-btn modal-btn-primary"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? 'Updating...' : 'Confirm Dispatch'}
          </button>
        </div>
      </div>
    </div>
  );
}
