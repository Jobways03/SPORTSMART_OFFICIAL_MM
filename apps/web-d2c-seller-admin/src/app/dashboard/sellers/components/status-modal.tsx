'use client';

import { useState } from 'react';
import { SellerListItem, adminSellersService } from '@/services/admin-sellers.service';
import { ApiError } from '@/lib/api-client';
import './modal.css';

interface Props {
  seller: SellerListItem;
  onClose: () => void;
  onSuccess: () => void;
}

const TRANSITIONS: Record<string, string[]> = {
  PENDING_APPROVAL: ['ACTIVE', 'DEACTIVATED'],
  ACTIVE: ['INACTIVE', 'SUSPENDED', 'DEACTIVATED'],
  INACTIVE: ['ACTIVE', 'DEACTIVATED'],
  SUSPENDED: ['ACTIVE', 'DEACTIVATED'],
  DEACTIVATED: ['ACTIVE'],
};

function formatStatus(s: string) {
  return s.replace(/_/g, ' ');
}

export default function StatusModal({ seller, onClose, onSuccess }: Props) {
  const allowed = TRANSITIONS[seller.status] || [];
  const [newStatus, setNewStatus] = useState(allowed[0] || '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!newStatus) return;
    setSubmitting(true);
    setError('');
    try {
      await adminSellersService.updateStatus(seller.sellerId, newStatus, reason || undefined);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update status');
    } finally {
      setSubmitting(false);
    }
  };

  const initials = seller.sellerName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Change Seller Status</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="modal-seller-info">
            <div className="seller-avatar">{initials}</div>
            <div className="seller-details">
              <div className="name">{seller.sellerName}</div>
              <div className="email">{seller.email}</div>
            </div>
          </div>

          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
            Current status: <strong style={{ color: 'var(--color-text)' }}>{formatStatus(seller.status)}</strong>
          </div>

          {error && <div className="modal-alert modal-alert-error">{error}</div>}

          <div className="modal-form-group">
            <label>New Status *</label>
            <select value={newStatus} onChange={e => setNewStatus(e.target.value)}>
              {allowed.map(s => (
                <option key={s} value={s}>{formatStatus(s)}</option>
              ))}
            </select>
          </div>

          <div className="modal-form-group">
            <label>Reason (optional)</label>
            <textarea
              placeholder="Provide a reason for this change..."
              value={reason}
              onChange={e => setReason(e.target.value)}
              maxLength={500}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="modal-btn modal-btn-primary" onClick={handleSubmit} disabled={submitting || !newStatus}>
            {submitting ? 'Updating...' : 'Update Status'}
          </button>
        </div>
      </div>
    </div>
  );
}
