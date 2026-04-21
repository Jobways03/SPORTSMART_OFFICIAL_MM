'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  sellerReturnsService,
  SellerReturn,
} from '@/services/returns.service';

// Match the backend enum. "Requested / Approved" are upstream states
// the customer or admin drives; seller-side actions start at RECEIVED.
const STATUS_LABELS: Record<string, string> = {
  REQUESTED: 'Requested',
  APPROVED: 'Approved',
  SHIPPED: 'Shipped back',
  RECEIVED: 'Received',
  QC_IN_PROGRESS: 'QC in progress',
  QC_APPROVED: 'QC approved',
  QC_REJECTED: 'QC rejected',
  PARTIALLY_APPROVED: 'Partially approved',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

// Per-item QC outcomes the backend accepts.
const QC_OUTCOMES = [
  { value: 'APPROVED', label: 'Approve (full refund)' },
  { value: 'PARTIAL', label: 'Partial approval' },
  { value: 'REJECTED', label: 'Reject (no refund)' },
];

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '\u2014';
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '\u2014';
  }
};

const fmtInr = (v: number | string | null | undefined) =>
  v == null ? '\u2014' : `\u20B9${Number(v).toLocaleString('en-IN')}`;

interface PerItemDecision {
  qcOutcome: string;
  qcQuantityApproved: number;
  qcNotes: string;
}

