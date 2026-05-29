'use client';

import { useState } from 'react';
import {
  adminReturnsService,
  RefundMethod,
} from '@/services/admin-returns.service';
import { ApiError } from '@/lib/api-client';
import '../../sellers/components/modal.css';

interface Props {
  returnId: string;
  returnNumber: string;
  onClose: () => void;
  onSuccess: () => void;
}

const REFUND_METHODS: RefundMethod[] = [
  'ORIGINAL_PAYMENT',
  'WALLET',
  'BANK_TRANSFER',
  'CASH',
];

export default function ConfirmRefundModal({
  returnId,
  returnNumber,
  onClose,
  onSuccess,
}: Props) {
  const [refundReference, setRefundReference] = useState('');
  const [refundMethod, setRefundMethod] = useState<RefundMethod | ''>('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const trimmed = refundReference.trim();
  const valid = trimmed.length > 0;

  const handleSubmit = async () => {
    if (!valid) {
      setError('Refund reference is required');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await adminReturnsService.confirmRefund(returnId, {
        refundReference: trimmed,
        refundMethod: refundMethod || undefined,
        notes: notes.trim() || undefined,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to confirm refund');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Confirm Refund</h2>
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
            Confirm the refund for return{' '}
            <strong style={{ color: 'var(--color-text)' }}>
              {returnNumber}
            </strong>
            . Enter the payment gateway / bank transaction reference below.
          </div>

          {error && <div className="modal-alert modal-alert-error">{error}</div>}

          <div className="modal-form-group">
            <label>Refund Reference *</label>
            <input
              type="text"
              placeholder="e.g. TXN123456789 / UTR / Gateway ref"
              value={refundReference}
              onChange={(e) => setRefundReference(e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="modal-form-group">
            <label>Refund Method (optional)</label>
            <select
              value={refundMethod}
              onChange={(e) => setRefundMethod(e.target.value as RefundMethod)}
            >
              <option value="">— Select —</option>
              {REFUND_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>

          <div className="modal-form-group">
            <label>Notes (optional)</label>
            <textarea
              placeholder="Any additional details about the refund..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
            />
            <div className="char-count">{notes.length}/500</div>
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
            disabled={submitting || !valid}
          >
            {submitting ? 'Confirming...' : 'Confirm Refund'}
          </button>
        </div>
      </div>
    </div>
  );
}
