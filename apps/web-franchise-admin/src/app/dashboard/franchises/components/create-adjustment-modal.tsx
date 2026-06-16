'use client';

import { useState } from 'react';
import { adminFranchisesService } from '@/services/admin-franchises.service';
import { ApiError } from '@/lib/api-client';
import { validateAmount } from '@/lib/validators';
import '../../sellers/components/modal.css';

interface Props {
  franchiseId: string;
  businessName: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateAdjustmentModal({ franchiseId, businessName, onClose, onSuccess }: Props) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const parsedAmount = parseFloat(amount);
  const amountValid = !isNaN(parsedAmount) && amount.trim() !== '';

  const handleSubmit = async () => {
    if (!reason.trim()) return;
    // Signed adjustment: a manual ledger entry may be positive or negative,
    // so allow the full signed range (a zero entry is a no-op and rejected).
    const amountError = validateAmount(amount, {
      min: -10_000_000,
      max: 10_000_000,
      label: 'Adjustment amount',
    });
    if (amountError) {
      setError(amountError);
      return;
    }
    if (parsedAmount === 0) {
      setError('Adjustment amount cannot be zero');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await adminFranchisesService.createAdjustment(franchiseId, parsedAmount, reason.trim());
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create adjustment');
    } finally {
      setSubmitting(false);
    }
  };

  const initials = businessName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Create Adjustment</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="modal-seller-info">
            <div className="seller-avatar">{initials}</div>
            <div className="seller-details">
              <div className="name">{businessName}</div>
            </div>
          </div>

          <div className="modal-alert modal-alert-success" style={{ marginBottom: 16 }}>
            Create a manual adjustment entry in the franchise finance ledger.
          </div>

          {error && <div className="modal-alert modal-alert-error">{error}</div>}

          <div className="modal-form-group">
            <label>Amount *</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="Enter amount (positive or negative)"
              value={amount}
              onChange={e =>
                setAmount(
                  // Signed money: allow an optional leading minus, digits and a
                  // single decimal point (a negative adjustment is legitimate).
                  e.target.value
                    .replace(/[^0-9.-]/g, '')
                    .replace(/(?!^)-/g, '')
                    .replace(/(\..*)\./g, '$1'),
                )
              }
            />
          </div>

          <div className="modal-form-group">
            <label>Reason *</label>
            <textarea
              placeholder="Reason for this adjustment..."
              value={reason}
              onChange={e => setReason(e.target.value)}
              maxLength={500}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            className="modal-btn modal-btn-primary"
            onClick={handleSubmit}
            disabled={submitting || !amountValid || !reason.trim()}
          >
            {submitting ? 'Creating...' : 'Create Adjustment'}
          </button>
        </div>
      </div>
    </div>
  );
}