export default function SellerReturnDetailPage() {
  const params = useParams();
  const returnId = String(params?.returnId ?? '');

  const [ret, setRet] = useState<SellerReturn | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<null | 'receive' | 'qc' | 'upload'>(null);
  const [actionMsg, setActionMsg] = useState('');

  // Mark-received input
  const [receiveNotes, setReceiveNotes] = useState('');

  // QC decision inputs — one per return item
  const [decisions, setDecisions] = useState<Record<string, PerItemDecision>>({});
  const [qcOverallNotes, setQcOverallNotes] = useState('');

  // Evidence upload inputs
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceDesc, setEvidenceDesc] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await sellerReturnsService.get(returnId);
      setRet(res.data ?? null);
      // Seed QC decisions with full-approve defaults — the seller can
      // change outcome / qty before submitting.
      if (res.data) {
        const seeded: Record<string, PerItemDecision> = {};
        for (const it of res.data.items ?? []) {
          seeded[it.id] = {
            qcOutcome: it.qcOutcome ?? 'APPROVED',
            qcQuantityApproved: it.qcQuantityApproved ?? it.quantity,
            qcNotes: it.qcNotes ?? '',
          };
        }
        setDecisions(seeded);
      }
    } catch (err) {
      setError(
        (err as any)?.body?.message ||
          (err as Error)?.message ||
          'Failed to load return',
      );
    } finally {
      setLoading(false);
    }
  }, [returnId]);

  useEffect(() => {
    if (returnId) load();
  }, [returnId, load]);

  const handleMarkReceived = async () => {
    setBusy('receive');
    setActionMsg('');
    try {
      await sellerReturnsService.markReceived(returnId, receiveNotes || undefined);
      setActionMsg('Return marked as received');
      setReceiveNotes('');
      await load();
    } catch (err) {
      setActionMsg(
        (err as any)?.body?.message ||
          (err as Error)?.message ||
          'Failed to mark received',
      );
    } finally {
      setBusy(null);
    }
  };

  const handleSubmitQc = async (e: FormEvent) => {
    e.preventDefault();
    if (!ret) return;

    // Validate each decision: qcOutcome set, qty in [0, returned qty],
    // and PARTIAL requires qty > 0 (otherwise use REJECTED).
    const payload: Array<{
      returnItemId: string;
      qcOutcome: string;
      qcQuantityApproved: number;
      qcNotes?: string;
    }> = [];
    for (const it of ret.items) {
      const d = decisions[it.id];
      if (!d) continue;
      if (d.qcQuantityApproved < 0 || d.qcQuantityApproved > it.quantity) {
        setActionMsg(
          `Quantity for ${it.orderItem?.productTitle ?? 'item'} must be between 0 and ${it.quantity}`,
        );
        return;
      }
      if (d.qcOutcome === 'REJECTED' && d.qcQuantityApproved !== 0) {
        setActionMsg('Rejected items must have approved quantity = 0');
        return;
      }
      payload.push({
        returnItemId: it.id,
        qcOutcome: d.qcOutcome,
        qcQuantityApproved: d.qcQuantityApproved,
        qcNotes: d.qcNotes || undefined,
      });
    }

    setBusy('qc');
    setActionMsg('');
    try {
      await sellerReturnsService.submitQc(returnId, payload, qcOverallNotes || undefined);
      setActionMsg('QC decision submitted');
      await load();
    } catch (err) {
      setActionMsg(
        (err as any)?.body?.message ||
          (err as Error)?.message ||
          'Failed to submit QC decision',
      );
    } finally {
      setBusy(null);
    }
  };

  const handleUpload = async (e: FormEvent) => {
    e.preventDefault();
    if (!evidenceFile) {
      setActionMsg('Pick an image file first');
      return;
    }
    setBusy('upload');
    setActionMsg('');
    try {
      await sellerReturnsService.uploadEvidence(
        returnId,
        evidenceFile,
        evidenceDesc || undefined,
      );
      setActionMsg('Evidence uploaded');
      setEvidenceFile(null);
      setEvidenceDesc('');
      await load();
    } catch (err) {
      setActionMsg(
        (err as any)?.body?.message ||
          (err as Error)?.message ||
          'Upload failed',
      );
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Loading...</div>;
  }
  if (error || !ret) {
    return (
      <div style={{ padding: 24 }}>
        <Link href="/dashboard/returns" style={{ color: '#2563eb', fontSize: 13 }}>
          &larr; Back to returns
        </Link>
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: 16, borderRadius: 8, marginTop: 16 }}>
          {error || 'Return not found'}
        </div>
      </div>
    );
  }

  // Seller-side action availability driven by the FSM. `markReceived`
  // is valid only when the return is SHIPPED (package in transit back).
  // QC decision requires the return to be RECEIVED. Evidence upload is
  // allowed any time before QC is locked.
  const canMarkReceived = ret.status === 'SHIPPED';
  const canSubmitQc = ret.status === 'RECEIVED';
  const canUploadEvidence = !['COMPLETED', 'CANCELLED', 'QC_APPROVED', 'QC_REJECTED', 'PARTIALLY_APPROVED'].includes(
    ret.status,
  );

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <Link href="/dashboard/returns" style={{ color: '#2563eb', fontSize: 13, textDecoration: 'none' }}>
        &larr; Back to returns
      </Link>

      <div style={{ marginTop: 12, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>{ret.returnNumber}</h1>
          <div style={{ color: '#6b7280', fontSize: 13, marginTop: 4 }}>
            Order: <strong>{ret.masterOrder?.orderNumber ?? '\u2014'}</strong> &middot;{' '}
            Requested {fmtDate(ret.createdAt)}
          </div>
        </div>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: '4px 10px',
            borderRadius: 6,
            background: '#e0e7ff',
            color: '#3730a3',
          }}
        >
          {STATUS_LABELS[ret.status] ?? ret.status}
        </span>
      </div>

      {actionMsg && (
        <div
          style={{
            background: actionMsg.toLowerCase().includes('fail') ? '#fee2e2' : '#dcfce7',
            color: actionMsg.toLowerCase().includes('fail') ? '#991b1b' : '#166534',
            padding: '10px 14px',
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {actionMsg}
        </div>
      )}

      {/* Timeline */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          padding: 16,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 16,
          marginBottom: 20,
          fontSize: 13,
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', marginBottom: 2 }}>Pickup scheduled</div>
          <div>{fmtDate(ret.pickupScheduledAt)}</div>
          {ret.pickupCourier && (
            <div style={{ fontSize: 12, color: '#6b7280' }}>{ret.pickupCourier}</div>
          )}
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', marginBottom: 2 }}>Received</div>
          <div>{fmtDate(ret.receivedAt)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', marginBottom: 2 }}>QC completed</div>
          <div>{fmtDate(ret.qcCompletedAt)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', marginBottom: 2 }}>Refund</div>
          <div style={{ fontWeight: 600 }}>{fmtInr(ret.refundAmount)}</div>
        </div>
      </div>

      {/* Items */}
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>Items</h2>
      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          overflow: 'hidden',
          marginBottom: 20,
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
              {['Product', 'Reason', 'Qty', 'Unit Price', 'Approved'].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: 'left',
                    padding: '10px 14px',
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#6b7280',
                    textTransform: 'uppercase',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ret.items.map((it) => (
              <tr key={it.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ fontWeight: 500 }}>{it.orderItem?.productTitle ?? '\u2014'}</div>
                  {it.orderItem?.variantTitle && (
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{it.orderItem.variantTitle}</div>
                  )}
                </td>
                <td style={{ padding: '10px 14px', color: '#6b7280' }}>
                  {it.reasonCategory}
                  {it.reasonDetail ? (
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>{it.reasonDetail}</div>
                  ) : null}
                </td>
                <td style={{ padding: '10px 14px' }}>{it.quantity}</td>
                <td style={{ padding: '10px 14px', fontFamily: 'monospace' }}>
                  {fmtInr(it.orderItem?.unitPrice)}
                </td>
                <td style={{ padding: '10px 14px' }}>
                  {it.qcQuantityApproved != null ? `${it.qcQuantityApproved} (${it.qcOutcome})` : '\u2014'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mark received */}
      {canMarkReceived && (
        <Section title="Mark as received">
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 10 }}>
            Confirm the package has arrived at your warehouse. You can attach a short note
            (e.g. outer-packaging condition).
          </p>
          <textarea
            value={receiveNotes}
            onChange={(e) => setReceiveNotes(e.target.value)}
            placeholder="Optional receiving notes"
            rows={2}
            disabled={busy !== null}
            style={{
              width: '100%',
              padding: '8px 10px',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              fontSize: 13,
              marginBottom: 10,
            }}
          />
          <button
            onClick={handleMarkReceived}
            disabled={busy !== null}
            style={{
              padding: '8px 16px',
              background: busy === 'receive' ? '#93c5fd' : '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            {busy === 'receive' ? 'Marking...' : 'Mark received'}
          </button>
        </Section>
      )}

      {/* Evidence upload */}
      {canUploadEvidence && (
        <Section title="Upload QC evidence">
          <form onSubmit={handleUpload}>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setEvidenceFile(e.target.files?.[0] ?? null)}
              disabled={busy !== null}
              style={{ marginBottom: 10, fontSize: 13 }}
            />
            <input
              type="text"
              value={evidenceDesc}
              onChange={(e) => setEvidenceDesc(e.target.value)}
              placeholder="Optional description (what does this image show?)"
              disabled={busy !== null}
              style={{
                width: '100%',
                padding: '8px 10px',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                fontSize: 13,
                marginBottom: 10,
              }}
            />
            <button
              type="submit"
              disabled={busy !== null || !evidenceFile}
              style={{
                padding: '8px 16px',
                background: busy === 'upload' ? '#93c5fd' : '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 500,
                cursor: !evidenceFile || busy ? 'default' : 'pointer',
              }}
            >
              {busy === 'upload' ? 'Uploading...' : 'Upload evidence'}
            </button>
          </form>

          {ret.evidence && ret.evidence.length > 0 && (
            <div
              style={{
                marginTop: 14,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 10,
              }}
            >
              {ret.evidence.map((ev) => (
                <a
                  key={ev.id}
                  href={ev.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'block',
                    border: '1px solid #e5e7eb',
                    borderRadius: 6,
                    overflow: 'hidden',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={ev.fileUrl}
                    alt={ev.description ?? 'evidence'}
                    style={{ width: '100%', height: 100, objectFit: 'cover' }}
                  />
                  <div style={{ padding: 6, fontSize: 11, color: '#6b7280' }}>
                    {ev.description ?? '\u2014'}
                  </div>
                </a>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* QC decision */}
      {canSubmitQc && (
        <Section title="Submit QC decision">
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
            For each returned item, record the outcome and how many units you are
            approving for refund. The approved quantity must be 0 for a full Reject
            and between 1 and the returned quantity otherwise.
          </p>
          <form onSubmit={handleSubmitQc}>
            {ret.items.map((it) => {
              const d = decisions[it.id] ?? {
                qcOutcome: 'APPROVED',
                qcQuantityApproved: it.quantity,
                qcNotes: '',
              };
              return (
                <div
                  key={it.id}
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 10,
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>
                    {it.orderItem?.productTitle ?? it.id.slice(0, 8)}
                    {it.orderItem?.variantTitle ? (
                      <span style={{ color: '#6b7280', fontWeight: 400 }}>
                        {' '}&middot; {it.orderItem.variantTitle}
                      </span>
                    ) : null}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 10 }}>
                    <select
                      value={d.qcOutcome}
                      onChange={(e) => {
                        const outcome = e.target.value;
                        setDecisions((prev) => ({
                          ...prev,
                          [it.id]: {
                            ...d,
                            qcOutcome: outcome,
                            // Convenience: snap qty to 0 when rejecting.
                            qcQuantityApproved:
                              outcome === 'REJECTED'
                                ? 0
                                : d.qcQuantityApproved || it.quantity,
                          },
                        }));
                      }}
                      disabled={busy !== null}
                      style={{
                        padding: '6px 10px',
                        border: '1px solid #d1d5db',
                        borderRadius: 6,
                        fontSize: 13,
                      }}
                    >
                      {QC_OUTCOMES.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0}
                      max={it.quantity}
                      value={d.qcQuantityApproved}
                      onChange={(e) =>
                        setDecisions((prev) => ({
                          ...prev,
                          [it.id]: {
                            ...d,
                            qcQuantityApproved: Number(e.target.value) || 0,
                          },
                        }))
                      }
                      disabled={busy !== null || d.qcOutcome === 'REJECTED'}
                      style={{
                        padding: '6px 10px',
                        border: '1px solid #d1d5db',
                        borderRadius: 6,
                        fontSize: 13,
                        fontFamily: 'monospace',
                      }}
                    />
                  </div>
                  <input
                    type="text"
                    value={d.qcNotes}
                    onChange={(e) =>
                      setDecisions((prev) => ({
                        ...prev,
                        [it.id]: { ...d, qcNotes: e.target.value },
                      }))
                    }
                    placeholder="Item-level notes (optional)"
                    disabled={busy !== null}
                    style={{
                      width: '100%',
                      marginTop: 8,
                      padding: '6px 10px',
                      border: '1px solid #d1d5db',
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  />
                </div>
              );
            })}

            <textarea
              value={qcOverallNotes}
              onChange={(e) => setQcOverallNotes(e.target.value)}
              placeholder="Overall QC notes (optional)"
              rows={2}
              disabled={busy !== null}
              style={{
                width: '100%',
                padding: '8px 10px',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                fontSize: 13,
                marginBottom: 12,
              }}
            />
            <button
              type="submit"
              disabled={busy !== null}
              style={{
                padding: '8px 18px',
                background: busy === 'qc' ? '#93c5fd' : '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 500,
                cursor: busy ? 'default' : 'pointer',
              }}
            >
              {busy === 'qc' ? 'Submitting...' : 'Submit QC decision'}
            </button>
          </form>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        padding: 16,
        marginBottom: 20,
      }}
    >
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{title}</h3>
      {children}
    </div>
  );
}
