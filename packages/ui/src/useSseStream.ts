'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Portal SSE client hook.
 *
 * Subscribes to one of the backend `/portal/streams/*` endpoints over an
 * authenticated EventSource (httpOnly cookies via `withCredentials`). The
 * server emits normalized, client-stable event types (CASE_CREATED,
 * CASE_UPDATED, DISPUTE_MESSAGE_CREATED, TICKET_MESSAGE_CREATED,
 * SLA_BREACH, plus HEARTBEAT) and a redacted, PII-free `data` payload — so
 * the message is a "something changed on resource X" signal the page uses
 * to refetch detail through its normal authenticated REST endpoint.
 *
 * The browser EventSource handles reconnect + Last-Event-Id natively (the
 * backend replays missed events from the outbox on reconnect). We expose
 * `connected` + `lastEventAt` so the UI can show a live / stale indicator.
 *
 * Security: `data` is always JSON-parsed here; never pass it to
 * `dangerouslySetInnerHTML` — treat every field as untrusted text.
 */
export interface SsePortalMessage<T = Record<string, unknown>> {
  type: string;
  data: T;
  lastEventId?: string;
}

export interface UseSseStreamOptions {
  /** Disable the connection (e.g. while unauthenticated). Default true. */
  enabled?: boolean;
  /** API base; defaults to NEXT_PUBLIC_API_URL. */
  apiBase?: string;
  /** Called for every non-heartbeat domain message. */
  onMessage?: (msg: SsePortalMessage) => void;
}

const DOMAIN_EVENT_TYPES = [
  'CASE_CREATED',
  'CASE_UPDATED',
  'DISPUTE_MESSAGE_CREATED',
  'TICKET_MESSAGE_CREATED',
  'QUEUE_ITEM_UPDATED',
  'SLA_BREACH',
  'EARNINGS_UPDATED',
  'PAYOUT_UPDATED',
];

export interface UseSseStreamResult {
  connected: boolean;
  /** Epoch ms of the last frame (domain or heartbeat); null until first. */
  lastEventAt: number | null;
}

export function useSseStream(
  path: string,
  opts: UseSseStreamOptions = {},
): UseSseStreamResult {
  const { enabled = true } = opts;
  const [connected, setConnected] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  const onMessageRef = useRef(opts.onMessage);
  onMessageRef.current = opts.onMessage;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof EventSource === 'undefined') {
      return;
    }
    const base =
      opts.apiBase ??
      (process.env.NEXT_PUBLIC_API_URL as string | undefined) ??
      'http://localhost:8000';
    const url = `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

    const es = new EventSource(url, { withCredentials: true });

    const touch = () => setLastEventAt(Date.now());
    const onOpen = () => setConnected(true);
    const onError = () => setConnected(false); // native EventSource auto-reconnects
    const onDomain = (e: MessageEvent) => {
      touch();
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(e.data);
      } catch {
        /* keep empty on malformed frame */
      }
      onMessageRef.current?.({
        type: e.type,
        data,
        lastEventId: (e as MessageEvent & { lastEventId?: string }).lastEventId,
      });
    };

    es.addEventListener('open', onOpen as EventListener);
    es.onerror = onError;
    es.addEventListener('READY', onOpen as EventListener);
    es.addEventListener('HEARTBEAT', touch as EventListener);
    for (const t of DOMAIN_EVENT_TYPES) {
      es.addEventListener(t, onDomain as EventListener);
    }

    return () => {
      es.close();
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, enabled, opts.apiBase]);

  return { connected, lastEventAt };
}
