'use client';

import { useState } from 'react';
import { adminFranchisesService } from '@/services/admin-franchises.service';
import { ApiError } from '@/lib/api-client';
import '../../sellers/components/modal.css';

interface Props {
  franchiseId: string;
  businessName: string;
  email: string;
  currentOnlineFulfillmentRate: number | null;
  currentProcurementFeeRate: number | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function FranchiseCommissionModal({
  franchiseId,
  businessName,
  email,
  currentOnlineFulfillmentRate,
  currentProcurementFeeRate,
  onClose,
  onSuccess,
}: Props) {
  const [onlineRate, setOnlineRate] = useState<string>(
    currentOnlineFulfillmentRate != null ? String(currentOnlineFulfillmentRate) : '15',
  );
  const [procurementRate, setProcurementRate] = useState<string>(
    currentProcurementFeeRate != null ? String(currentProcurementFeeRate) : '5',
  );
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const validate = (): string | null => {
    const o = parseFloat(onlineRate);
    const p = parseFloat(procurementRate);
    if (isNaN(o) || isNaN(p)) return 'Rates must be valid numbers';
    if (o < 0 || o > 100) return 'Online fulfillment rate must be between 0 and 100';
    if (p < 0 || p > 100) return 'Procurement fee rate must be between 0 and 100';
    return null;
  };

  const handleSubmit = async () => {
    const vError = validate();
    if (vError) {
      setError(vError);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await adminFranchisesService.updateCommission(franchiseId, {
        onlineFulfillmentRate: parseFloat(onlineRate),
        procurementFeeRate: parseFloat(procurementRate),
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update commission');
    } finally {
      setSubmitting(false);
    }
  };

  const initials = businessName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Update Commission Rates</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="modal-seller-info">
            <div className="seller-avatar">{initials}</div>
            <div className="seller-details">
              <div className="name">{businessName}</div>
              <div className="email">{email}</div>
            </div>
          </div>

          {error && <div className="modal-alert modal-alert-error">{error}</div>}

          <div className="modal-form-group">
            <label>Online Fulfillment Rate (%) *</label>
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={onlineRate}
              onChange={e => setOnlineRate(e.target.value)}
              placeholder="15"
            />
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>
              Default: 15%. Applied to online-fulfilled orders.
            </div>
          </div>

          <div className="modal-form-group">
            <label>Procurement Fee Rate (%) *</label>
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={procurementRate}
              onChange={e => setProcurementRate(e.target.value)}
              placeholder="5"
            />
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>
              Default: 5%. Applied to procurement transactions.
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            className="modal-btn modal-btn-primary"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? 'Updating...' : 'Update Commission'}
          </button>
        </div>
      </div>
    </div>
  );
}
