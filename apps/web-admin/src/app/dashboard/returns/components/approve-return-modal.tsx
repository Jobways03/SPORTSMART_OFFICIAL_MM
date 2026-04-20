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

export default function ApproveReturnModal({
  returnId,
  returnNumber,
  onClose,
  onSuccess,
}: Props) {
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      await adminReturnsService.approveReturn(returnId, notes || undefined);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to approve return');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Approve Return</h2>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body">
          <div
            style={{
              fontSize: 13,
              color: 'var(--color-text-secondary)',
              marginBottom: 16,
            }}
          >
            You are approving return{' '}
            <strong style={{ color: 'var(--color-text)' }}>
              {returnNumber}
            </strong>
            . Once approved the customer can initiate pickup.
          </div>

          {error && <div className="modal-alert modal-alert-error">{error}</div>}

          <div className="modal-form-group">
            <label>Notes (optional)</label>
            <textarea
              placeholder="Add any internal notes about this approval..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
            />
            <div className="char-count">{notes.length}/500</div>
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
            className="modal-btn modal-btn-primary"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? 'Approving...' : 'Approve Return'}
          </button>
        </div>
      </div>
    </div>
  );
}
