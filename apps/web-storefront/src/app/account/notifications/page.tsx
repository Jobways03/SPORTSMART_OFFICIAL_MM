'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, AlertCircle, Check, Loader2, Lock } from 'lucide-react';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import { useAuthGuard } from '@/lib/useAuthGuard';
import {
  notificationPreferencesService,
  PreferenceEntry,
  NotificationChannel,
  EVENT_CLASS_LABEL,
  CHANNEL_LABEL,
} from '@/services/notification-preferences.service';

export default function NotificationPreferencesPage() {
  const authStatus = useAuthGuard();
  const [entries, setEntries] = useState<PreferenceEntry[]>([]);
  const [eventClasses, setEventClasses] = useState<string[]>([]);
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (authStatus !== 'authed') return;
    setLoading(true);
    notificationPreferencesService
      .list()
      .then((res) => {
        if (res.data) {
          setEntries(res.data.preferences);
          setEventClasses(res.data.eventClasses);
          setChannels(res.data.channels);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [authStatus]);

  const cellOf = (eventClass: string, channel: NotificationChannel) =>
    entries.find((e) => e.eventClass === eventClass && e.channel === channel);
  const isEnabled = (eventClass: string, channel: NotificationChannel) =>
    cellOf(eventClass, channel)?.enabled ?? true;
  const isLocked = (eventClass: string) =>
    entries.find((e) => e.eventClass === eventClass)?.locked ?? false;

  const toggle = (eventClass: string, channel: NotificationChannel) => {
    if (isLocked(eventClass)) return; // #1 — locked classes can't be muted
    const current = isEnabled(eventClass, channel);
    setEntries((prev) => {
      const existing = prev.find((e) => e.eventClass === eventClass && e.channel === channel);
      const filtered = prev.filter(
        (e) => !(e.eventClass === eventClass && e.channel === channel),
      );
      return [...filtered, { ...existing, eventClass, channel, enabled: !current }];
    });
    setSavedAt(null);
  };

  // #16 — one-click "mute everything I'm allowed to mute".
  const muteAll = async () => {
    setSaving(true);
    setError(null);
    try {
      await notificationPreferencesService.optOutAll();
      const res = await notificationPreferencesService.list();
      if (res.data) setEntries(res.data.preferences);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not opt out');
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await notificationPreferencesService.update(entries);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save preferences');
    } finally {
      setSaving(false);
    }
  };

  if (authStatus === 'checking' || loading) {
    return (
      <StorefrontShell>
        <div className="container-x py-16 text-center text-ink-600">Loading…</div>
      </StorefrontShell>
    );
  }

  return (
    <StorefrontShell>
      <div className="container-x py-8 sm:py-12 max-w-3xl">
        <nav className="text-caption text-ink-600 mb-4">
          <Link href="/account" className="hover:text-ink-900">My Account</Link>
          <span className="mx-2">›</span>
          <span className="text-ink-900 font-medium">Notifications</span>
        </nav>

        <div className="flex items-start gap-3 mb-6">
          <div className="size-10 grid place-items-center bg-accent-soft text-accent-dark rounded-2xl shrink-0">
            <Bell className="size-5" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="font-display text-h1 text-ink-900">Notifications</h1>
            <p className="mt-1 text-body-lg text-ink-600">
              Choose what we contact you about and where.
            </p>
          </div>
        </div>

        {error && (
          <div role="alert" className="mb-4 flex items-start gap-2 p-3 border border-danger/30 bg-red-50 text-danger text-body rounded-2xl">
            <AlertCircle className="size-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="bg-white border border-ink-200 rounded-2xl overflow-hidden">
          {eventClasses.map((eventClass, idx) => {
            const meta = EVENT_CLASS_LABEL[eventClass] ?? { title: eventClass, desc: '' };
            const locked = isLocked(eventClass);
            return (
              <div
                key={eventClass}
                className={`p-5 ${idx > 0 ? 'border-t border-ink-100' : ''}`}
              >
                <div className="mb-3 flex items-center gap-2">
                  <div>
                    <h3 className="text-body-lg font-semibold text-ink-900">{meta.title}</h3>
                    {meta.desc && (
                      <p className="text-caption text-ink-600 mt-0.5">{meta.desc}</p>
                    )}
                  </div>
                  {locked && (
                    <span className="ml-auto inline-flex items-center gap-1 text-caption text-ink-500 bg-ink-100 px-2 py-1 rounded-full">
                      <Lock className="size-3" strokeWidth={2} /> Always on
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-3">
                  {channels.map((channel) => {
                    const enabled = isEnabled(eventClass, channel);
                    return (
                      <button
                        key={channel}
                        type="button"
                        onClick={() => toggle(eventClass, channel)}
                        aria-pressed={enabled}
                        disabled={locked}
                        className={`inline-flex items-center gap-2 h-10 px-4 border rounded-full text-body font-medium transition-colors ${
                          locked
                            ? 'bg-ink-100 text-ink-400 border-ink-200 cursor-not-allowed'
                            : enabled
                              ? 'bg-ink-900 text-white border-ink-900 hover:bg-ink-800'
                              : 'bg-white text-ink-700 border-ink-300 hover:border-ink-900'
                        }`}
                      >
                        {enabled && <Check className="size-3.5" strokeWidth={2.5} />}
                        {CHANNEL_LABEL[channel]}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={muteAll}
            disabled={saving}
            className="text-caption text-ink-600 underline hover:text-ink-900 disabled:opacity-50"
          >
            Mute all non-critical notifications
          </button>
          <div className="flex items-center gap-3">
            {savedAt && (
              <span className="inline-flex items-center gap-1.5 text-success text-caption">
                <Check className="size-4" strokeWidth={2.5} />
                Saved
              </span>
            )}
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 h-12 px-6 bg-ink-900 text-white font-semibold hover:bg-ink-800 disabled:opacity-50 rounded-full transition-colors"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save preferences'
              )}
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-2 text-caption text-ink-500">
          <p>
            <span className="font-semibold text-ink-700">WhatsApp:</span> you can also
            stop receiving messages instantly by replying <span className="font-mono">STOP</span> to any
            SPORTSMART WhatsApp message. Reply <span className="font-mono">START</span> to opt back in.
          </p>
          <p>
            Transactional alerts (payment confirmations, OTPs, refunds) are always
            sent for security and compliance, even if the channel toggle is off.
          </p>
        </div>
      </div>
    </StorefrontShell>
  );
}
