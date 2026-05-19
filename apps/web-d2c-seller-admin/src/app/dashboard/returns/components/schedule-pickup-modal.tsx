'use client';

import { useState } from 'react';
import { adminReturnsService } from '@/services/admin-returns.service';
import { ApiError } from '@/lib/api-client';
import '../../sellers/components/modal.css';

interface Props {
  returnId: string;
  returnNumber: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function SchedulePickupModal({
  returnId,
  returnNumber,
  onClose,
  onSuccess,
}: Props) {
  const [scheduledAt, setScheduledAt] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [courier, setCourier] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!scheduledAt) {
      setError('Pickup date/time is required');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await adminReturnsService.schedulePickup(returnId, {
        pickupScheduledAt: new Date(scheduledAt).toISOString(),
        pickupTrackingNumber: trackingNumber.trim() || undefined,
        pickupCourier: courier.trim() || undefined,
      });
      onSuccess();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to schedule pickup',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Schedule Pickup</h2>
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
            Schedule courier pickup for return{' '}
            <strong style={{ color: 'var(--color-text)' }}>
              {returnNumber}
            </strong>
            .
          </div>

          {error && <div className="modal-alert modal-alert-error">{error}</div>}

          <div className="modal-form-group">
            <label>Pickup Date & Time *</label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>

          <div className="modal-form-group">
            <label>Tracking Number (optional)</label>
            <input
              type="text"
              placeholder="e.g. AWB123456789"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              maxLength={100}
            />
          </div>

          <div className="modal-form-group">
            <label>Courier (optional)</label>
            <input
              type="text"
              placeholder="e.g. Delhivery, Bluedart"
              value={courier}
              onChange={(e) => setCourier(e.target.value)}
              maxLength={100}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button
            className="modal-btn"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            className="modal-btn modal-btn-primary"
            onClick={handleSubmit}
            disabled={submitting || !scheduledAt}
          >
            {submitting ? 'Scheduling...' : 'Schedule Pickup'}
          </button>
        </div>
      </div>
    </div>
  );
}
