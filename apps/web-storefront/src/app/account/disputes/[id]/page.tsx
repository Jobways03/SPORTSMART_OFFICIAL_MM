'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Send, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import { useAuthGuard } from '@/lib/useAuthGuard';
import {
  disputesService,
  DisputeDetail,
  DisputeMessage,
  STATUS_LABEL,
  KIND_LABEL,
} from '@/services/disputes.service';

export default function DisputeThreadPage() {
  const { id } = useParams<{ id: string }>();
  const authStatus = useAuthGuard();
  const [detail, setDetail] = useState<DisputeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await disputesService.get(id);
      if (res.data) setDetail(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (authStatus !== 'authed') return;
    refresh();
  }, [authStatus, refresh]);

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim() || sending) return;
    setSending(true);
    try {
      await disputesService.reply(id, reply.trim());
      setReply('');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send reply');
    } finally {
      setSending(false);
    }
  };

  if (authStatus === 'checking' || loading && !detail) {
    return <StorefrontShell><div className="container-x py-16 text-center text-ink-600">Loading dispute…</div></StorefrontShell>;
  }
  if (!detail) return (
    <StorefrontShell>
      <div className="container-x py-16 text-center max-w-xl">
        <h2 className="font-display text-h2 text-ink-900">Dispute not found</h2>
        <Link href="/account/disputes" className="mt-4 inline-flex items-center gap-2 h-11 px-5 bg-ink-900 text-white font-semibold hover:bg-ink-800 rounded-full transition-colors">
          Back to disputes
        </Link>
      </div>
    </StorefrontShell>
  );

  const isResolved = detail.status.startsWith('RESOLVED_') || detail.status === 'CLOSED';

  return (
    <StorefrontShell>
      <div className="container-x py-8 sm:py-12 max-w-3xl">
        <Link href="/account/disputes" className="inline-flex items-center gap-1.5 text-body text-ink-600 hover:text-ink-900 mb-4">
          <ArrowLeft className="size-4" />
          Back to disputes
        </Link>

        <div className="bg-white border border-ink-200 rounded-2xl p-5 sm:p-6 mb-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-caption text-ink-500 font-mono uppercase tracking-wider">{detail.disputeNumber}</span>
            <span className="inline-flex items-center h-5 px-2 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-accent-soft text-accent-dark">
              {STATUS_LABEL[detail.status]}
            </span>
            <span className="inline-flex items-center h-5 px-2 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-ink-100 text-ink-700">
              {KIND_LABEL[detail.kind]}
            </span>
          </div>
          <p className="text-body text-ink-900 whitespace-pre-wrap">{detail.summary}</p>
          <p className="mt-3 text-caption text-ink-600">
            Filed {new Date(detail.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>

        {detail.decisionRationale && (
          <div className="bg-accent-soft/40 border border-accent/30 rounded-2xl p-4 mb-5">
            <div className="flex items-start gap-2 mb-2">
              <CheckCircle2 className="size-5 text-accent-dark mt-0.5 shrink-0" strokeWidth={2} />
              <h3 className="font-semibold text-ink-900">Decision: {STATUS_LABEL[detail.status]}</h3>
            </div>
            <p className="text-body text-ink-900 whitespace-pre-wrap">{detail.decisionRationale}</p>
            {detail.decisionAt && (
              <p className="mt-2 text-caption text-ink-600">
                {new Date(detail.decisionAt).toLocaleString('en-IN')}
              </p>
            )}
          </div>
        )}

        <ul className="space-y-3 mb-6">
          {detail.messages.map((m) => <Bubble key={m.id} message={m} filerName={detail.filedByName} />)}
        </ul>

        {isResolved ? (
          <div className="bg-ink-50 border border-ink-200 rounded-2xl p-5 text-center text-body text-ink-600">
            This dispute is closed.
          </div>
        ) : (
          <form onSubmit={sendReply} className="bg-white border border-ink-200 rounded-2xl p-4 sm:p-5">
            <textarea
              maxLength={5000} rows={4} value={reply} onChange={(e) => setReply(e.target.value)} disabled={sending}
              placeholder="Add more detail or respond to the admin…"
              className="w-full px-4 py-3 border border-ink-300 focus:border-ink-900 bg-white text-body focus:outline-none transition-colors rounded-2xl resize-y min-h-[100px]"
            />
            {error && (
              <div role="alert" className="mt-3 flex items-start gap-2 p-2.5 border border-danger/30 bg-red-50 text-danger text-caption rounded-xl">
                <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                {error}
              </div>
            )}
            <div className="mt-3 flex justify-end">
              <button type="submit" disabled={!reply.trim() || sending}
                className="inline-flex items-center gap-2 h-10 px-5 bg-ink-900 text-white font-semibold hover:bg-ink-800 disabled:opacity-50 rounded-full transition-colors">
                {sending ? <><Loader2 className="size-4 animate-spin" />Sending…</> : <><Send className="size-4" />Send</>}
              </button>
            </div>
          </form>
        )}
      </div>
    </StorefrontShell>
  );
}

function Bubble({ message, filerName }: { message: DisputeMessage; filerName: string }) {
  const isMine = message.senderType === 'CUSTOMER';
  return (
    <li className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%]`}>
        <div className={`text-caption mb-1 ${isMine ? 'text-right' : ''} text-ink-600`}>
          <span className="font-medium text-ink-900">{isMine ? filerName : message.senderName}</span>
          {' · '}
          {new Date(message.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </div>
        <div className={`px-4 py-3 rounded-2xl whitespace-pre-wrap ${
          isMine ? 'bg-ink-900 text-white rounded-br-sm' : 'bg-white border border-ink-200 text-ink-900 rounded-bl-sm'
        }`}>
          {message.body}
        </div>
      </div>
    </li>
  );
}
