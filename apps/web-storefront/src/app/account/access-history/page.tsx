'use client';

import { useEffect, useState } from 'react';
import { Shield, AlertCircle, Loader2, Monitor, MapPin } from 'lucide-react';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import { useAuthGuard } from '@/lib/useAuthGuard';
import {
  accessHistoryService,
  AccessLogEntry,
  KIND_LABEL,
  KIND_COLOR,
  maskIp,
} from '@/services/access-history.service';

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

function browserOf(ua: string | null): string {
  if (!ua) return 'Unknown browser';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
  if (/Firefox\//.test(ua)) return 'Firefox';
  return 'Browser';
}

export default function AccessHistoryPage() {
  const authStatus = useAuthGuard();
  const [items, setItems] = useState<AccessLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus !== 'authed') return;
    setLoading(true);
    accessHistoryService
      .list(100)
      .then((res) => {
        if (res.data) setItems(res.data.items);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [authStatus]);

  if (authStatus === 'checking') {
    return (
      <StorefrontShell>
        <div className="mx-auto max-w-3xl px-4 py-16 text-center text-gray-500">
          Loading…
        </div>
      </StorefrontShell>
    );
  }

  return (
    <StorefrontShell>
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-8 flex items-center gap-3">
          <div className="rounded-full bg-blue-50 p-3 text-blue-600">
            <Shield className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Access history</h1>
            <p className="text-sm text-gray-600">
              The last 100 sign-in events on your account. Spot anything you don't recognise?{' '}
              <a href="/account/profile" className="text-blue-600 hover:underline">
                Change your password
              </a>
              .
            </p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="ml-2 text-sm">Loading history...</span>
          </div>
        )}

        {error && (
          <div className="mb-6 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
            <Shield className="mx-auto h-10 w-10 text-gray-400" />
            <p className="mt-4 text-sm text-gray-600">
              No sign-in history yet. After your next sign-in this page will start tracking
              activity.
            </p>
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <>
          {/* Mobile: stacked cards — a 4-column table can't fit a phone
              without clipping columns or forcing page-level horizontal scroll. */}
          <ul className="space-y-3 sm:hidden">
            {items.map((it) => (
              <li key={it.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                    style={{ background: KIND_COLOR[it.kind] + '15', color: KIND_COLOR[it.kind] }}
                  >
                    {KIND_LABEL[it.kind] ?? it.kind}
                  </span>
                  <span className="shrink-0 text-xs text-gray-500">{timeAgo(it.createdAt)}</span>
                </div>
                {it.newDevice && (
                  <span className="mt-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                    New device
                  </span>
                )}
                {!it.succeeded && (
                  <p className="mt-1 text-xs text-gray-500">This sign-in attempt did not succeed.</p>
                )}
                <div className="mt-3 flex flex-col gap-1.5 text-sm text-gray-700">
                  <div className="flex items-center gap-1.5">
                    <Monitor className="h-3.5 w-3.5 text-gray-400" />
                    {browserOf(it.userAgent)}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-gray-400" />
                    <code className="text-xs">{maskIp(it.ipAddress)}</code>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {/* sm+ : the full table, scroll-wrapped so wide content scrolls
              instead of clipping. */}
          <div className="hidden sm:block overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-left">Event</th>
                  <th className="px-4 py-3 text-left">Device</th>
                  <th className="px-4 py-3 text-left">IP</th>
                  <th className="px-4 py-3 text-left">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((it) => (
                  <tr key={it.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                        style={{
                          background: KIND_COLOR[it.kind] + '15',
                          color: KIND_COLOR[it.kind],
                        }}
                      >
                        {KIND_LABEL[it.kind] ?? it.kind}
                      </span>
                      {/* Phase 201 (#10) — new-device sign-ins are badged on
                          the success row itself instead of a duplicate
                          NEW_DEVICE_DETECTED row. */}
                      {it.newDevice && (
                        <span className="ml-1.5 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                          New device
                        </span>
                      )}
                      {!it.succeeded && (
                        <p className="mt-1 text-xs text-gray-500">
                          This sign-in attempt did not succeed.
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      <div className="flex items-center gap-1.5">
                        <Monitor className="h-3.5 w-3.5 text-gray-400" />
                        {browserOf(it.userAgent)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-gray-400" />
                        {/* Phase 201 (#19) — host octets masked for privacy;
                            the full IP is retained server-side only. */}
                        <code className="text-xs">{maskIp(it.ipAddress)}</code>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{timeAgo(it.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </StorefrontShell>
  );
}
