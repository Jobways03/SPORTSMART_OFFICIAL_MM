'use client';

import { useState } from 'react';
import {
  adminProcurementService,
  ProcurementDetail,
  formatCurrency,
} from '@/services/admin-procurement.service';
import { ApiError } from '@/lib/api-client';
import '../../sellers/components/modal.css';

interface Props {
  request: ProcurementDetail;
  onClose: () => void;
  onSuccess: () => void;
}

export default function SettleProcurementModal({ request, onClose, onSuccess }: Props) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      await adminProcurementService.settle(request.id);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to settle request');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settle Procurement</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
            Request: <strong style={{ color: 'var(--color-text)' }}>{request.requestNumber}</strong>
            {request.franchise && (
              <>
                {' '}&middot; Franchise:{' '}
                <strong style={{ color: 'var(--color-text)' }}>{request.franchise.businessName}</strong>
              </>
            )}
          </div>

          <p style={{ fontSize: 14, color: 'var(--color-text)', lineHeight: 1.5, marginBottom: 16 }}>
            Mark this procurement as <strong>settled</strong>? Procurement fees will be recorded in the franchise finance ledger.
          </p>

          <div
            style={{
              padding: '12px 16px',
              background: 'var(--color-bg-page)',
              borderRadius: 'var(--radius)',
              marginBottom: 16,
              fontSize: 13,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: 'var(--color-text-secondary)' }}>Approved Total</span>
              <strong>{formatCurrency(request.totalApprovedAmount)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                Procurement Fee ({request.procurementFeeRate}%)
              </span>
              <strong>{formatCurrency(request.procurementFeeAmount)}</strong>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                paddingTop: 8,
                marginTop: 8,
                borderTop: '1px dashed #e5e7eb',
              }}
            >
              <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>Final Payable</span>
              <strong style={{ color: 'var(--color-primary)', fontSize: 15 }}>
                {formatCurrency(request.finalPayableAmount)}
              </strong>
            </div>
          </div>

          {error && <div className="modal-alert modal-alert-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            className="modal-btn modal-btn-primary"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? 'Settling...' : 'Confirm Settle'}
          </button>
        </div>
      </div>
    </div>
  );
}
