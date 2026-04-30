'use client';

import { useState } from 'react';
import { FranchiseListItem, adminFranchisesService } from '@/services/admin-franchises.service';
import { ApiError } from '@/lib/api-client';
import '../../sellers/components/modal.css';

interface Props {
  franchise: FranchiseListItem;
  onClose: () => void;
  onSuccess: () => void;
}

export default function DeleteFranchiseModal({ franchise, onClose, onSuccess }: Props) {
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const confirmRequired = 'DELETE';
  const canSubmit = confirmText === confirmRequired;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      await adminFranchisesService.deleteFranchise(franchise.id, reason || undefined);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete franchise');
    } finally {
      setSubmitting(false);
    }
  };

  const initials = franchise.ownerName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ color: 'var(--color-error)' }}>Delete Franchise</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="modal-seller-info">
            <div className="seller-avatar">{initials}</div>
            <div className="seller-details">
              <div className="name">{franchise.ownerName}</div>
              <div className="email">{franchise.email}</div>
            </div>
          </div>

          <div className="modal-warning" style={{ background: 'var(--color-error-bg)', color: 'var(--color-error)', borderColor: '#fecaca' }}>
            <strong>Warning:</strong> This action cannot be undone. The franchise account will be deactivated and all sessions will be revoked.
          </div>

          {error && <div className="modal-alert modal-alert-error">{error}</div>}

          <div className="modal-form-group">
            <label>Reason</label>
            <textarea
              placeholder="Why is this franchise being deleted?"
              value={reason}
              onChange={e => setReason(e.target.value)}
              maxLength={500}
            />
          </div>

          <div className="modal-form-group">
            <label>Type <strong>DELETE</strong> to confirm</label>
            <input
              type="text"
              placeholder="Type DELETE to confirm"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            className="modal-btn modal-btn-danger"
            onClick={handleSubmit}
            disabled={submitting || !canSubmit}
          >
            {submitting ? 'Deleting...' : 'Delete Franchise'}
          </button>
        </div>
      </div>
    </div>
  );
}
