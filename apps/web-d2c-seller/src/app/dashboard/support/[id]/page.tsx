'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  sellerSupportService,
  TicketDetail,
  TicketMessage,
  STATUS_LABEL,
  STATUS_COLOR,
} from '@/services/support.service';
import { validateText } from '@/lib/validators';

export default function SellerTicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await sellerSupportService.getTicket(id);
      if (res.data) setDetail(res.data);
      else setError('Ticket not found');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    const replyErr = validateText(reply, { min: 2, max: 5000, label: 'Reply' });
    if (replyErr) {
      setError(replyErr);
      return;
    }
    setError('');
    setSending(true);
    try {
      const res = await sellerSupportService.reply(id, reply.trim());
      if (res.data) {
        setDetail(res.data);
        setReply('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send reply');
    } finally {
      setSending(false);
    }
  };

  const closeTicket = async () => {
    if (!detail || closing) return;
    setClosing(true);
    try {
      const res = await sellerSupportService.closeTicket(id);
      if (res.data) setDetail({ ...detail, ticket: res.data });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not close ticket');
    } finally {
      setClosing(false);
    }
  };

  if (loading && !detail) return <div style={{ padding: 32, color: '#7A828F' }}>Loading ticket…</div>;
  if (!detail) return (
    <div style={{ padding: 32 }}>
      <Link href="/dashboard/support" style={{ color: '#525A65', fontSize: 13 }}>← Back</Link>
      <div style={{ marginTop: 12, color: '#b91c1c' }}>{error || 'Not found'}</div>
    </div>
  );

  const { ticket, messages, category } = detail;
  const isClosed = ticket.status === 'CLOSED';

  return (
    <div style={{ padding: '24px 32px', maxWidth: 880 }}>
      <Link href="/dashboard/support" style={{ color: '#525A65', fontSize: 13, textDecoration: 'none', display: 'inline-block', marginBottom: 12 }}>
        ← Back to support
      </Link>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#525A65', textTransform: 'uppercase' }}>{ticket.ticketNumber}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 8px', borderRadius: 9999, background: STATUS_COLOR[ticket.status] + '22', color: STATUS_COLOR[ticket.status], fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {STATUS_LABEL[ticket.status]}
          </span>
          {category && (
            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 9999, background: '#F3F4F6', color: '#525A65', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {category.name}
            </span>
          )}
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0F1115' }}>{ticket.subject}</h1>
        <p style={{ marginTop: 4, fontSize: 12, color: '#525A65' }}>
          Opened {new Date(ticket.createdAt).toLocaleString('en-IN')}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
        {messages.map((m) => <Bubble key={m.id} message={m} sellerName={ticket.creatorName} />)}
      </div>

      {isClosed ? (
        <div style={{ background: '#FAFAFA', border: '1px solid #E5E7EB', borderRadius: 16, padding: 20, textAlign: 'center', color: '#525A65', fontSize: 14 }}>
          This ticket is closed. Need more help? Open a new ticket and reference{' '}
          <span style={{ fontFamily: 'ui-monospace, monospace' }}>{ticket.ticketNumber}</span>.
        </div>
      ) : (
        <form onSubmit={sendReply} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, padding: 16 }}>
          <textarea
            value={reply} maxLength={5000} rows={4} onChange={(e) => setReply(e.target.value)} disabled={sending}
            placeholder="Write a reply…"
            style={{ width: '100%', padding: 12, border: '1px solid #D2D6DC', borderRadius: 12, fontSize: 14, resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', minHeight: 100 }}
          />
          {error && (
            <div style={{ marginTop: 8, padding: 10, border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', borderRadius: 12, fontSize: 13 }}>{error}</div>
          )}
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <button type="button" onClick={closeTicket} disabled={closing || sending} style={{ height: 36, padding: '0 14px', border: '1px solid #D2D6DC', background: '#fff', color: '#525A65', borderRadius: 9999, fontSize: 13, fontWeight: 600, cursor: closing || sending ? 'not-allowed' : 'pointer', opacity: closing || sending ? 0.5 : 1 }}>
              {closing ? 'Closing…' : 'Close ticket'}
            </button>
            <button type="submit" disabled={!reply.trim() || sending} style={{ height: 40, padding: '0 20px', border: 'none', background: '#0F1115', color: '#fff', borderRadius: 9999, fontWeight: 600, fontSize: 14, cursor: !reply.trim() || sending ? 'not-allowed' : 'pointer', opacity: !reply.trim() || sending ? 0.5 : 1 }}>
              {sending ? 'Sending…' : 'Send reply'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function Bubble({ message, sellerName }: { message: TicketMessage; sellerName: string }) {
  const isMine = message.senderType === 'SELLER';
  return (
    <div style={{ display: 'flex', justifyContent: isMine ? 'flex-end' : 'flex-start' }}>
      <div style={{ maxWidth: '78%' }}>
        <div style={{ fontSize: 12, color: '#525A65', marginBottom: 4, textAlign: isMine ? 'right' : 'left' }}>
          <strong style={{ color: '#0F1115' }}>{isMine ? sellerName : message.senderName}</strong>
          {' · '}
          {new Date(message.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </div>
        <div style={{
          padding: '12px 14px', background: isMine ? '#0F1115' : '#fff', color: isMine ? '#fff' : '#0F1115',
          borderRadius: 14, border: isMine ? 'none' : '1px solid #E5E7EB',
          whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.5,
        }}>
          {message.body}
        </div>
      </div>
    </div>
  );
}
