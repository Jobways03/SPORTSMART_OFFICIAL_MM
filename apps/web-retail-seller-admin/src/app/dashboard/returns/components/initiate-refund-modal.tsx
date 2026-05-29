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
  creditNoteEligibilityStatus?: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

const REFUND_METHODS: RefundMethod[] = [
  'ORIGINAL_PAYMENT',
  'WALLET',
  'BANK_TRANSFER',
  'CASH',
];

export default function InitiateRefundModal({
  returnId,
  returnNumber,
  creditNoteEligibilityStatus,
  onClose,
  onSuccess,
}: Props) {
  const [refundMethod, setRefundMethod] = useState<RefundMethod | ''>('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // A time-barred / finance-review return is refunded via a finance-approved
  // GST wallet adjustment (Tax → Wallet Adjustments), NOT through this modal —
  // the server blocks direct refund initiation here to prevent a double-pay.
  const routedViaWalletAdjustment =
    creditNoteEligibilityStatus === 'TIME_BARRED' ||
    creditNoteEligibilityStatus === 'REQUIRES_FINANCE_REVIEW';

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      await adminReturnsService.initiateRefund(
        returnId,
        refundMethod || undefined,
      );
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to initiate refund');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Initiate Refund</h2>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body">
          {routedViaWalletAdjustment ? (
            <div
              style={{
                padding: '10px 14px',
                background: '#fffbeb',
                border: '1px solid #fde68a',
                color: '#92400e',
                borderRadius: 8,
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              Return <strong>{returnNumber}</strong> is past the GST credit-note
              window (Section&nbsp;34). Its refund is routed to the customer&apos;s
              wallet via a finance-approved adjustment — process it under{' '}
              <strong>Tax → Wallet Adjustments</strong>, not here. Direct refund
              initiation is blocked to avoid a double refund.
            </div>
          ) : (
            <>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--color-text-secondary)',
                  marginBottom: 16,
                }}
              >
                Initiate refund processing for return{' '}
                <strong style={{ color: 'var(--color-text)' }}>
                  {returnNumber}
                </strong>
                . If a method is not selected the original payment method will be
                used.
              </div>

              {error && (
                <div className="modal-alert modal-alert-error">{error}</div>
              )}

              <div className="modal-form-group">
                <label>Refund Method (optional)</label>
                <select
                  value={refundMethod}
                  onChange={(e) =>
                    setRefundMethod(e.target.value as RefundMethod)
                  }
                >
                  <option value="">— Use default —</option>
                  {REFUND_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={submitting}>
            {routedViaWalletAdjustment ? 'Close' : 'Cancel'}
          </button>
          {!routedViaWalletAdjustment && (
            <button
              className="modal-btn modal-btn-primary"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? 'Initiating...' : 'Initiate Refund'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
