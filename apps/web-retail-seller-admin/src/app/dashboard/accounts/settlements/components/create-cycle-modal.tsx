'use client';

import { useState } from 'react';
import { adminAccountsService } from '@/services/admin-accounts.service';
import { ApiError } from '@/lib/api-client';
import { validateDateRange } from '@/lib/validators';
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
  const [preview, setPreview] = useState<any | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const validate = (): boolean => {
    if (!periodStart || !periodEnd) {
      setError('Please provide both period start and period end dates.');
      return false;
    }
    const rangeError = validateDateRange(periodStart, periodEnd, { allowEqual: true });
    if (rangeError) {
      setError('Period start must be before or equal to period end.');
      return false;
    }
    return true;
  };

  const handlePreview = async () => {
    setError('');
    setPreview(null);
    if (!validate()) return;
    setPreviewing(true);
    try {
      const res = await adminAccountsService.previewCycle(periodStart, periodEnd);
      setPreview(res.data ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Preview failed.');
    } finally {
      setPreviewing(false);
    }
  };

  const handleSubmit = async () => {
    setError('');
    if (!validate()) return;
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

          {preview && (
            <div
              style={{
                marginTop: 12,
                padding: '10px 12px',
                background: '#ecfdf5',
                border: '1px solid #6ee7b7',
                borderRadius: 8,
                fontSize: 12,
                color: '#065f46',
                lineHeight: 1.5,
              }}
            >
              <strong>Dry-run preview</strong>
              <pre
                style={{
                  margin: '6px 0 0',
                  fontSize: 11,
                  fontFamily: 'ui-monospace, monospace',
                  whiteSpace: 'pre-wrap',
                  maxHeight: 240,
                  overflowY: 'auto',
                }}
              >
                {JSON.stringify(preview, null, 2)}
              </pre>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={submitting || previewing}>
            Cancel
          </button>
          <button
            className="modal-btn"
            onClick={handlePreview}
            disabled={previewing || submitting || !periodStart || !periodEnd}
          >
            {previewing ? 'Previewing…' : 'Preview'}
          </button>
          <button
            className="modal-btn modal-btn-primary"
            onClick={handleSubmit}
            disabled={submitting || previewing || !periodStart || !periodEnd}
          >
            {submitting ? 'Creating...' : 'Create Cycle'}
          </button>
        </div>
      </div>
    </div>
  );
}
