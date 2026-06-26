'use client';

import { useState } from 'react';
import { franchiseReturnsService } from '@/services/franchise-returns.service';
import { ApiError } from '@/lib/api-client';
import '../../sellers/components/modal.css';

interface Props {
  returnId: string;
  franchiseId: string;
  returnNumber: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function MarkRefundFailedModal({
  returnId,
  franchiseId,
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
      await franchiseReturnsService.markRefundFailed(returnId, franchiseId, trimmed);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to mark refund as failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Mark Refund Failed</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="modal-warning">
            Marking the refund for <strong>{returnNumber}</strong> as failed records
            the failure reason and lets ops retry. Use only if the gateway/bank
            transfer genuinely failed.
          </div>
          {error && <div className="modal-alert modal-alert-error">{error}</div>}
          <div className="modal-form-group">
            <label>Reason *</label>
            <textarea
              placeholder="Why did the refund fail? (5-500 chars)..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
            <div className="char-count">{reason.length}/500</div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            className="modal-btn modal-btn-danger"
            onClick={handleSubmit}
            disabled={submitting || !valid}
          >
            {submitting ? 'Saving...' : 'Mark Failed'}
          </button>
        </div>
      </div>
    </div>
  );
}
