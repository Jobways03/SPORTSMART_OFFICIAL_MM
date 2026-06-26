'use client';

import { useState } from 'react';
import {
  franchiseReturnsService,
  FranchiseReturnItem,
  QcOutcome,
  LiabilityParty,
  CustomerRemedy,
} from '@/services/franchise-returns.service';
import { ApiError } from '@/lib/api-client';
import '../../sellers/components/modal.css';

interface Props {
  returnId: string;
  franchiseId: string;
  returnNumber: string;
  items: FranchiseReturnItem[];
  onClose: () => void;
  onSuccess: () => void;
}

interface DecisionState {
  qcOutcome: QcOutcome;
  qcQuantityApproved: number;
  qcNotes: string;
}

const QC_OUTCOMES: QcOutcome[] = ['APPROVED', 'REJECTED', 'PARTIAL', 'DAMAGED'];
const LIABILITY_PARTIES: { value: LiabilityParty; label: string }[] = [
  { value: 'SELLER', label: 'Seller' },
  { value: 'LOGISTICS', label: 'Logistics (courier)' },
  { value: 'PLATFORM', label: 'Platform' },
  { value: 'CUSTOMER', label: 'Customer' },
  { value: 'FRANCHISE', label: 'Franchise' },
  { value: 'BRAND', label: 'Brand' },
  { value: 'INCONCLUSIVE', label: 'Inconclusive' },
  { value: 'NONE', label: 'None' },
];
const CUSTOMER_REMEDIES: { value: CustomerRemedy; label: string }[] = [
  { value: 'FULL_REFUND', label: 'Full refund' },
  { value: 'PARTIAL_REFUND', label: 'Partial refund' },
  { value: 'NO_REFUND', label: 'No refund' },
  { value: 'GOODWILL_CREDIT', label: 'Goodwill credit' },
];

export default function SubmitQcModal({
  returnId,
  franchiseId,
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
          qcQuantityApproved: item.quantity ?? 0,
          qcNotes: '',
        };
      });
      return initial;
    },
  );
  const [overallNotes, setOverallNotes] = useState('');
  const [liabilityParty, setLiabilityParty] = useState<LiabilityParty | ''>('');
  const [customerRemedy, setCustomerRemedy] = useState<CustomerRemedy | ''>('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const anyApproved = items.some((item) => {
    const d = decisions[item.id];
    return (
      d &&
      (d.qcOutcome === 'APPROVED' || d.qcOutcome === 'PARTIAL') &&
      d.qcQuantityApproved > 0
    );
  });

  const updateDecision = (itemId: string, patch: Partial<DecisionState>) => {
    setDecisions((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));
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
    for (const item of items) {
      const d = decisions[item.id];
      if (!d) continue;
      const maxQty = item.quantity ?? 0;
      if (
        !Number.isFinite(d.qcQuantityApproved) ||
        d.qcQuantityApproved < 0 ||
        d.qcQuantityApproved > maxQty
      ) {
        setError(
          `Approved quantity for ${
            item.orderItem?.productTitle || 'item'
          } must be between 0 and ${maxQty}`,
        );
        return;
      }
    }
    // Backend requires liability + remedy whenever any item is approved/partial.
    if (anyApproved && (!liabilityParty || !customerRemedy)) {
      setError(
        'Select a Liability Party and Customer Remedy before approving any item.',
      );
      return;
    }

    setSubmitting(true);
    try {
      await franchiseReturnsService.submitQcDecision(returnId, franchiseId, {
        decisions: items.map((item) => ({
          returnItemId: item.id,
          qcOutcome: decisions[item.id].qcOutcome,
          qcQuantityApproved: decisions[item.id].qcQuantityApproved,
          qcNotes: decisions[item.id].qcNotes.trim() || undefined,
        })),
        overallNotes: overallNotes.trim() || undefined,
        liabilityParty: liabilityParty || undefined,
        customerRemedy: customerRemedy || undefined,
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
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Submit QC Decision</h2>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
            Review each item and set the QC outcome for return{' '}
            <strong style={{ color: '#111827' }}>{returnNumber}</strong>.
          </div>

          {error && <div className="modal-alert modal-alert-error">{error}</div>}

          {items.map((item) => {
            const d = decisions[item.id];
            if (!d) return null;
            const maxQty = item.quantity ?? 0;
            return (
              <div
                key={item.id}
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 10,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
                  {item.orderItem?.productTitle ?? 'Item'} · Qty {maxQty}
                </div>
                <div
                  style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}
                >
                  <div className="modal-form-group" style={{ margin: 0 }}>
                    <label>Outcome</label>
                    <select
                      value={d.qcOutcome}
                      onChange={(e) =>
                        handleOutcomeChange(
                          item.id,
                          e.target.value as QcOutcome,
                          maxQty,
                        )
                      }
                    >
                      {QC_OUTCOMES.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="modal-form-group" style={{ margin: 0 }}>
                    <label>Approved Qty</label>
                    <input
                      type="number"
                      min={0}
                      max={maxQty}
                      value={d.qcQuantityApproved}
                      onChange={(e) =>
                        updateDecision(item.id, {
                          qcQuantityApproved: Math.max(
                            0,
                            Math.min(
                              maxQty,
                              parseInt(e.target.value || '0', 10) || 0,
                            ),
                          ),
                        })
                      }
                    />
                  </div>
                </div>
                <div
                  className="modal-form-group"
                  style={{ marginTop: 8, marginBottom: 0 }}
                >
                  <label>Notes (optional)</label>
                  <textarea
                    placeholder="Per-item notes..."
                    value={d.qcNotes}
                    onChange={(e) =>
                      updateDecision(item.id, { qcNotes: e.target.value })
                    }
                    maxLength={500}
                  />
                </div>
              </div>
            );
          })}

          {/* Liability & Remedy — required by the backend when any item is
              approved/partial (ADR-016 decision matrix). */}
          <div
            style={{
              marginTop: 8,
              padding: '12px 14px',
              background: '#f9fafb',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#374151',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                marginBottom: 8,
              }}
            >
              Liability &amp; Remedy{' '}
              {anyApproved && <span style={{ color: '#dc2626' }}>*</span>}
            </div>
            <div
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}
            >
              <div className="modal-form-group" style={{ margin: 0 }}>
                <label>Liability Party</label>
                <select
                  value={liabilityParty}
                  onChange={(e) =>
                    setLiabilityParty(e.target.value as LiabilityParty | '')
                  }
                >
                  <option value="">— Select —</option>
                  {LIABILITY_PARTIES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                  Who absorbs the cost. Drives the ledger entry + chargeback.
                </div>
              </div>
              <div className="modal-form-group" style={{ margin: 0 }}>
                <label>Customer Remedy</label>
                <select
                  value={customerRemedy}
                  onChange={(e) =>
                    setCustomerRemedy(e.target.value as CustomerRemedy | '')
                  }
                >
                  <option value="">— Select —</option>
                  {CUSTOMER_REMEDIES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                  How the customer is made whole.
                </div>
              </div>
            </div>
          </div>

          <div className="modal-form-group" style={{ marginTop: 16 }}>
            <label>Overall Notes (optional)</label>
            <textarea
              placeholder="Add any overall QC observations..."
              value={overallNotes}
              onChange={(e) => setOverallNotes(e.target.value)}
              maxLength={1000}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={submitting}>
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
