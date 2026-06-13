'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  Send,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Headphones,
  User,
} from 'lucide-react';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import { useAuthGuard } from '@/lib/useAuthGuard';
import {
  supportService,
  TicketDetail,
  TicketMessage,
  TicketStatus,
  STATUS_LABEL,
} from '@/services/support.service';
import { validateText } from '@/lib/validators';

const STATUS_TONE: Record<TicketStatus, { fg: string; bg: string }> = {
  OPEN: { fg: 'text-warning', bg: 'bg-gold-soft' },
  IN_PROGRESS: { fg: 'text-accent-dark', bg: 'bg-accent-soft' },
  WAITING_ON_CUSTOMER: { fg: 'text-sale-dark', bg: 'bg-sale-soft' },
  RESOLVED: { fg: 'text-success', bg: 'bg-green-50' },
  CLOSED: { fg: 'text-ink-600', bg: 'bg-ink-100' },
};

export default function TicketThreadPage() {
  const { id } = useParams<{ id: string }>();
  const authStatus = useAuthGuard();
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (authStatus !== 'authed') return;
    supportService
      .getTicket(id)
      .then((res) => {
        if (res.data) setDetail(res.data);
        else setError('Ticket not found');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [authStatus, id]);

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    const replyError = validateText(reply, { label: 'Reply', min: 1, max: 5000 });
    if (replyError) {
      setError(replyError);
      return;
    }
    setSending(true);
    try {
      const res = await supportService.reply(id, reply.trim());
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
      const res = await supportService.closeTicket(id);
      if (res.data) {
        setDetail({ ...detail, ticket: res.data });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not close ticket');
    } finally {
      setClosing(false);
    }
  };

  if (authStatus === 'checking' || loading) {
    return (
      <StorefrontShell>
        <div className="container-x py-16 text-center text-ink-600">Loading ticket…</div>
      </StorefrontShell>
    );
  }

  if (error || !detail) {
    return (
      <StorefrontShell>
        <div className="container-x py-16 max-w-xl text-center">
          <XCircle className="size-12 mx-auto text-ink-400 mb-3" strokeWidth={1.5} />
          <h2 className="font-display text-h2 text-ink-900">Ticket not found</h2>
          <p className="mt-2 text-body text-ink-600">{error}</p>
          <Link
            href="/help/tickets"
            className="mt-5 inline-flex items-center gap-2 h-11 px-5 bg-ink-900 text-white font-semibold hover:bg-ink-800 rounded-full transition-colors"
          >
            Back to tickets
          </Link>
        </div>
      </StorefrontShell>
    );
  }

  const { ticket, messages, category } = detail;
  const tone = STATUS_TONE[ticket.status];
  const isClosed = ticket.status === 'CLOSED';

  return (
    <StorefrontShell>
      <div className="container-x py-8 sm:py-12 max-w-3xl">
        <Link
          href="/help/tickets"
          className="inline-flex items-center gap-1.5 text-body text-ink-600 hover:text-ink-900 mb-4"
        >
          <ArrowLeft className="size-4" />
          Back to tickets
        </Link>

        {/* Header */}
        <div className="bg-white border border-ink-200 rounded-2xl p-5 sm:p-6 mb-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-caption text-ink-500 font-mono uppercase tracking-wider">
              {ticket.ticketNumber}
            </span>
            <span
              className={`inline-flex items-center h-5 px-2 text-[10px] font-semibold uppercase tracking-wider rounded-full ${tone.bg} ${tone.fg}`}
            >
              {STATUS_LABEL[ticket.status]}
            </span>
            {category && (
              <span className="inline-flex items-center h-5 px-2 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-ink-100 text-ink-700">
                {category.name}
              </span>
            )}
          </div>
          <h1 className="font-display text-h2 text-ink-900">{ticket.subject}</h1>
          <p className="mt-2 text-caption text-ink-600">
            Opened{' '}
            {new Date(ticket.createdAt).toLocaleString('en-IN', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
            {ticket.resolvedAt && (
              <>
                {' '}
                · Resolved{' '}
                {new Date(ticket.resolvedAt).toLocaleString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                })}
              </>
            )}
          </p>
        </div>

        {/* Thread */}
        <ul className="space-y-3 mb-6">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} customerName={ticket.creatorName} />
          ))}
        </ul>

        {/* Reply / closed footer */}
        {isClosed ? (
          <div className="bg-ink-50 border border-ink-200 rounded-2xl p-5 text-center">
            <CheckCircle2 className="size-5 mx-auto text-ink-500 mb-2" />
            <p className="text-body text-ink-700">
              This ticket is closed. Need more help? Open a new ticket and reference{' '}
              <span className="font-mono">{ticket.ticketNumber}</span>.
            </p>
          </div>
        ) : (
          <form
            onSubmit={sendReply}
            className="bg-white border border-ink-200 rounded-2xl p-4 sm:p-5"
          >
            <textarea
              maxLength={5000}
              rows={4}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              disabled={sending}
              placeholder="Write a reply…"
              className="w-full px-4 py-3 border border-ink-300 focus:border-ink-900 bg-white text-body focus:outline-none transition-colors rounded-2xl resize-y min-h-[100px]"
            />
            {error && (
              <div
                role="alert"
                className="mt-3 flex items-start gap-2 p-2.5 border border-danger/30 bg-red-50 text-danger text-caption rounded-xl"
              >
                <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                {error}
              </div>
            )}
            <div className="mt-3 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={closeTicket}
                disabled={closing || sending}
                className="inline-flex items-center gap-1.5 h-10 px-4 border border-ink-300 hover:border-ink-900 text-body font-medium text-ink-700 disabled:opacity-50 rounded-full transition-colors"
              >
                {closing ? 'Closing…' : 'Close ticket'}
              </button>
              <button
                type="submit"
                disabled={!reply.trim() || sending}
                aria-busy={sending}
                className="inline-flex items-center gap-2 h-10 px-5 bg-ink-900 text-white font-semibold hover:bg-ink-800 disabled:opacity-50 rounded-full transition-colors"
              >
                {sending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Send className="size-4" />
                    Send
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </StorefrontShell>
  );
}

function MessageBubble({
  message,
  customerName,
}: {
  message: TicketMessage;
  customerName: string;
}) {
  const isCustomer = message.senderType === 'CUSTOMER';
  return (
    <li className={`flex ${isCustomer ? 'justify-end' : 'justify-start'} gap-3`}>
      {!isCustomer && (
        <div className="size-9 grid place-items-center bg-accent-soft text-accent-dark rounded-full shrink-0 mt-1">
          <Headphones className="size-4" strokeWidth={2} />
        </div>
      )}
      <div className={`max-w-[80%] ${isCustomer ? 'order-first' : ''}`}>
        <div
          className={`text-caption mb-1 ${isCustomer ? 'text-right' : ''} text-ink-600`}
        >
          <span className="font-medium text-ink-900">
            {isCustomer ? customerName : message.senderName}
          </span>
          {' · '}
          {new Date(message.createdAt).toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
        <div
          className={`px-4 py-3 rounded-2xl whitespace-pre-wrap ${
            isCustomer
              ? 'bg-ink-900 text-white rounded-br-sm'
              : 'bg-white border border-ink-200 text-ink-900 rounded-bl-sm'
          }`}
        >
          {message.body}
        </div>
      </div>
      {isCustomer && (
        <div className="size-9 grid place-items-center bg-ink-100 text-ink-700 rounded-full shrink-0 mt-1">
          <User className="size-4" strokeWidth={2} />
        </div>
      )}
    </li>
  );
}
