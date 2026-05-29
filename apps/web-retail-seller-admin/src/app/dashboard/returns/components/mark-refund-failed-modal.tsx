'use client';

import { useState } from 'react';
import { adminReturnsService } from '@/services/admin-returns.service';
import { ApiError } from '@/lib/api-client';
import '../../sellers/components/modal.css';

interface Props {
  returnId: string;
  returnNumber: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function MarkRefundFailedModal({
  returnId,
  returnNumber,
  onClose,
  onSuccess,
}: Props) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const trimmed = reason.trim();
  const valid = trimmed.length >= 5 && trimmed.length <= 500;

  const handleSubmit = async () => {
    if (!valid) {
      setError('Reason must be between 5 and 500 characters');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await adminReturnsService.markRefundFailed(returnId, trimmed);
      onSuccess();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to mark refund as failed',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Mark Refund Failed</h2>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body">
          <div className="modal-warning">
            Mark the refund for return{' '}
            <strong>{returnNumber}</strong> as failed. You will be able to retry
            the refund afterwards.
          </div>

          {error && <div className="modal-alert modal-alert-error">{error}</div>}

          <div className="modal-form-group">
            <label>Failure Reason *</label>
            <textarea
              placeholder="Explain why the refund failed (5-500 chars)..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
            <div className="char-count">{reason.length}/500</div>
          </div>
        </div>
        <div className="modal-footer">
          <button
            className="modal-btn"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            className="modal-btn modal-btn-danger"
            onClick={handleSubmit}
            disabled={submitting || !valid}
          >
            {submitting ? 'Submitting...' : 'Mark Failed'}
          </button>
        </div>
      </div>
    </div>
  );
}
