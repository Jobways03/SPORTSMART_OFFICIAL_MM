'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  sellerDisputesService,
  DisputeDetail,
  DisputeMessage,
  DisputeEvidence,
  STATUS_COLOR,
  STATUS_LABEL,
  KIND_LABEL,
} from '@/services/disputes.service';
import { ApiError } from '@/lib/api-client';

const fmt = (iso: string | null | undefined) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
};

export default function SellerDisputeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [dispute, setDispute] = useState<DisputeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  // Tracks the last manually-submitted reply id so the silent refresh below
  // doesn't reset the textarea while the user is still typing.
  const lastSentRef = useRef<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!id) return;
      if (!silent) setLoading(true);
      setError('');
      try {
        const res = await sellerDisputesService.get(id);
        if (res.data) setDispute(res.data);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace('/login');
          return;
        }
        if (err instanceof ApiError && err.status === 404) {
          setError('Dispute not found or you do not have access to it.');
          return;
        }
        setError(
          err instanceof ApiError
            ? err.body?.message || 'Failed to load dispute'
            : 'Failed to load dispute',
        );
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [id, router],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Refresh every 30s so a new admin message / decision appears without F5.
  useEffect(() => {
    const t = setInterval(() => load(true), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const onSendReply = async () => {
    const body = reply.trim();
    if (!body || sending || !id) return;
    setSending(true);
    try {
      const res = await sellerDisputesService.reply(id, body);
      if (res.data) {
        lastSentRef.current = res.data.id;
        setReply('');
        await load(true);
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.body?.message || 'Failed to send reply'
          : 'Failed to send reply',
      );
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: '#6b7280' }}>
        Loading dispute…
      </div>
    );
  }

  if (error && !dispute) {
    return (
      <div>
        <Link
          href="/dashboard/disputes"
          style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}
        >
          ← Back to disputes
        </Link>
        <div
          style={{
            marginTop: 20,
            background: '#fee2e2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            borderRadius: 8,
            padding: '14px 16px',
            fontSize: 14,
          }}
        >
          {error}
        </div>
      </div>
    );
  }

  if (!dispute) return null;

  const color = STATUS_COLOR[dispute.status];
  const filedByYou = dispute.filedByType === 'SELLER';
  const isClosed =
    dispute.status === 'CLOSED' ||
    dispute.status.startsWith('RESOLVED_');

  return (
    <div>
      <Link
        href="/dashboard/disputes"
        style={{
          fontSize: 13,
          color: '#2563eb',
          textDecoration: 'none',
          marginBottom: 16,
          display: 'inline-block',
        }}
      >
        ← Back to disputes
      </Link>

      {/* Header */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          padding: '20px 24px',
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: '1 1 auto', minWidth: 260 }}>
            <div
              style={{
                fontFamily: 'ui-monospace, monospace',
                fontSize: 12,
                color: '#6b7280',
                marginBottom: 6,
              }}
            >
              {dispute.disputeNumber}
            </div>
            <h1
              style={{
                fontSize: 20,
                fontWeight: 700,
                margin: 0,
                color: '#111827',
                lineHeight: 1.35,
              }}
            >
              {dispute.summary}
            </h1>
            <div
              style={{
                marginTop: 10,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                fontSize: 12,
                color: '#6b7280',
              }}
            >
              <span>
                <strong style={{ color: '#374151' }}>Kind:</strong>{' '}
                {KIND_LABEL[dispute.kind]}
              </span>
              <span>•</span>
              <span>
                <strong style={{ color: '#374151' }}>Filed by:</strong>{' '}
                {dispute.filedByName} ({filedByYou ? 'You' : dispute.filedByType.toLowerCase()})
              </span>
              <span>•</span>
              <span>
                <strong style={{ color: '#374151' }}>Created:</strong>{' '}
                {fmt(dispute.createdAt)}
              </span>
            </div>
          </div>

          <span
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              background: color.bg,
              color: color.fg,
              whiteSpace: 'nowrap',
            }}
          >
            {STATUS_LABEL[dispute.status]}
          </span>
        </div>

        {/* Related anchors */}
        {(dispute.masterOrderId ||
          dispute.subOrderId ||
          dispute.returnId) && (
          <div
            style={{
              marginTop: 14,
              paddingTop: 14,
              borderTop: '1px dashed #e5e7eb',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 16,
              fontSize: 12,
            }}
          >
            {dispute.subOrderId && (
              <Link
                href={`/dashboard/orders/${dispute.subOrderId}`}
                style={{ color: '#2563eb', textDecoration: 'none' }}
              >
                → View linked order
              </Link>
            )}
            {dispute.returnId && (
              <Link
                href={`/dashboard/returns/${dispute.returnId}`}
                style={{ color: '#2563eb', textDecoration: 'none' }}
              >
                → View linked return
              </Link>
            )}
          </div>
        )}

        {/* Decision band — only present once admin has decided */}
        {dispute.decisionAt && (
          <div
            style={{
              marginTop: 14,
              padding: '12px 14px',
              background: '#f9fafb',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              fontSize: 13,
            }}
          >
            <div
              style={{
                fontWeight: 600,
                color: '#111827',
                marginBottom: 4,
              }}
            >
              Admin decision · {fmt(dispute.decisionAt)}
            </div>
            {dispute.decisionRationale && (
              <div style={{ color: '#374151', whiteSpace: 'pre-wrap' }}>
                {dispute.decisionRationale}
              </div>
            )}
            {(dispute.liabilityParty || dispute.customerRemedy) && (
              <div
                style={{
                  marginTop: 8,
                  display: 'flex',
                  gap: 14,
                  flexWrap: 'wrap',
                  fontSize: 12,
                  color: '#6b7280',
                }}
              >
                {dispute.liabilityParty && (
                  <span>
                    <strong style={{ color: '#374151' }}>Liability:</strong>{' '}
                    {dispute.liabilityParty.toLowerCase()}
                  </span>
                )}
                {dispute.customerRemedy && (
                  <span>
                    <strong style={{ color: '#374151' }}>Remedy:</strong>{' '}
                    {dispute.customerRemedy.toLowerCase().replace(/_/g, ' ')}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Messages thread */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          padding: '20px 24px',
          marginBottom: 16,
        }}
      >
        <h2
          style={{
            fontSize: 14,
            fontWeight: 700,
            marginTop: 0,
            marginBottom: 14,
            color: '#374151',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Conversation
        </h2>

        {dispute.messages.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: 'center',
              color: '#9ca3af',
              fontSize: 13,
              background: '#f9fafb',
              borderRadius: 8,
            }}
          >
            No messages yet. Use the box below to respond.
          </div>
        ) : (
          <ol
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {dispute.messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
          </ol>
        )}

        {/* Reply form */}
        {!isClosed && (
          <div style={{ marginTop: 18 }}>
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Write a reply to the admin or customer…"
              rows={3}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: 14,
                border: '1px solid #d1d5db',
                borderRadius: 6,
                background: '#fff',
                resize: 'vertical',
                boxSizing: 'border-box',
                fontFamily: 'inherit',
                color: '#111827',
              }}
              disabled={sending}
            />
            <div
              style={{
                marginTop: 8,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 12,
                color: '#6b7280',
              }}
            >
              <span>
                Tip: keep replies factual. Admin reads both sides before
                deciding.
              </span>
              <button
                onClick={onSendReply}
                disabled={!reply.trim() || sending}
                style={{
                  padding: '8px 18px',
                  fontSize: 13,
                  fontWeight: 600,
                  background: !reply.trim() || sending ? '#9ca3af' : '#2563eb',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: !reply.trim() || sending ? 'not-allowed' : 'pointer',
                }}
              >
                {sending ? 'Sending…' : 'Send reply'}
              </button>
            </div>
            {error && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: '#991b1b',
                }}
              >
                {error}
              </div>
            )}
          </div>
        )}

        {isClosed && (
          <div
            style={{
              marginTop: 16,
              padding: '10px 14px',
              background: '#f9fafb',
              border: '1px dashed #d1d5db',
              borderRadius: 8,
              fontSize: 12,
              color: '#6b7280',
              textAlign: 'center',
            }}
          >
            This dispute is closed. Replies are disabled.
          </div>
        )}
      </div>

      {/* Evidence list */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          padding: '20px 24px',
        }}
      >
        <h2
          style={{
            fontSize: 14,
            fontWeight: 700,
            marginTop: 0,
            marginBottom: 14,
            color: '#374151',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Evidence ({dispute.evidence.length})
        </h2>
        {dispute.evidence.length === 0 ? (
          <div
            style={{
              padding: 18,
              textAlign: 'center',
              color: '#9ca3af',
              fontSize: 13,
              background: '#f9fafb',
              borderRadius: 8,
            }}
          >
            No evidence attached yet.
          </div>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {dispute.evidence.map((e) => (
              <EvidenceRow key={e.id} evidence={e} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: DisputeMessage }) {
  const isAdmin = message.senderType === 'ADMIN';
  const isSelf = message.senderType === 'SELLER';
  const align: 'flex-start' | 'flex-end' = isSelf ? 'flex-end' : 'flex-start';
  const bg = isAdmin ? '#eff6ff' : isSelf ? '#ecfdf5' : '#f9fafb';
  const border = isAdmin ? '#bfdbfe' : isSelf ? '#bbf7d0' : '#e5e7eb';
  const senderLabel = isAdmin
    ? 'Admin'
    : isSelf
      ? 'You'
      : message.senderName || 'Customer';

  return (
    <li
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: align,
      }}
    >
      <div
        style={{
          maxWidth: '78%',
          padding: '10px 14px',
          background: bg,
          border: `1px solid ${border}`,
          borderRadius: 10,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            fontSize: 11,
            color: '#6b7280',
            marginBottom: 4,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.03em',
          }}
        >
          <span>{senderLabel}</span>
          <span style={{ fontWeight: 500, textTransform: 'none' }}>
            {fmt(message.createdAt)}
          </span>
        </div>
        <div
          style={{
            fontSize: 13.5,
            color: '#111827',
            whiteSpace: 'pre-wrap',
            lineHeight: 1.5,
          }}
        >
          {message.body}
        </div>
      </div>
    </li>
  );
}

function EvidenceRow({ evidence }: { evidence: DisputeEvidence }) {
  return (
    <li
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        padding: '8px 12px',
        background: '#f9fafb',
        border: '1px solid #e5e7eb',
        borderRadius: 6,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#6b7280',
          textTransform: 'uppercase',
        }}
      >
        {evidence.uploadedByType.toLowerCase()}
      </span>
      <span
        style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: 11,
          color: '#6b7280',
          flex: '1 1 auto',
        }}
      >
        File {evidence.fileId.slice(0, 8)}…
      </span>
      {evidence.caption && (
        <span style={{ fontSize: 12, color: '#374151', flex: '0 1 60%' }}>
          {evidence.caption}
        </span>
      )}
      <span style={{ fontSize: 11, color: '#9ca3af' }}>
        {fmt(evidence.uploadedAt)}
      </span>
    </li>
  );
}
