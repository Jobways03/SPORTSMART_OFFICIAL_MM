'use client';

import { useMemo, useState } from 'react';
import {
  adminReturnsService,
  ReturnItem,
  ReturnDetail,
  QcOutcome,
  LiabilityParty,
  CustomerRemedy,
} from '@/services/admin-returns.service';
import { ApiError } from '@/lib/api-client';
import '../../sellers/components/modal.css';
import '../returns.css';

interface Props {
  returnId: string;
  returnNumber: string;
  items: ReturnItem[];
  creditNoteEligibilityPreview?: string | null;
  // Per-item tax snapshot for the live refund preview (same data the
  // super-admin QC modal uses). Optional — legacy orders have none.
  refundPreview?: ReturnDetail['refundPreview'];
  onClose: () => void;
  onSuccess: () => void;
}

const LIABILITY_PARTIES: LiabilityParty[] = [
  'SELLER',
  'LOGISTICS',
  'PLATFORM',
  'CUSTOMER',
  'FRANCHISE',
  'BRAND',
  'INCONCLUSIVE',
  'NONE',
];
const CUSTOMER_REMEDIES: { value: CustomerRemedy; label: string }[] = [
  { value: 'FULL_REFUND', label: 'Full refund' },
  { value: 'PARTIAL_REFUND', label: 'Partial refund' },
  { value: 'NO_REFUND', label: 'No refund' },
  { value: 'GOODWILL_CREDIT', label: 'Goodwill credit' },
];
const LIABILITY_LABEL: Record<LiabilityParty, string> = {
  SELLER: 'Seller',
  LOGISTICS: 'Logistics (courier)',
  PLATFORM: 'Platform',
  CUSTOMER: 'Customer',
  FRANCHISE: 'Franchise',
  BRAND: 'Brand',
  INCONCLUSIVE: 'Inconclusive',
  NONE: 'None',
};

const fmtINR = (paise: number): string =>
  `₹${(paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

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
  creditNoteEligibilityPreview,
  refundPreview,
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
  const [liabilityParty, setLiabilityParty] = useState<LiabilityParty | ''>('');
  const [customerRemedy, setCustomerRemedy] = useState<CustomerRemedy | ''>('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Is anything being approved? Drives both the refund preview and the
  // backend's requirement that liability + remedy be set.
  const anyApproved = items.some((item) => {
    const d = decisions[item.id];
    return (
      d &&
      (d.qcOutcome === 'APPROVED' || d.qcOutcome === 'PARTIAL') &&
      d.qcQuantityApproved > 0
    );
  });

  // Live refund preview, summed across approved/partial items from the per-item
  // tax snapshot (taxable + GST, pro-rated by approved qty). Same math as the
  // super-admin modal; null when there are no snapshots or nothing to refund.
  const preview = useMemo(() => {
    const snaps = refundPreview?.taxSnapshots ?? [];
    if (snaps.length === 0) return null;
    let gross = 0;
    let discount = 0;
    let taxable = 0;
    let tax = 0;
    for (const item of items) {
      const d = decisions[item.id];
      if (!d) continue;
      const willRefund =
        (d.qcOutcome === 'APPROVED' || d.qcOutcome === 'PARTIAL') &&
        d.qcQuantityApproved > 0;
      if (!willRefund) continue;
      const snap = snaps.find((s) => s.orderItemId === item.orderItemId);
      const purchasedQty = item.orderItem?.quantity ?? 0;
      if (!snap || purchasedQty === 0) continue;
      const ratio = d.qcQuantityApproved / purchasedQty;
      gross += Number(snap.grossLineAmountInPaise) * ratio;
      discount += Number(snap.discountAmountInPaise) * ratio;
      taxable += Number(snap.taxableAmountInPaise) * ratio;
      tax +=
        (Number(snap.cgstAmountInPaise) +
          Number(snap.sgstAmountInPaise) +
          Number(snap.igstAmountInPaise)) *
        ratio;
    }
    const refund = taxable + tax;
    if (refund <= 0) return null;
    return { gross, discount, taxable, tax, refund };
  }, [items, decisions, refundPreview]);

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

    // The backend decision matrix requires liability + remedy whenever any item
    // is approved/partial — surface it here so the submit doesn't 400.
    if (anyApproved && (!liabilityParty || !customerRemedy)) {
      setError(
        'Select a Liability Party and Customer Remedy before approving any item.',
      );
      return;
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
          {(creditNoteEligibilityPreview === 'TIME_BARRED' ||
            creditNoteEligibilityPreview === 'NO_INVOICE' ||
            creditNoteEligibilityPreview === 'REQUIRES_FINANCE_REVIEW') && (
            <div
              style={{
                padding: '10px 14px',
                marginBottom: 14,
                background: '#fffbeb',
                border: '1px solid #fde68a',
                color: '#92400e',
                borderRadius: 8,
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              <strong>Heads up:</strong>{' '}
              {creditNoteEligibilityPreview === 'NO_INVOICE'
                ? 'this return has no source tax invoice'
                : 'this return is past the GST credit-note window (Section 34)'}
              . On approval the refund routes to the customer&apos;s wallet via a
              finance-approved adjustment (not the original payment method), and
              no credit note is issued.
            </div>
          )}
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

          {/* Refund preview — summed from approved items' tax snapshots (same
              math the super-admin QC modal shows). */}
          {preview && (
            <div
              style={{
                marginTop: 16,
                padding: '12px 14px',
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#166534',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: 8,
                }}
              >
                Refund Preview
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  rowGap: 4,
                  fontSize: 13,
                  color: '#374151',
                }}
              >
                <div>Gross</div>
                <div style={{ textAlign: 'right' }}>{fmtINR(preview.gross)}</div>
                <div style={{ color: '#dc2626' }}>Allocated discount</div>
                <div style={{ textAlign: 'right', color: '#dc2626' }}>
                  −{fmtINR(preview.discount)}
                </div>
                <div style={{ fontWeight: 600 }}>Net taxable refundable</div>
                <div style={{ textAlign: 'right', fontWeight: 600 }}>
                  {fmtINR(preview.taxable)}
                </div>
                <div>GST</div>
                <div style={{ textAlign: 'right' }}>{fmtINR(preview.tax)}</div>
                <div
                  style={{
                    fontWeight: 700,
                    color: '#166534',
                    borderTop: '1px solid #bbf7d0',
                    paddingTop: 4,
                    marginTop: 4,
                  }}
                >
                  Total refund / credit note
                </div>
                <div
                  style={{
                    textAlign: 'right',
                    fontWeight: 700,
                    color: '#166534',
                    borderTop: '1px solid #bbf7d0',
                    paddingTop: 4,
                    marginTop: 4,
                  }}
                >
                  {fmtINR(preview.refund)}
                </div>
              </div>
            </div>
          )}

          {/* Liability & Remedy — the backend requires both when any item is
              approved/partial (ADR-016 decision matrix). */}
          <div
            style={{
              marginTop: 16,
              padding: '12px 14px',
              background: 'var(--color-surface-2, #f9fafb)',
              border: '1px solid var(--color-border, #e5e7eb)',
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
                    <option key={p} value={p}>
                      {LIABILITY_LABEL[p]}
                    </option>
                  ))}
                </select>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--color-text-secondary)',
                    marginTop: 4,
                  }}
                >
                  Who absorbs the cost. Drives the ledger entry + seller chargeback.
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
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--color-text-secondary)',
                    marginTop: 4,
                  }}
                >
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
