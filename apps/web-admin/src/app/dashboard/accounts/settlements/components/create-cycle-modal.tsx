'use client';

import { useState } from 'react';
import { adminAccountsService } from '@/services/admin-accounts.service';
import { ApiError } from '@/lib/api-client';
import '../../../sellers/components/modal.css';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateCycleModal({ onClose, onSuccess }: Props) {
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError('');
    if (!periodStart || !periodEnd) {
      setError('Please provide both period start and period end dates.');
      return;
    }
    if (new Date(periodStart) > new Date(periodEnd)) {
      setError('Period start must be before or equal to period end.');
      return;
    }
    setSubmitting(true);
    try {
      await adminAccountsService.createCycle(periodStart, periodEnd);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create settlement cycle.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Create Settlement Cycle</h2>
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
            A new unified settlement cycle will be created covering both seller and franchise
            payables within the selected period.
          </div>

          {error && <div className="modal-alert modal-alert-error">{error}</div>}

          <div className="modal-form-group">
            <label>Period Start *</label>
            <input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="modal-form-group">
            <label>Period End *</label>
            <input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="modal-btn modal-btn-primary"
            onClick={handleSubmit}
            disabled={submitting || !periodStart || !periodEnd}
          >
            {submitting ? 'Creating...' : 'Create Cycle'}
          </button>
        </div>
      </div>
    </div>
  );
}
