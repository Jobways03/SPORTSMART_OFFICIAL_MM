'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  adminDisputesService,
  DisputeDetail,
  DisputeMessage,
  DisputeStatus,
  STATUS_COLOR,
  KIND_LABEL,
} from '@/services/admin-disputes.service';

export default function DisputeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<DisputeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);

  // Decision form
  const [showDecide, setShowDecide] = useState(false);
  const [outcome, setOutcome] = useState<'RESOLVED_BUYER' | 'RESOLVED_SELLER' | 'RESOLVED_SPLIT'>('RESOLVED_BUYER');
  const [rationale, setRationale] = useState('');
  const [amountRupees, setAmountRupees] = useState('');

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

  useEffect(() => { refresh(); }, [refresh]);

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim() || busy) return;
    setBusy(true);
    try {
      await adminDisputesService.reply(id, reply.trim(), internal);
      setReply(''); setInternal(false);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (s: DisputeStatus) => {
    setBusy(true);
    try { await adminDisputesService.setStatus(id, s); refresh(); }
    finally { setBusy(false); }
  };

  const setSev = async (n: number) => {
    setBusy(true);
    try { await adminDisputesService.setSeverity(id, n); refresh(); }
    finally { setBusy(false); }
  };

  const submitDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rationale.trim()) return setError('Rationale is required');

    // Amount validation matches the API: required for buyer/split,
    // forbidden for seller. Convert rupees → paise here so the wire
    // payload stays in the platform's canonical money units.
    let amountInPaise: number | undefined;
    if (outcome !== 'RESOLVED_SELLER') {
      const rupees = parseFloat(amountRupees);
      if (!Number.isFinite(rupees) || rupees <= 0) {
        return setError('Refund amount (₹) is required for buyer/split outcomes');
      }
      amountInPaise = Math.round(rupees * 100);
    }

    setBusy(true);
    try {
      await adminDisputesService.decide(id, {
        outcome,
        rationale: rationale.trim(),
        amountInPaise,
      });
      setShowDecide(false);
      setRationale('');
      setAmountRupees('');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not decide');
    } finally {
      setBusy(false);
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
    <div style={{ padding: '24px 32px', display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, maxWidth: 1280 }}>
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
              <label style={{ fontSize: 13, color: '#525A65', cursor: 'pointer' }}>
                <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} style={{ accentColor: '#d97706', marginRight: 6 }} />
                Internal note
              </label>
              <button type="submit" disabled={!reply.trim() || busy} style={{
                height: 38, padding: '0 18px', border: 'none', background: internal ? '#d97706' : '#0F1115', color: '#fff',
                borderRadius: 9999, fontWeight: 600, fontSize: 14, cursor: !reply.trim() || busy ? 'not-allowed' : 'pointer', opacity: !reply.trim() || busy ? 0.5 : 1,
              }}>
                {busy ? 'Sending…' : internal ? 'Post note' : 'Send reply'}
              </button>
            </div>
          </form>
        )}
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

        {detail.decisionRationale && (
          <Card title="Decision">
            <p style={{ margin: 0, fontSize: 13, color: '#0F1115', whiteSpace: 'pre-wrap' }}>{detail.decisionRationale}</p>
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
            <select value={outcome} onChange={(e) => setOutcome(e.target.value as any)} disabled={busy}
              style={{ width: '100%', height: 36, padding: '0 10px', border: '1px solid #D2D6DC', borderRadius: 9999, fontSize: 13, marginBottom: 8 }}>
              <option value="RESOLVED_BUYER">Resolved — buyer favoured</option>
              <option value="RESOLVED_SELLER">Resolved — seller favoured</option>
              <option value="RESOLVED_SPLIT">Resolved — split outcome</option>
            </select>
            {outcome !== 'RESOLVED_SELLER' && (
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
              placeholder="Decision rationale (visible to both sides)" rows={3}
              style={{ width: '100%', padding: 10, border: '1px solid #D2D6DC', borderRadius: 12, fontSize: 13, resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: 8 }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setShowDecide(false)} disabled={busy} style={{
                flex: 1, height: 36, border: '1px solid #D2D6DC', background: '#fff', color: '#0F1115',
                borderRadius: 9999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>Cancel</button>
              <button type="submit" disabled={busy || !rationale.trim()} style={{
                flex: 1, height: 36, border: 'none', background: '#0F1115', color: '#fff',
                borderRadius: 9999, fontSize: 13, fontWeight: 600,
                cursor: busy || !rationale.trim() ? 'not-allowed' : 'pointer', opacity: busy || !rationale.trim() ? 0.5 : 1,
              }}>{busy ? 'Saving…' : 'Confirm decision'}</button>
            </div>
          </form>
        )}
      </aside>
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
