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

export default function RejectProcurementModal({ request, onClose, onSuccess }: Props) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const trimmed = reason.trim();
  const canSubmit = trimmed.length >= 5 && trimmed.length <= 500;

  const handleSubmit = async () => {
    if (!canSubmit) {
      setError('Reason must be between 5 and 500 characters.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await adminProcurementService.reject(request.id, trimmed);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reject request');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ color: 'var(--color-error)' }}>Reject Procurement Request</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="modal-warning" style={{ background: 'var(--color-error-bg)', color: 'var(--color-error)', borderColor: '#fecaca' }}>
            <strong>Warning:</strong> Rejecting this request will mark all items as rejected. The franchise will be notified. This action cannot be undone.
          </div>

          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
            Request: <strong style={{ color: 'var(--color-text)' }}>{request.requestNumber}</strong>
            {request.franchise && (
              <>
                {' '}&middot; Franchise:{' '}
                <strong style={{ color: 'var(--color-text)' }}>{request.franchise.businessName}</strong>
              </>
            )}
          </div>

          {error && <div className="modal-alert modal-alert-error">{error}</div>}

          <div className="modal-form-group">
            <label>Rejection Reason *</label>
            <textarea
              placeholder="Provide a clear reason for rejecting this request (5-500 characters)..."
              value={reason}
              onChange={e => setReason(e.target.value)}
              maxLength={500}
            />
            <div className="char-count">{trimmed.length}/500</div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            className="modal-btn modal-btn-danger"
            onClick={handleSubmit}
            disabled={submitting || !canSubmit}
          >
            {submitting ? 'Rejecting...' : 'Reject Request'}
          </button>
        </div>
      </div>
    </div>
  );
}
