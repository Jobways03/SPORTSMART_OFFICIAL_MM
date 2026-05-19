'use client';

import { useState } from 'react';
import {
  adminReturnsService,
  ReturnItem,
  QcOutcome,
} from '@/services/admin-returns.service';
import { ApiError } from '@/lib/api-client';
import '../../sellers/components/modal.css';
import '../returns.css';

interface Props {
  returnId: string;
  returnNumber: string;
  items: ReturnItem[];
  onClose: () => void;
  onSuccess: () => void;
}

interface DecisionState {
  qcOutcome: QcOutcome;
  qcQuantityApproved: number;
  qcNotes: string;
}

const QC_OUTCOMES: QcOutcome[] = ['APPROVED', 'REJECTED', 'PARTIAL', 'DAMAGED'];

export default function SubmitQcModal({
  returnId,
  returnNumber,
  items,
  onClose,
  onSuccess,
}: Props) {
  const [decisions, setDecisions] = useState<Record<string, DecisionState>>(
    () => {
      const initial: Record<string, DecisionState> = {};
      items.forEach((item) => {
        initial[item.id] = {
          qcOutcome: 'APPROVED',
          qcQuantityApproved: item.quantity,
          qcNotes: '',
        };
      });
      return initial;
    },
  );
  const [overallNotes, setOverallNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const updateDecision = (
    itemId: string,
    patch: Partial<DecisionState>,
  ) => {
    setDecisions((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], ...patch },
    }));
  };

  const handleOutcomeChange = (
    itemId: string,
    outcome: QcOutcome,
    maxQty: number,
  ) => {
    let qty = decisions[itemId]?.qcQuantityApproved ?? maxQty;
    if (outcome === 'APPROVED') qty = maxQty;
    if (outcome === 'REJECTED' || outcome === 'DAMAGED') qty = 0;
    updateDecision(itemId, { qcOutcome: outcome, qcQuantityApproved: qty });
  };

  const handleSubmit = async () => {
    setError('');
    // Validation
    for (const item of items) {
      const d = decisions[item.id];
      if (!d) continue;
      if (
        !Number.isFinite(d.qcQuantityApproved) ||
        d.qcQuantityApproved < 0 ||
        d.qcQuantityApproved > item.quantity
      ) {
        setError(
          `Approved quantity for ${
            item.orderItem?.productTitle || 'item'
          } must be between 0 and ${item.quantity}`,
        );
        return;
      }
    }

    setSubmitting(true);
    try {
      await adminReturnsService.submitQcDecision(returnId, {
        decisions: items.map((item) => ({
          returnItemId: item.id,
          qcOutcome: decisions[item.id].qcOutcome,
          qcQuantityApproved: decisions[item.id].qcQuantityApproved,
          qcNotes: decisions[item.id].qcNotes.trim() || undefined,
        })),
        overallNotes: overallNotes.trim() || undefined,
      });
      onSuccess();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to submit QC decision',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card qc-modal-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Submit QC Decision</h2>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body">
          <div
            style={{
              fontSize: 13,
              color: 'var(--color-text-secondary)',
              marginBottom: 12,
            }}
          >
            Review each item and set the QC outcome for return{' '}
            <strong style={{ color: 'var(--color-text)' }}>
              {returnNumber}
            </strong>
            .
          </div>

          {error && <div className="modal-alert modal-alert-error">{error}</div>}

          <table className="qc-modal-table">
            <thead>
              <tr>
                <th>Item</th>
                <th style={{ width: 110 }}>Qty</th>
                <th style={{ width: 140 }}>Outcome</th>
                <th style={{ width: 100 }}>Approved</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const d = decisions[item.id];
                if (!d) return null;
                return (
                  <tr key={item.id}>
                    <td>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>
                        {item.orderItem?.productTitle || 'Item'}
                      </div>
                      {item.orderItem?.variantTitle && (
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--color-text-secondary)',
                          }}
                        >
                          {item.orderItem.variantTitle}
                        </div>
                      )}
                      {item.orderItem?.sku && (
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--color-text-secondary)',
                          }}
                        >
                          SKU: {item.orderItem.sku}
                        </div>
                      )}
                    </td>
                    <td>{item.quantity}</td>
                    <td>
                      <select
                        value={d.qcOutcome}
                        onChange={(e) =>
                          handleOutcomeChange(
                            item.id,
                            e.target.value as QcOutcome,
                            item.quantity,
                          )
                        }
                      >
                        {QC_OUTCOMES.map((outcome) => (
                          <option key={outcome} value={outcome}>
                            {outcome}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        max={item.quantity}
                        value={d.qcQuantityApproved}
                        onChange={(e) =>
                          updateDecision(item.id, {
                            qcQuantityApproved: Math.max(
                              0,
                              Math.min(
                                item.quantity,
                                parseInt(e.target.value || '0', 10) || 0,
                              ),
                            ),
                          })
                        }
                      />
                    </td>
                    <td>
                      <textarea
                        placeholder="Per-item notes..."
                        value={d.qcNotes}
                        onChange={(e) =>
                          updateDecision(item.id, { qcNotes: e.target.value })
                        }
                        maxLength={500}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="modal-form-group" style={{ marginTop: 16 }}>
            <label>Overall Notes (optional)</label>
            <textarea
              placeholder="Add any overall QC observations..."
              value={overallNotes}
              onChange={(e) => setOverallNotes(e.target.value)}
              maxLength={1000}
            />
            <div className="char-count">{overallNotes.length}/1000</div>
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
            disabled={submitting}
          >
            {submitting ? 'Submitting...' : 'Submit Decision'}
          </button>
        </div>
      </div>
    </div>
  );
}
