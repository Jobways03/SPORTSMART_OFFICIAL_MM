'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Send,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { useModal } from '@sportsmart/ui';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import { useAuthGuard } from '@/lib/useAuthGuard';
import {
  supportService,
  TicketDetail,
  TicketStatus,
  STATUS_LABEL,
  PRIORITY_LABEL,
} from '@/services/support.service';

const STATUS_COLORS: Record<TicketStatus, string> = {
  OPEN: '#0ea5e9',
  IN_PROGRESS: '#f59e0b',
  WAITING_ON_CUSTOMER: '#dc2626',
  RESOLVED: '#16a34a',
  CLOSED: '#6b7280',
};

export default function TicketDetailPage() {
  const authStatus = useAuthGuard();
  const { confirmDialog } = useModal();
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);

  // See admin support page for the same race rationale: while a POST
  // (reply / close) is in flight, skip the background poll's setDetail
  // so a late GET can't overwrite the post-mutation detail.
  const sendingRef = useRef(false);

  const refresh = useCallback(() => {
    setLoading(true);
    supportService
      .getTicket(id)
      .then((res) => {
        if (res.data) setDetail(res.data);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [id]);

  // Silent variant of `refresh` — no spinner toggle, swallows transient
  // errors. Used by the background poll so the customer sees admin
  // replies without having to reload the page.
  const silentRefresh = useCallback(async () => {
    if (sendingRef.current) return;
    try {
      const res = await supportService.getTicket(id);
      if (res.data) setDetail(res.data);
    } catch {
      // Ignore — keep the last good payload visible. Next tick will retry.
    }
  }, [id]);

  useEffect(() => {
    if (authStatus !== 'authed') return;
    refresh();
  }, [authStatus, refresh]);

  // 5s background poll — feels live without hammering the API. Pauses
  // when the tab is hidden; catches up immediately on visibility return.
  useEffect(() => {
    if (authStatus !== 'authed') return;
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
  }, [authStatus, silentRefresh]);

  if (authStatus === 'checking') {
    return (
      <StorefrontShell>
        <div className="container-x py-16 text-center text-ink-600">Loading…</div>
      </StorefrontShell>
    );
  }

  if (loading && !detail) {
    return (
      <StorefrontShell>
        <div className="container-x py-16 flex items-center justify-center text-ink-500">
          <Loader2 className="size-5 animate-spin" />
          <span className="ml-2 text-body">Loading ticket…</span>
        </div>
      </StorefrontShell>
    );
  }

  if (error || !detail) {
    return (
      <StorefrontShell>
        <div className="container-x py-12">
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-body text-red-800">
            <AlertCircle className="size-5 shrink-0" />
            <p>{error ?? 'Ticket not found'}</p>
          </div>
        </div>
      </StorefrontShell>
    );
  }

  const { ticket, messages } = detail;
  const isClosed = ticket.status === 'CLOSED';

  async function send() {
    if (!reply.trim()) return;
    setSending(true);
    sendingRef.current = true;
    try {
      await supportService.reply(id, reply.trim());
      setReply('');
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send reply');
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }

  async function close() {
    const ok = await confirmDialog({
      title: 'Close this ticket?',
      message: 'You can re-open it by replying again.',
      confirmText: 'Close ticket',
      cancelText: 'Keep open',
    });
    if (!ok) return;
    setClosing(true);
    sendingRef.current = true;
    try {
      await supportService.closeTicket(id);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to close ticket');
    } finally {
      setClosing(false);
      sendingRef.current = false;
    }
  }

  return (
    <StorefrontShell>
      <div className="container-x py-8 sm:py-12 max-w-3xl">
        <Link
          href="/account/support"
          className="inline-flex items-center gap-1 text-caption text-ink-600 hover:text-ink-900 mb-4"
        >
          <ArrowLeft className="size-3.5" />
          Back to support
        </Link>

        {/* Header */}
        <div className="bg-white rounded-2xl border border-ink-200 p-5 sm:p-6 mb-4">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span
              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium"
              style={{
                background: STATUS_COLORS[ticket.status] + '15',
                color: STATUS_COLORS[ticket.status],
              }}
            >
              {STATUS_LABEL[ticket.status]}
            </span>
            <code className="text-caption text-ink-500">{ticket.ticketNumber}</code>
            <span className="text-caption text-ink-500">·</span>
            <span className="text-caption text-ink-500">
              Priority {PRIORITY_LABEL[ticket.priority]}
            </span>
          </div>
          <h1 className="font-display text-h2 text-ink-900">{ticket.subject}</h1>
          {(ticket.relatedOrderId || ticket.relatedReturnId) && (
            <p className="text-caption text-ink-500 mt-2">
              Linked to {ticket.relatedOrderId ? 'an order' : 'a return'}.
            </p>
          )}
        </div>

        {/* Thread */}
        <div className="space-y-3 mb-6">
          {messages.map((m) => {
            const isMine = m.senderType !== 'ADMIN';
            return (
              <div
                key={m.id}
                className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    isMine
                      ? 'bg-ink-900 text-white'
                      : 'bg-white border border-ink-200 text-ink-900'
                  }`}
                >
                  <div className="text-caption font-medium mb-1 opacity-80">
                    {m.senderName} {isMine ? '(you)' : '· Sportsmart support'}
                  </div>
                  <div className="text-body whitespace-pre-wrap">{m.body}</div>
                  <div
                    className={`text-[10px] mt-2 ${
                      isMine ? 'text-white/60' : 'text-ink-500'
                    }`}
                  >
                    {new Date(m.createdAt).toLocaleString('en-IN')}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Reply box / closed state */}
        {isClosed ? (
          <div className="rounded-2xl border border-ink-200 bg-ink-50 p-5 text-center">
            <XCircle className="mx-auto size-8 text-ink-400" />
            <p className="text-body text-ink-700 mt-2">
              This ticket is closed. Open a new ticket if you need more help.
            </p>
            <Link
              href="/account/support/new"
              className="inline-block mt-3 text-body font-medium text-accent-dark hover:underline"
            >
              Open a new ticket →
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-ink-200 p-5">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={4}
              maxLength={5000}
              placeholder="Type your reply…"
              className="w-full px-3.5 py-2.5 border border-ink-300 rounded-lg text-body focus:outline-none focus:border-ink-900 resize-y mb-3"
            />
            <div className="flex justify-between items-center">
              <button
                type="button"
                onClick={close}
                disabled={closing}
                className="inline-flex items-center gap-1.5 text-body-sm text-ink-600 hover:text-ink-900 disabled:opacity-50"
              >
                <CheckCircle2 className="size-4" />
                {closing ? 'Closing…' : 'Mark as resolved'}
              </button>
              <button
                onClick={send}
                disabled={sending || !reply.trim()}
                className="inline-flex items-center gap-2 bg-ink-900 text-white px-5 py-2.5 rounded-full text-body font-medium hover:bg-ink-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                {sending ? 'Sending…' : 'Send reply'}
              </button>
            </div>
          </div>
        )}
      </div>
    </StorefrontShell>
  );
}
