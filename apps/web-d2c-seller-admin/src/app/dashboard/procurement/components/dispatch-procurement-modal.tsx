'use client';

import { useState } from 'react';
import { adminProcurementService, ProcurementDetail } from '@/services/admin-procurement.service';
import { ApiError } from '@/lib/api-client';
import '../../sellers/components/modal.css';

interface Props {
  request: ProcurementDetail;
  onClose: () => void;
  onSuccess: () => void;
}

export default function DispatchProcurementModal({ request, onClose, onSuccess }: Props) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Prefill so re-dispatching an already-shipped request shows the
  // existing shipment details rather than blank fields. All optional —
  // an admin may mark dispatched before a tracking number is known.
  const [trackingNumber, setTrackingNumber] = useState(request.trackingNumber ?? '');
  const [carrierName, setCarrierName] = useState(request.carrierName ?? '');
  const [expectedDeliveryAt, setExpectedDeliveryAt] = useState(
    request.expectedDeliveryAt
      ? new Date(request.expectedDeliveryAt).toISOString().slice(0, 10)
      : '',
  );

  const handleSubmit = async () => {
    // Expected delivery is optional, but when set it must not be in the past.
    if (expectedDeliveryAt) {
      const eta = new Date(expectedDeliveryAt);
      if (Number.isNaN(eta.getTime())) {
        setError('Enter a valid expected delivery date');
        return;
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (eta.getTime() < today.getTime()) {
        setError('Expected delivery date cannot be in the past');
        return;
      }
    }
    setSubmitting(true);
    setError('');
    try {
      await adminProcurementService.dispatch(request.id, {
        trackingNumber: trackingNumber.trim() || undefined,
        carrierName: carrierName.trim() || undefined,
        expectedDeliveryAt: expectedDeliveryAt
          ? new Date(expectedDeliveryAt).toISOString()
          : undefined,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to mark as dispatched');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Mark as Dispatched</h2>
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
            Mark this procurement as <strong>dispatched</strong> and notify the franchise that goods are on the way. Add shipment tracking so they can follow the goods — all fields are optional.
          </p>

          <div className="modal-form-group">
            <label htmlFor="dispatch-tracking">Tracking Number</label>
            <input
              id="dispatch-tracking"
              type="text"
              value={trackingNumber}
              onChange={e => setTrackingNumber(e.target.value)}
              placeholder="e.g. SR-AWB-12345"
            />
          </div>

          <div className="modal-form-group">
            <label htmlFor="dispatch-carrier">Carrier Name</label>
            <input
              id="dispatch-carrier"
              type="text"
              value={carrierName}
              onChange={e => setCarrierName(e.target.value)}
              placeholder="e.g. Shiprocket / BlueDart"
            />
          </div>

          <div className="modal-form-group">
            <label htmlFor="dispatch-eta">Expected Delivery</label>
            <input
              id="dispatch-eta"
              type="date"
              value={expectedDeliveryAt}
              onChange={e => setExpectedDeliveryAt(e.target.value)}
            />
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
            {submitting ? 'Updating...' : 'Confirm Dispatch'}
          </button>
        </div>
      </div>
    </div>
  );
}
