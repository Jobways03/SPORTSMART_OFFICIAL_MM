'use client';

import { useState } from 'react';
import { adminFranchisesService } from '@/services/admin-franchises.service';
import { ApiError } from '@/lib/api-client';
import '../../sellers/components/modal.css';

interface Props {
  franchiseId: string;
  businessName: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreatePenaltyModal({ franchiseId, businessName, onClose, onSuccess }: Props) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const parsedAmount = parseFloat(amount);
  const amountValid = !isNaN(parsedAmount) && parsedAmount > 0 && amount.trim() !== '';

  const handleSubmit = async () => {
    if (!amountValid || !reason.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await adminFranchisesService.createPenalty(franchiseId, parsedAmount, reason.trim());
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create penalty');
    } finally {
      setSubmitting(false);
    }
  };

  const initials = businessName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Create Penalty</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="modal-seller-info">
            <div className="seller-avatar">{initials}</div>
            <div className="seller-details">
              <div className="name">{businessName}</div>
            </div>
          </div>

          <div className="modal-warning">
            This will deduct from the franchise earnings.
          </div>

          {error && <div className="modal-alert modal-alert-error">{error}</div>}

          <div className="modal-form-group">
            <label>Amount *</label>
            <input
              type="number"
              placeholder="Enter penalty amount"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              min="0.01"
              step="0.01"
            />
          </div>

          <div className="modal-form-group">
            <label>Reason *</label>
            <textarea
              placeholder="Reason for this penalty..."
              value={reason}
              onChange={e => setReason(e.target.value)}
              maxLength={500}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            className="modal-btn modal-btn-danger"
            onClick={handleSubmit}
            disabled={submitting || !amountValid || !reason.trim()}
          >
            {submitting ? 'Creating...' : 'Create Penalty'}
          </button>
        </div>
      </div>
    </div>
  );
}
