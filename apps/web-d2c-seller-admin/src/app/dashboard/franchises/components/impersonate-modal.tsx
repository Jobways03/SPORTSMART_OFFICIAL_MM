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

export default function ImpersonateModal({ franchise, onClose, onSuccess }: Props) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleImpersonate = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await adminFranchisesService.impersonateFranchise(franchise.id);
      if (res.data) {
        const franchisePortalUrl = process.env.NEXT_PUBLIC_FRANCHISE_URL || 'http://localhost:3005';
        const franchiseData = btoa(JSON.stringify({
          franchiseId: franchise.id,
          franchiseCode: franchise.franchiseCode,
          ownerName: franchise.ownerName,
          businessName: franchise.businessName,
          email: franchise.email,
          phoneNumber: franchise.phoneNumber,
        }));
        // Token + payload in URL fragment so they don't hit server logs or
        // cross-origin Referer headers. Receiver reads location.hash.
        window.open(
          `${franchisePortalUrl}/impersonate#token=${encodeURIComponent(res.data.accessToken)}&data=${encodeURIComponent(franchiseData)}`,
          '_blank',
        );
        onSuccess();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to impersonate franchise');
    } finally {
      setSubmitting(false);
    }
  };

  const initials = franchise.ownerName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Impersonate Franchise</h2>
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

          <div className="modal-alert modal-alert-success" style={{ marginBottom: 16 }}>
            You are about to open the franchise portal as <strong>{franchise.businessName}</strong>.
          </div>

          <div className="modal-warning">
            A 30-minute temporary session will be created. All actions will be logged.
          </div>

          {error && <div className="modal-alert modal-alert-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            className="modal-btn modal-btn-primary"
            onClick={handleImpersonate}
            disabled={submitting}
          >
            {submitting ? 'Generating token...' : 'Impersonate'}
          </button>
        </div>
      </div>
    </div>
  );
}
