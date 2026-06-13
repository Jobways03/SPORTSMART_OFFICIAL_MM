'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  adminDisputesService,
  AssignableAdmin,
  DisputeDetail,
  DisputeMessage,
  DisputeStatus,
  STATUS_COLOR,
  KIND_LABEL,
} from '@/services/admin-disputes.service';
import CaseTimeline from '@/components/CaseTimeline';
import { usePermissions } from '@/lib/permissions';
import { validateAmount } from '@/lib/validators';

export default function DisputeDetailPage() {
  const { id } = useParams<{ id: string }>();
  // Phase 134 — internal (admin-only) notes need a finer permission than a
  // customer-visible reply. Hide the toggle when the admin lacks it (the API
  // enforces it too, soak-aware).
  const { hasPermission } = usePermissions();
  const canInternalNote = hasPermission('disputes.internalNote');
  const [detail, setDetail] = useState<DisputeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  // Idempotency key for the reply POST (endpoint is @Idempotent). Held stable
  // for the current draft so a timeout-then-reclick dedupes; regenerated after
  // each successful send.
  const [replyKey, setReplyKey] = useState<string>(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [assignable, setAssignable] = useState<AssignableAdmin[]>([]);

  // Decision form (Phase 12 — outcome alone no longer enough; admin
  // must also pick liabilityParty + customerRemedy per ADR-016).
  const [showDecide, setShowDecide] = useState(false);
  const [outcome, setOutcome] = useState<'RESOLVED_BUYER' | 'RESOLVED_SELLER' | 'RESOLVED_SPLIT'>('RESOLVED_BUYER');
  const [rationale, setRationale] = useState('');
  const [amountRupees, setAmountRupees] = useState('');
  const [liabilityParty, setLiabilityParty] = useState<
    'SELLER' | 'LOGISTICS' | 'PLATFORM' | 'CUSTOMER' | 'NONE'
  >('SELLER');
  const [customerRemedy, setCustomerRemedy] = useState<
    'FULL_REFUND' | 'PARTIAL_REFUND' | 'NO_REFUND' | 'GOODWILL_CREDIT'
  >('FULL_REFUND');
  // Optional courier metadata for LOGISTICS attribution.
  const [courierName, setCourierName] = useState('');
  const [awbNumber, setAwbNumber] = useState('');

  // "Attach order/return" rescue path for orphan disputes (promoted
  // from a generic ticket without relatedOrderId / relatedReturnId).
  const [showAttach, setShowAttach] = useState(false);
  const [attachOrderNumber, setAttachOrderNumber] = useState('');
  const [attachReturnNumber, setAttachReturnNumber] = useState('');

  // Skip the silent-refresh setDetail while a reply / decide / status
  // mutation is in flight so a late-landing GET (issued before the
  // POST) can't overwrite the detail we just got back from the POST.
  // Same race rationale as the support detail page.
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminDisputesService.get(id);
      if (res.data) setDetail(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Silent variant of refresh: no spinner toggle, swallows transient
  // errors. Used by the background poll so the admin sees customer
  // replies (mirrored from the linked support ticket) without having
  // to reload.
  const silentRefresh = useCallback(async () => {
    if (busyRef.current) return;
    try {
      const res = await adminDisputesService.get(id);
      if (res.data) setDetail(res.data);
    } catch {
      // Ignore — keep the last good payload visible. Next tick will retry.
    }
  }, [id]);

  useEffect(() => { refresh(); }, [refresh]);

  // Load the ACTIVE admins this operator can assign to (scoped endpoint —
  // the full admin directory is SUPER_ADMIN-only). Best-effort: if it fails
  // the dropdown just shows "Unassigned" + the current assignee.
  useEffect(() => {
    adminDisputesService
      .assignableAdmins()
      .then((res) => { if (res.data) setAssignable(res.data); })
      .catch(() => undefined);
  }, []);

  // 5-second background poll. Catches customer replies that landed on
  // the linked support ticket and were mirrored into the dispute
  // thread by DisputeMirrorHandler / mirrorTicketMessageToDispute.
  // Pauses while the tab is hidden; catches up immediately on
  // visibility return.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') {
          void silentRefresh();
        }
      }, 5000);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    start();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void silentRefresh();
        start();
      } else {
        stop();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [silentRefresh]);

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim() || busy) return;
    setBusy(true); busyRef.current = true;
    try {
      await adminDisputesService.reply(id, reply.trim(), replyKey, internal);
      setReply(''); setInternal(false);
      setReplyKey(crypto.randomUUID()); // fresh key for the next message
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send');
    } finally {
      setBusy(false); busyRef.current = false;
    }
  };

  const setStatus = async (s: DisputeStatus) => {
    setBusy(true); busyRef.current = true;
    try { await adminDisputesService.setStatus(id, s); refresh(); }
    finally { setBusy(false); busyRef.current = false; }
  };

  const setSev = async (n: number) => {
    setBusy(true); busyRef.current = true;
    try { await adminDisputesService.setSeverity(id, n); refresh(); }
    finally { setBusy(false); busyRef.current = false; }
  };

  const setAssignee = async (adminId: string | null) => {
    setBusy(true); busyRef.current = true;
    try { await adminDisputesService.assign(id, adminId); refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not assign'); }
    finally { setBusy(false); busyRef.current = false; }
  };

  const submitAttach = async () => {
    const orderNumber = attachOrderNumber.trim();
    const returnNumber = attachReturnNumber.trim();
    if (!orderNumber && !returnNumber) {
      return setError('Provide at least one of order number / return number');
    }
    setError('');
    setBusy(true); busyRef.current = true;
    try {
      await adminDisputesService.attachContext(id, {
        orderNumber: orderNumber || undefined,
        returnNumber: returnNumber || undefined,
      });
      setShowAttach(false);
      setAttachOrderNumber('');
      setAttachReturnNumber('');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach context');
    } finally {
      setBusy(false); busyRef.current = false;
    }
  };

  const submitDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    // Clear any stale error from a previous failed attempt — without
    // this, a rejected submit followed by a successful one leaves the
    // old red banner sitting on screen forever.
    setError('');
    if (!rationale.trim()) return setError('Rationale is required');

    // Amount required when remedy is anything other than NO_REFUND.
    let amountInPaise: number | undefined;
    if (customerRemedy !== 'NO_REFUND') {
      // Field-level guard: required, positive, <= ₹10,000,000, 2dp.
      const amtErr = validateAmount(amountRupees, {
        min: 0.01,
        max: 10_000_000,
        decimals: 2,
        label: 'Refund amount (₹)',
      });
      if (amtErr) return setError(amtErr);
      const rupees = parseFloat(amountRupees);
      amountInPaise = Math.round(rupees * 100);
    }

    setBusy(true); busyRef.current = true;
    try {
      await adminDisputesService.decide(id, {
        outcome,
        rationale: rationale.trim(),
        amountInPaise,
        liabilityParty,
        customerRemedy,
        logistics:
          liabilityParty === 'LOGISTICS'
            ? {
                courierName: courierName.trim() || undefined,
                awbNumber: awbNumber.trim() || undefined,
              }
            : undefined,
      });
      setShowDecide(false);
      setRationale('');
      setAmountRupees('');
      setCourierName('');
      setAwbNumber('');
      setError(''); // belt-and-braces: clear on confirmed success too
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not decide');
    } finally {
      setBusy(false); busyRef.current = false;
    }
  };

  if (loading && !detail) return <div style={{ padding: 32, color: '#7A828F' }}>Loading dispute…</div>;
  if (!detail) return (
    <div style={{ padding: 32 }}>
      <Link href="/dashboard/disputes" style={{ color: '#525A65', fontSize: 13 }}>← Back</Link>
      <div style={{ marginTop: 12, color: '#b91c1c' }}>{error || 'Not found'}</div>
    </div>
  );

  const isResolved = detail.status.startsWith('RESOLVED_') || detail.status === 'CLOSED';

  return (
    <div style={{ padding: '24px 32px', display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, maxWidth: 1280, margin: '0 auto' }}>
      <div>
        <Link href="/dashboard/disputes" style={{ color: '#525A65', fontSize: 13, textDecoration: 'none', display: 'inline-block', marginBottom: 12 }}>
          ← Back to disputes
        </Link>

        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, padding: 20, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#525A65', textTransform: 'uppercase' }}>{detail.disputeNumber}</span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 8px', borderRadius: 9999,
              background: STATUS_COLOR[detail.status] + '22', color: STATUS_COLOR[detail.status],
              fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>{detail.status.replace('_', ' ').toLowerCase()}</span>
            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 9999, background: '#F3F4F6', color: '#525A65', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {KIND_LABEL[detail.kind]}
            </span>
          </div>
          <p style={{ marginTop: 12, padding: 12, background: '#FAFAFA', borderRadius: 10, fontSize: 14, color: '#0F1115', whiteSpace: 'pre-wrap' }}>
            {detail.summary}
          </p>
          <p style={{ marginTop: 8, fontSize: 12, color: '#525A65' }}>
            Filed by <strong>{detail.filedByName}</strong> ({detail.filedByType.toLowerCase()}) ·{' '}
            {new Date(detail.createdAt).toLocaleString('en-IN')}
          </p>
        </div>

        {/* Phase 11 — when this dispute was promoted from a support
            ticket, surface the back-link prominently and remind the
            admin that the customer is still on the ticket. Replies
            posted here are mirrored back to the ticket as
            "Support" — never name the agent in the customer thread. */}
        {detail.sourceTicketId && (
          <div
            style={{
              marginBottom: 16,
              padding: '12px 14px',
              background: '#eef2ff',
              border: '1px solid #c7d2fe',
              borderRadius: 12,
              fontSize: 13,
              color: '#3730a3',
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              Promoted from a support ticket
            </div>
            <div>
              The customer is talking on their support ticket and does not see
              this dispute. Replies you post here mirror back to the ticket
              under the &ldquo;Support&rdquo; brand — keep tone neutral and
              never reference the dispute number.
            </div>
            <Link
              href={`/dashboard/support/${detail.sourceTicketId}`}
              style={{
                marginTop: 8,
                display: 'inline-block',
                color: '#3730a3',
                fontWeight: 600,
                textDecoration: 'underline',
              }}
            >
              → Open source ticket
            </Link>
          </div>
        )}

        {/* Rescue path: orphan disputes (no master order, sub-order, or
            return) can never have SELLER liability assigned because the
            seller is unknown. Surface a button to attach order/return
            context. Hidden once any linkage is set. */}
        {!detail.masterOrderId && !detail.subOrderId && !detail.returnId && !isResolved && (
          <div
            style={{
              marginBottom: 16,
              padding: '12px 14px',
              background: '#fefce8',
              border: '1px solid #fde047',
              borderRadius: 12,
              fontSize: 13,
              color: '#713f12',
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              No order context attached
            </div>
            <div style={{ marginBottom: 8 }}>
              This dispute has no order, sub-order, or return linked.
              SELLER liability cannot be assigned until you attach context
              — or pick PLATFORM / LOGISTICS as &ldquo;Who pays&rdquo;.
            </div>
            <button
              type="button"
              onClick={() => setShowAttach(true)}
              style={{
                height: 30, padding: '0 14px', border: '1px solid #ca8a04',
                background: '#fff', color: '#713f12',
                borderRadius: 9999, fontSize: 12, fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Attach order / return
            </button>
          </div>
        )}

        {error && <div style={{ marginBottom: 12, padding: 10, border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', borderRadius: 12, fontSize: 13 }}>{error}</div>}

        <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0F1115', marginBottom: 12 }}>Messages</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
          {detail.messages.map((m) => <Bubble key={m.id} message={m} filerName={detail.filedByName} />)}
        </div>

        {!isResolved && (
          <form onSubmit={sendReply} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, padding: 16, marginBottom: 16 }}>
            <textarea value={reply} onChange={(e) => setReply(e.target.value)} disabled={busy}
              placeholder={internal ? 'Internal note — admin only…' : 'Reply visible to filer…'}
              rows={4}
              style={{
                width: '100%', padding: 12, border: `1px solid ${internal ? '#facc15' : '#D2D6DC'}`,
                background: internal ? '#fefce8' : '#fff', borderRadius: 12, fontSize: 14, resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
              }} />
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              {canInternalNote ? (
                <label style={{ fontSize: 13, color: '#525A65', cursor: 'pointer' }}>
                  <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} style={{ accentColor: '#d97706', marginRight: 6 }} />
                  Internal note
                </label>
              ) : (
                <span />
              )}
              <button type="submit" disabled={!reply.trim() || busy} style={{
                height: 38, padding: '0 18px', border: 'none', background: internal ? '#d97706' : '#0F1115', color: '#fff',
                borderRadius: 9999, fontWeight: 600, fontSize: 14, cursor: !reply.trim() || busy ? 'not-allowed' : 'pointer', opacity: !reply.trim() || busy ? 0.5 : 1,
              }}>
                {busy ? 'Sending…' : internal ? 'Post note' : 'Send reply'}
              </button>
            </div>
          </form>
        )}

        <div style={{ marginTop: 16 }}>
          <CaseTimeline
            caseKind="dispute"
            caseId={detail.id}
            refreshKey={detail.updatedAt}
          />
        </div>
      </div>

      <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card title="Status">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {(['UNDER_REVIEW', 'AWAITING_INFO', 'CLOSED'] as DisputeStatus[]).map((s) => (
              <button key={s} type="button" disabled={busy || isResolved} onClick={() => setStatus(s)}
                style={{
                  height: 28, padding: '0 10px', fontSize: 12, fontWeight: 600,
                  border: '1px solid #D2D6DC', background: '#fff', color: '#0F1115',
                  borderRadius: 9999, cursor: busy || isResolved ? 'not-allowed' : 'pointer', opacity: busy || isResolved ? 0.5 : 1,
                }}>{s.toLowerCase().replace('_', ' ')}</button>
            ))}
          </div>
        </Card>

        <Card title={`Severity (${detail.severity})`}>
          <input type="range" min={1} max={100} value={detail.severity}
            onChange={(e) => setSev(Number(e.target.value))} disabled={busy || isResolved}
            style={{ width: '100%' }} />
          <p style={{ marginTop: 4, fontSize: 11, color: '#7A828F' }}>1 (lowest) — 100 (urgent)</p>
        </Card>

        <Card title="Assigned reviewer">
          <select
            value={detail.assignedAdminId ?? ''}
            onChange={(e) => setAssignee(e.target.value || null)}
            disabled={busy}
            style={{ width: '100%', height: 36, padding: '0 10px', border: '1px solid #D2D6DC', borderRadius: 9999, fontSize: 13 }}
          >
            <option value="">Unassigned</option>
            {assignable.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
            {/* Keep an out-of-list (e.g. now-inactive) current assignee selectable
                so opening the page doesn't silently re-show them as unassigned. */}
            {detail.assignedAdminId && !assignable.some((a) => a.id === detail.assignedAdminId) && (
              <option value={detail.assignedAdminId}>Current assignee (inactive)</option>
            )}
          </select>
          {detail.assignedAt && (
            <p style={{ marginTop: 4, fontSize: 11, color: '#7A828F' }}>
              Assigned · {new Date(detail.assignedAt).toLocaleString('en-IN')}
            </p>
          )}
        </Card>

        {detail.decisionRationale && (
          <Card title="Decision">
            <p style={{ margin: 0, fontSize: 13, color: '#0F1115', whiteSpace: 'pre-wrap' }}>{detail.decisionRationale}</p>
            {/* Phase 12 — liability + remedy attribution. Shown only
                after decision (these columns are null on un-decided
                disputes). Helps the admin see at a glance who's on
                the hook + what the customer received. */}
            {(detail.liabilityParty || detail.customerRemedy) && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                {detail.customerRemedy && (
                  <span style={{
                    fontSize: 11, padding: '3px 9px', borderRadius: 9999,
                    background: '#ecfdf5', color: '#065f46', fontWeight: 600,
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>
                    {detail.customerRemedy.replace(/_/g, ' ').toLowerCase()}
                  </span>
                )}
                {detail.liabilityParty && (
                  <span style={{
                    fontSize: 11, padding: '3px 9px', borderRadius: 9999,
                    background: '#eef2ff', color: '#3730a3', fontWeight: 600,
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>
                    paid by {detail.liabilityParty.toLowerCase()}
                  </span>
                )}
              </div>
            )}
            <p style={{ marginTop: 8, fontSize: 11, color: '#7A828F' }}>
              {detail.decisionAt && new Date(detail.decisionAt).toLocaleString('en-IN')}
            </p>
          </Card>
        )}

        {!isResolved && !showDecide && (
          <button type="button" onClick={() => setShowDecide(true)} style={{
            height: 40, padding: '0 16px', background: '#0F1115', color: '#fff', border: 'none',
            borderRadius: 9999, fontWeight: 600, fontSize: 14, cursor: 'pointer',
          }}>Make decision</button>
        )}

        {showDecide && !isResolved && (
          <form onSubmit={submitDecision} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, padding: 16 }}>
            <h4 style={{ fontSize: 14, fontWeight: 600, margin: 0, marginBottom: 8, color: '#0F1115' }}>Resolve dispute</h4>
            <select
              value={outcome}
              onChange={(e) => {
                const v = e.target.value as typeof outcome;
                setOutcome(v);
                // Auto-suggest sensible defaults so the admin doesn't have
                // to think through the matrix on every decision. They can
                // override below; backend re-validates regardless.
                if (v === 'RESOLVED_BUYER') {
                  setCustomerRemedy('FULL_REFUND');
                  setLiabilityParty('SELLER');
                } else if (v === 'RESOLVED_SPLIT') {
                  setCustomerRemedy('PARTIAL_REFUND');
                  setLiabilityParty('SELLER');
                } else {
                  setCustomerRemedy('NO_REFUND');
                  setLiabilityParty('CUSTOMER');
                }
              }}
              disabled={busy}
              style={{ width: '100%', height: 36, padding: '0 10px', border: '1px solid #D2D6DC', borderRadius: 9999, fontSize: 13, marginBottom: 8 }}
            >
              <option value="RESOLVED_BUYER">Resolved — buyer favoured</option>
              <option value="RESOLVED_SELLER">Resolved — seller favoured</option>
              <option value="RESOLVED_SPLIT">Resolved — split outcome</option>
            </select>

            {/* Phase 12 (ADR-016) — customer remedy. Drives whether a
                RefundInstruction is created. The backend re-validates
                this against the outcome — the helper line below shows
                the rule. */}
            <label style={{ fontSize: 11, fontWeight: 600, color: '#525A65', display: 'block', marginBottom: 4 }}>
              Customer remedy
            </label>
            <select
              value={customerRemedy}
              onChange={(e) => setCustomerRemedy(e.target.value as any)}
              disabled={busy}
              style={{ width: '100%', height: 36, padding: '0 10px', border: '1px solid #D2D6DC', borderRadius: 9999, fontSize: 13, marginBottom: 8 }}
            >
              <option value="FULL_REFUND">Full refund</option>
              <option value="PARTIAL_REFUND">Partial refund</option>
              <option value="GOODWILL_CREDIT">Goodwill credit (platform absorbs)</option>
              <option value="NO_REFUND">No refund</option>
            </select>

            {/* Liability party — drives which ledger row (SellerDebit /
                LogisticsClaim / PlatformExpense) gets written. */}
            <label style={{ fontSize: 11, fontWeight: 600, color: '#525A65', display: 'block', marginBottom: 4 }}>
              Who pays
            </label>
            <select
              value={liabilityParty}
              onChange={(e) => setLiabilityParty(e.target.value as any)}
              disabled={busy}
              style={{ width: '100%', height: 36, padding: '0 10px', border: '1px solid #D2D6DC', borderRadius: 9999, fontSize: 13, marginBottom: 8 }}
            >
              <option value="SELLER">Seller — recover from settlement</option>
              <option value="LOGISTICS">Logistics — recover from courier</option>
              <option value="PLATFORM">Platform — Sportsmart absorbs</option>
              <option value="CUSTOMER">Customer — no payout</option>
              <option value="NONE">None — no money moves</option>
            </select>

            {/* Courier metadata: only shown when liability is LOGISTICS,
                so the LogisticsClaim row carries enough context for ops
                to actually file with the courier. */}
            {liabilityParty === 'LOGISTICS' && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input
                  type="text"
                  value={courierName}
                  onChange={(e) => setCourierName(e.target.value)}
                  disabled={busy}
                  placeholder="Courier (e.g. Delhivery)"
                  style={{ flex: 1, height: 36, padding: '0 12px', border: '1px solid #D2D6DC', borderRadius: 9999, fontSize: 13, boxSizing: 'border-box' }}
                />
                <input
                  type="text"
                  value={awbNumber}
                  onChange={(e) => setAwbNumber(e.target.value)}
                  disabled={busy}
                  placeholder="AWB / tracking #"
                  style={{ flex: 1, height: 36, padding: '0 12px', border: '1px solid #D2D6DC', borderRadius: 9999, fontSize: 13, boxSizing: 'border-box' }}
                />
              </div>
            )}

            {customerRemedy !== 'NO_REFUND' && (
              <input
                type="number"
                step="0.01"
                min="0"
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value)}
                disabled={busy}
                placeholder="Refund amount (₹)"
                style={{ width: '100%', height: 36, padding: '0 12px', border: '1px solid #D2D6DC', borderRadius: 9999, fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }}
              />
            )}
            <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} disabled={busy}
              placeholder="Decision rationale (admin-only — customer sees a templated message)" rows={3}
              style={{ width: '100%', padding: 10, border: '1px solid #D2D6DC', borderRadius: 12, fontSize: 13, resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: 4 }} />
            <p style={{ margin: '0 0 8px 0', fontSize: 11, color: '#7A828F', lineHeight: 1.5 }}>
              Required: rationale{customerRemedy !== 'NO_REFUND' ? ' + refund amount (₹)' : ''}.
              {' '}Backend validates the (outcome × remedy × liability) combination per ADR-016 — invalid pairs are rejected with a clear error.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setShowDecide(false)} disabled={busy} style={{
                flex: 1, height: 36, border: '1px solid #D2D6DC', background: '#fff', color: '#0F1115',
                borderRadius: 9999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>Cancel</button>
              {/* Only `busy` disables submission. Empty-rationale and
                  empty-amount used to be belt-and-braces here but that
                  hid the actual error from the admin — now we let them
                  click, and submitDecision() shows a one-line message. */}
              <button type="submit" disabled={busy} style={{
                flex: 1, height: 36, border: 'none', background: '#0F1115', color: '#fff',
                borderRadius: 9999, fontSize: 13, fontWeight: 600,
                cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
              }}>{busy ? 'Saving…' : 'Confirm decision'}</button>
            </div>
          </form>
        )}
      </aside>

      {showAttach && (
        <div
          onClick={() => { if (!busy) setShowAttach(false); }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15,17,21,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 50, padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 12, padding: 24,
              width: '100%', maxWidth: 480, boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
              display: 'flex', flexDirection: 'column', gap: 12,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              Attach order / return context
            </h3>
            <p style={{ margin: 0, fontSize: 12, color: '#525A65', lineHeight: 1.5 }}>
              Just the number — no &ldquo;Order&rdquo; / &ldquo;Return&rdquo;
              prefix or <code>#</code> needed (we strip them either way).
              Backend verifies the order/return belongs to the dispute filer.
            </p>
            <div>
              <label style={{ fontSize: 12, color: '#525A65', display: 'block', marginBottom: 4 }}>
                Order number
              </label>
              <input
                type="text"
                value={attachOrderNumber}
                onChange={(e) => setAttachOrderNumber(e.target.value)}
                placeholder="SM20260062"
                disabled={busy}
                style={{
                  width: '100%', padding: 10, border: '1px solid #D2D6DC',
                  borderRadius: 12, fontSize: 13, boxSizing: 'border-box',
                  fontFamily: 'inherit',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#525A65', display: 'block', marginBottom: 4 }}>
                Return number
              </label>
              <input
                type="text"
                value={attachReturnNumber}
                onChange={(e) => setAttachReturnNumber(e.target.value)}
                placeholder="RET-2026-000017"
                disabled={busy}
                style={{
                  width: '100%', padding: 10, border: '1px solid #D2D6DC',
                  borderRadius: 12, fontSize: 13, boxSizing: 'border-box',
                  fontFamily: 'inherit',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowAttach(false)}
                disabled={busy}
                style={{
                  height: 36, padding: '0 16px', border: '1px solid #D2D6DC',
                  background: '#fff', color: '#0F1115',
                  borderRadius: 9999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitAttach}
                disabled={busy || (!attachOrderNumber.trim() && !attachReturnNumber.trim())}
                style={{
                  height: 36, padding: '0 16px', border: 'none',
                  background: '#0F1115', color: '#fff',
                  borderRadius: 9999, fontSize: 13, fontWeight: 600,
                  cursor: busy ? 'wait' : 'pointer',
                  opacity: !attachOrderNumber.trim() && !attachReturnNumber.trim() ? 0.6 : 1,
                }}
              >
                {busy ? 'Attaching…' : 'Attach'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Bubble({ message, filerName }: { message: DisputeMessage; filerName: string }) {
  const isAdmin = message.senderType === 'ADMIN';
  const bg = message.isInternalNote ? '#fefce8' : isAdmin ? '#0F1115' : '#fff';
  const fg = message.isInternalNote ? '#854d0e' : isAdmin ? '#fff' : '#0F1115';
  const align = isAdmin ? 'flex-end' : 'flex-start';
  return (
    <div style={{ display: 'flex', justifyContent: align }}>
      <div style={{ maxWidth: '78%' }}>
        <div style={{ fontSize: 12, color: '#525A65', marginBottom: 4, textAlign: isAdmin ? 'right' : 'left' }}>
          <strong style={{ color: '#0F1115' }}>{isAdmin ? message.senderName : filerName}</strong>
          {' · '}
          {new Date(message.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
          {message.isInternalNote && (
            <span style={{ marginLeft: 8, padding: '1px 6px', background: '#facc15', color: '#0F1115', borderRadius: 9999, fontSize: 10, fontWeight: 700 }}>INTERNAL</span>
          )}
        </div>
        <div style={{
          padding: '12px 14px', background: bg, color: fg, borderRadius: 14,
          border: message.isInternalNote ? '1px solid #facc15' : isAdmin ? 'none' : '1px solid #E5E7EB',
          whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.5,
        }}>
          {message.body}
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, padding: 14 }}>
      <div style={{ fontSize: 11, color: '#7A828F', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}
