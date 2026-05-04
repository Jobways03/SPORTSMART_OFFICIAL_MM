'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  adminSupportService,
  AdminTicketDetail,
  AdminTicketMessage,
  STATUS_LABEL,
  STATUS_COLOR,
  PRIORITY_COLOR,
  TicketStatus,
  TicketPriority,
} from '@/services/admin-support.service';
import { ApiError } from '@/lib/api-client';

const STATUS_OPTIONS: TicketStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_ON_CUSTOMER',
  'RESOLVED',
  'CLOSED',
];

const PRIORITY_OPTIONS: TicketPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

export default function TicketDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<AdminTicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [reply, setReply] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [sending, setSending] = useState(false);

  const [adminId, setAdminId] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminSupportService.getTicket(id);
      if (res.data) setDetail(res.data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to load ticket');
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    try {
      const adminData = sessionStorage.getItem('admin');
      if (adminData) setAdminId(JSON.parse(adminData).adminId || '');
    } catch {}
  }, []);

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim() || sending) return;
    setSending(true);
    try {
      const res = await adminSupportService.reply(id, reply.trim(), isInternal);
      if (res.data) {
        setDetail(res.data);
        setReply('');
        setIsInternal(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send reply');
    } finally {
      setSending(false);
    }
  };

  const changeStatus = async (s: TicketStatus) => {
    try {
      const res = await adminSupportService.setStatus(id, s);
      if (res.data && detail) setDetail({ ...detail, ticket: res.data });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update status');
    }
  };

  const changePriority = async (p: TicketPriority) => {
    try {
      const res = await adminSupportService.setPriority(id, p);
      if (res.data && detail) setDetail({ ...detail, ticket: res.data });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update priority');
    }
  };

  const toggleAssignSelf = async () => {
    if (!detail) return;
    const target =
      detail.ticket.assignedAdminId === adminId ? null : adminId;
    try {
      const res = await adminSupportService.assign(id, target);
      if (res.data) setDetail({ ...detail, ticket: res.data });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not assign');
    }
  };

  if (loading && !detail) {
    return <div style={{ padding: 32, color: '#7A828F' }}>Loading ticket…</div>;
  }

  if (!detail) {
    return (
      <div style={{ padding: 32 }}>
        <Link href="/dashboard/support" style={{ color: '#525A65', fontSize: 13 }}>
          ← Back to queue
        </Link>
        <div
          style={{
            marginTop: 16,
            padding: 16,
            border: '1px solid #fca5a5',
            background: '#fef2f2',
            color: '#b91c1c',
            borderRadius: 12,
          }}
        >
          {error || 'Ticket not found'}
        </div>
      </div>
    );
  }

  const { ticket, messages, category } = detail;
  const isMine = ticket.assignedAdminId === adminId;

  return (
    <div style={{ padding: '24px 32px', display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, maxWidth: 1280 }}>
      {/* Main column */}
      <div>
        <Link href="/dashboard/support" style={{ color: '#525A65', fontSize: 13, textDecoration: 'none', display: 'inline-block', marginBottom: 12 }}>
          ← Back to queue
        </Link>

        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, padding: 20, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#525A65', textTransform: 'uppercase' }}>
              {ticket.ticketNumber}
            </span>
            {category && (
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 9999, background: '#F3F4F6', color: '#525A65', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {category.name}
              </span>
            )}
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0F1115' }}>
            {ticket.subject}
          </h1>
          <p style={{ marginTop: 6, fontSize: 13, color: '#525A65' }}>
            From <strong style={{ color: '#0F1115' }}>{ticket.creatorName}</strong>{' '}
            ({ticket.creatorType.toLowerCase()}) · {ticket.creatorEmail}
          </p>
        </div>

        {error && (
          <div style={{ padding: 10, border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', borderRadius: 12, fontSize: 13, marginBottom: 12 }}>
            {error}
          </div>
        )}

        {/* Thread */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
          {messages.map((m) => (
            <Message key={m.id} message={m} customerName={ticket.creatorName} />
          ))}
        </div>

        {/* Reply */}
        <form onSubmit={sendReply} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, padding: 16 }}>
          <textarea
            value={reply}
            maxLength={5000}
            onChange={(e) => setReply(e.target.value)}
            disabled={sending}
            placeholder={isInternal ? 'Internal note — visible only to other admins…' : 'Reply to the customer…'}
            rows={4}
            style={{
              width: '100%',
              padding: 12,
              border: `1px solid ${isInternal ? '#facc15' : '#D2D6DC'}`,
              background: isInternal ? '#fefce8' : '#fff',
              borderRadius: 12,
              fontSize: 14,
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
          />
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#525A65', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isInternal}
                onChange={(e) => setIsInternal(e.target.checked)}
                style={{ accentColor: '#d97706' }}
              />
              Internal note (admin-only)
            </label>
            <button
              type="submit"
              disabled={!reply.trim() || sending}
              style={{
                height: 40,
                padding: '0 20px',
                border: 'none',
                background: isInternal ? '#d97706' : '#0F1115',
                color: '#fff',
                borderRadius: 9999,
                fontWeight: 600,
                fontSize: 14,
                cursor: sending || !reply.trim() ? 'not-allowed' : 'pointer',
                opacity: sending || !reply.trim() ? 0.5 : 1,
              }}
            >
              {sending ? 'Sending…' : isInternal ? 'Post note' : 'Send reply'}
            </button>
          </div>
        </form>
      </div>

      {/* Side panel */}
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card title="Status">
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 24,
              padding: '0 10px',
              borderRadius: 9999,
              background: STATUS_COLOR[ticket.status] + '22',
              color: STATUS_COLOR[ticket.status],
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 10,
            }}
          >
            {STATUS_LABEL[ticket.status]}
          </span>
          <select
            value={ticket.status}
            onChange={(e) => changeStatus(e.target.value as TicketStatus)}
            style={sideSelect}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Card>

        <Card title="Priority">
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 24,
              padding: '0 10px',
              borderRadius: 9999,
              background: PRIORITY_COLOR[ticket.priority] + '22',
              color: PRIORITY_COLOR[ticket.priority],
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 10,
            }}
          >
            {ticket.priority}
          </span>
          <select
            value={ticket.priority}
            onChange={(e) => changePriority(e.target.value as TicketPriority)}
            style={sideSelect}
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p.charAt(0) + p.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </Card>

        <Card title="Assignee">
          <p style={{ margin: 0, fontSize: 13, color: ticket.assignedAdminId ? '#0F1115' : '#7A828F' }}>
            {ticket.assignedAdminId
              ? isMine
                ? 'Assigned to you'
                : `Admin ${ticket.assignedAdminId.slice(0, 8)}…`
              : 'Unassigned'}
          </p>
          <button
            type="button"
            onClick={toggleAssignSelf}
            disabled={!adminId}
            style={{
              marginTop: 10,
              width: '100%',
              height: 36,
              border: '1px solid #D2D6DC',
              background: '#fff',
              borderRadius: 9999,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {isMine ? 'Unassign me' : 'Assign to me'}
          </button>
        </Card>

        <Card title="Activity">
          <p style={{ margin: 0, fontSize: 12, color: '#525A65' }}>
            Opened {new Date(ticket.createdAt).toLocaleString('en-IN')}
          </p>
          <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#525A65' }}>
            Last message {new Date(ticket.lastMessageAt).toLocaleString('en-IN')}
          </p>
          {ticket.resolvedAt && (
            <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#525A65' }}>
              Resolved {new Date(ticket.resolvedAt).toLocaleString('en-IN')}
            </p>
          )}
          {ticket.closedAt && (
            <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#525A65' }}>
              Closed {new Date(ticket.closedAt).toLocaleString('en-IN')}
            </p>
          )}
        </Card>

        {(ticket.relatedOrderId || ticket.relatedReturnId) && (
          <Card title="Linked records">
            {ticket.relatedOrderId && (
              <Link href={`/dashboard/orders/${ticket.relatedOrderId}`} style={cardLink}>
                → Order {ticket.relatedOrderId.slice(0, 8)}…
              </Link>
            )}
            {ticket.relatedReturnId && (
              <Link href={`/dashboard/returns/${ticket.relatedReturnId}`} style={cardLink}>
                → Return {ticket.relatedReturnId.slice(0, 8)}…
              </Link>
            )}
          </Card>
        )}
      </aside>
    </div>
  );
}

function Message({
  message,
  customerName,
}: {
  message: AdminTicketMessage;
  customerName: string;
}) {
  const isAdmin = message.senderType === 'ADMIN';
  const bg = message.isInternalNote
    ? '#fefce8'
    : isAdmin
    ? '#0F1115'
    : '#fff';
  const fg = message.isInternalNote ? '#854d0e' : isAdmin ? '#fff' : '#0F1115';
  const align = isAdmin ? 'flex-end' : 'flex-start';

  return (
    <div style={{ display: 'flex', justifyContent: align }}>
      <div style={{ maxWidth: '78%' }}>
        <div style={{ fontSize: 12, color: '#525A65', marginBottom: 4, textAlign: isAdmin ? 'right' : 'left' }}>
          <strong style={{ color: '#0F1115' }}>
            {isAdmin ? message.senderName : customerName}
          </strong>
          {' · '}
          {new Date(message.createdAt).toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
          {message.isInternalNote && (
            <span style={{ marginLeft: 8, padding: '1px 6px', background: '#facc15', color: '#0F1115', borderRadius: 9999, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>
              Internal
            </span>
          )}
        </div>
        <div
          style={{
            padding: '12px 14px',
            background: bg,
            color: fg,
            borderRadius: 14,
            border: message.isInternalNote ? '1px solid #facc15' : isAdmin ? 'none' : '1px solid #E5E7EB',
            whiteSpace: 'pre-wrap',
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          {message.body}
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, padding: 16 }}>
      <div style={{ fontSize: 11, color: '#7A828F', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

const sideSelect: React.CSSProperties = {
  width: '100%',
  height: 36,
  padding: '0 10px',
  border: '1px solid #D2D6DC',
  background: '#fff',
  borderRadius: 9999,
  fontSize: 13,
  outline: 'none',
};

const cardLink: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  color: '#2A8595',
  textDecoration: 'none',
  fontWeight: 600,
  marginBottom: 4,
};
