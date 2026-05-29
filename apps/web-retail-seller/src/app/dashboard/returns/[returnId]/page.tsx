'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  sellerReturnsService,
  SellerReturn,
} from '@/services/returns.service';
import {
  sellerDisputesService,
  DisputeKind,
} from '@/services/disputes.service';

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

export default function SellerReturnDetailPage() {
  const params = useParams();
  const returnId = String(params?.returnId ?? '');

  const [ret, setRet] = useState<SellerReturn | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<null | 'receive' | 'upload' | 'respond' | 'dispute'>(null);
  const [actionMsg, setActionMsg] = useState('');

  // Mark-received input
  const [receiveNotes, setReceiveNotes] = useState('');

  // Evidence upload inputs
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceDesc, setEvidenceDesc] = useState('');

  // Phase 13 (P1.8) — seller-respond inputs.
  const [respondDecision, setRespondDecision] =
    useState<'ACCEPTED' | 'CONTESTED'>('CONTESTED');
  const [respondNotes, setRespondNotes] = useState('');
  const [respondEvidenceUrl, setRespondEvidenceUrl] = useState('');

  // Phase 110 — formal dispute (escalation beyond the seller-response window).
  const [showDispute, setShowDispute] = useState(false);
  const [disputeKind, setDisputeKind] = useState<DisputeKind>('RETURN_REJECTED');
  const [disputeSummary, setDisputeSummary] = useState('');
  const [disputeIdemKey, setDisputeIdemKey] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await sellerReturnsService.get(returnId);
      setRet(res.data ?? null);
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

  const handleRespond = async () => {
    if (respondDecision === 'CONTESTED' && !respondNotes.trim()) {
      setActionMsg('Please add notes when contesting the claim');
      return;
    }
    setBusy('respond');
    setActionMsg('');
    try {
      const evidenceFileUrls = respondEvidenceUrl.trim()
        ? [respondEvidenceUrl.trim()]
        : undefined;
      await sellerReturnsService.respond(returnId, {
        decision: respondDecision,
        notes: respondNotes.trim() || undefined,
        evidenceFileUrls,
      });
      setActionMsg(`Response recorded: ${respondDecision.toLowerCase()}`);
      setRespondNotes('');
      setRespondEvidenceUrl('');
      await load();
    } catch (err) {
      setActionMsg(
        (err as any)?.body?.message ||
          (err as Error)?.message ||
          'Failed to submit response',
      );
    } finally {
      setBusy(null);
    }
  };

  const openDispute = () => {
    setDisputeIdemKey(
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `dispute-${returnId}-${Date.now()}`,
    );
    setDisputeKind('RETURN_REJECTED');
    setDisputeSummary('');
    setActionMsg('');
    setShowDispute(true);
  };

  const handleFileDispute = async () => {
    if (disputeSummary.trim().length < 5) {
      setActionMsg('Please describe the issue (at least 5 characters).');
      return;
    }
    setBusy('dispute');
    setActionMsg('');
    try {
      await sellerDisputesService.file(
        { kind: disputeKind, summary: disputeSummary.trim(), returnId },
        disputeIdemKey,
      );
      setActionMsg(
        'Dispute filed — our team will review it; the customer has been notified.',
      );
      setShowDispute(false);
      setDisputeSummary('');
      await load();
    } catch (err) {
      setActionMsg(
        (err as any)?.body?.message ||
          (err as Error)?.message ||
          'Failed to file dispute',
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
  // Phase 100 (2026-05-23) — Mark Received audit Gap #1 closure.
  // Pre-Phase-100 this checked status === 'SHIPPED', which is NOT a
  // valid ReturnStatus enum. The button NEVER rendered. Aligned with
  // backend FSM (PICKUP_SCHEDULED | IN_TRANSIT → RECEIVED).
  const canMarkReceived =
    ret.status === 'IN_TRANSIT' || ret.status === 'PICKUP_SCHEDULED';
  // Phase 100 — QC submission is admin-only (backend refuses non-
  // ADMIN actorType). Kept false so the dead QC block never renders.
  const canSubmitQc = false;
  // QC evidence is photos of the product as it arrived from the customer,
  // so the form only makes sense once the seller is physically holding
  // the package. Earlier states (pickup not scheduled, in transit) have
  // no product to photograph; later states (admin has already issued a
  // QC decision) have nothing left to add.
  const canUploadEvidence = ret.status === 'RECEIVED';
  // Phase 110 — formal dispute is available once the return has progressed to
  // a contestable state. The backend ownership guard + admin triage are the
  // real gates; this is a UX availability hint.
  const canFileDispute = [
    'RECEIVED',
    'QC_APPROVED',
    'QC_REJECTED',
    'PARTIALLY_APPROVED',
    'REFUND_PROCESSING',
    'REFUNDED',
    'REFUND_FAILED',
    'COMPLETED',
  ].includes(ret.status);

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

      {/* Phase 13 (P1.8) — seller respond. Visible only when the
          customer's claim alleged seller fault and we're inside the
          response window. Once ACCEPTED / CONTESTED / EXPIRED, this
          panel hides; the QC-side will see the seller's choice. */}
      {ret.sellerResponseStatus === 'PENDING' && (
        <div
          style={{
            background: '#fef3c7',
            border: '1px solid #fcd34d',
            borderRadius: 10,
            padding: 16,
            marginBottom: 20,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#78350f', margin: 0 }}>
                Customer claims this is your fault
              </h2>
              <p style={{ fontSize: 13, color: '#92400e', marginTop: 4, marginBottom: 0 }}>
                Accept the claim (we'll refund the customer and debit your settlement) or
                contest it with evidence. If you don't respond by{' '}
                <strong>{fmtDate(ret.sellerResponseDueAt)}</strong>, the case
                will default to seller fault.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {(['ACCEPTED', 'CONTESTED'] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setRespondDecision(d)}
                disabled={busy !== null}
                style={{
                  padding: '6px 14px',
                  background: respondDecision === d ? '#78350f' : '#fff',
                  color: respondDecision === d ? '#fff' : '#78350f',
                  border: '1px solid #b45309',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                {d === 'ACCEPTED' ? 'Accept claim' : 'Contest with evidence'}
              </button>
            ))}
          </div>

          <textarea
            value={respondNotes}
            onChange={(e) => setRespondNotes(e.target.value)}
            placeholder={
              respondDecision === 'CONTESTED'
                ? 'Required — explain why this claim is incorrect (e.g. shipped intact, packing photo proves no defect)'
                : 'Optional notes for the admin reviewing'
            }
            rows={3}
            disabled={busy !== null}
            style={{
              width: '100%',
              padding: '8px 10px',
              border: '1px solid #b45309',
              borderRadius: 6,
              fontSize: 13,
              marginBottom: 10,
              boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
          />

          <input
            type="url"
            value={respondEvidenceUrl}
            onChange={(e) => setRespondEvidenceUrl(e.target.value)}
            placeholder="Evidence URL (optional — packing-line photo, shipment scan, etc.)"
            disabled={busy !== null}
            style={{
              width: '100%',
              padding: '8px 10px',
              border: '1px solid #b45309',
              borderRadius: 6,
              fontSize: 13,
              marginBottom: 10,
              boxSizing: 'border-box',
            }}
          />

          <button
            type="button"
            onClick={handleRespond}
            disabled={busy !== null}
            style={{
              padding: '8px 18px',
              background: busy === 'respond' ? '#fbbf24' : '#78350f',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            {busy === 'respond'
              ? 'Submitting...'
              : `Submit ${respondDecision.toLowerCase()}`}
          </button>
        </div>
      )}

      {/* Read-only banner once a response has been recorded. */}
      {ret.sellerResponseStatus === 'ACCEPTED' && (
        <div style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#166534', marginBottom: 20 }}>
          You accepted this claim on {fmtDate(ret.sellerRespondedAt)}.
          {ret.sellerResponseNotes ? <div style={{ marginTop: 4, color: '#365314' }}>{ret.sellerResponseNotes}</div> : null}
        </div>
      )}
      {ret.sellerResponseStatus === 'CONTESTED' && (
        <div style={{ background: '#dbeafe', border: '1px solid #93c5fd', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#1e3a8a', marginBottom: 20 }}>
          You contested this claim on {fmtDate(ret.sellerRespondedAt)}; admin is reviewing.
          {ret.sellerResponseNotes ? <div style={{ marginTop: 4, color: '#1e40af' }}>{ret.sellerResponseNotes}</div> : null}
        </div>
      )}
      {ret.sellerResponseStatus === 'EXPIRED' && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#991b1b', marginBottom: 20 }}>
          The response window closed without a reply. The case has defaulted to seller fault.
        </div>
      )}

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

      {/* Phase 110 — file a formal dispute (escalation) */}
      {canFileDispute && (
        <Section title="Contest this return">
          {!showDispute ? (
            <>
              <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 10 }}>
                Disagree with how this return was handled — wrong or damaged
                item returned, items missing from the parcel, or the QC outcome?
                File a formal dispute for the Sportsmart team to review.
              </p>
              <button
                type="button"
                onClick={openDispute}
                style={{ height: 36, padding: '0 16px', border: '1px solid #b91c1c', background: '#fff', color: '#b91c1c', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
              >
                File a dispute
              </button>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>Reason</label>
              <select
                value={disputeKind}
                onChange={(e) => setDisputeKind(e.target.value as DisputeKind)}
                disabled={busy !== null}
                style={{ padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}
              >
                <option value="RETURN_REJECTED">Disagree with QC / return outcome</option>
                <option value="WRONG_ITEM_RECEIVED">Wrong item was returned</option>
                <option value="DAMAGED_IN_TRANSIT">Item returned damaged</option>
                <option value="MISSING_FROM_PARCEL">Item missing from return parcel</option>
                <option value="OTHER">Other</option>
              </select>
              <label style={{ fontSize: 13, fontWeight: 600 }}>Details</label>
              <textarea
                value={disputeSummary}
                onChange={(e) => setDisputeSummary(e.target.value)}
                placeholder="Describe the issue (min 5 characters)"
                rows={4}
                maxLength={5000}
                disabled={busy !== null}
                style={{ padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={handleFileDispute}
                  disabled={busy !== null}
                  style={{ height: 36, padding: '0 16px', border: 'none', background: '#b91c1c', color: '#fff', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}
                >
                  {busy === 'dispute' ? 'Filing…' : 'Submit dispute'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDispute(false)}
                  disabled={busy !== null}
                  style={{ height: 36, padding: '0 16px', border: '1px solid #d1d5db', background: '#fff', color: '#374151', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Section>
      )}

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

      {/* QC decision is admin-only — surface a clear "what to do next"
          card to the seller so they understand the handoff. The admin
          will issue the binding QC outcome from the marketplace
          dashboard once the seller has uploaded enough evidence. */}
      {canSubmitQc && (
        <Section title="QC decision">
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>
            QC outcomes (approve / partial / reject) are issued by the marketplace
            admin from the central dashboard. Your role here is to upload clear
            evidence photos using the form above so the admin can see what arrived.
          </p>
          <p style={{ fontSize: 12, color: '#9ca3af', margin: 0 }}>
            Once admin issues the decision, this return moves to refund processing
            and the page below will refresh to reflect the next step.
          </p>
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
