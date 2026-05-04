'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, AlertCircle, Loader2 } from 'lucide-react';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import { useAuthGuard } from '@/lib/useAuthGuard';
import {
  supportService,
  TicketCategory,
  TicketPriority,
  PRIORITY_LABEL,
} from '@/services/support.service';

export default function NewTicketPage() {
  const router = useRouter();
  const params = useSearchParams();
  const orderId = params.get('orderId') ?? undefined;
  const returnId = params.get('returnId') ?? undefined;

  const authStatus = useAuthGuard();
  const [categories, setCategories] = useState<TicketCategory[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [priority, setPriority] = useState<TicketPriority>('NORMAL');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus !== 'authed') return;
    supportService
      .listCategories()
      .then((res) => {
        if (res.data) setCategories(res.data);
      })
      .catch(() => undefined);
  }, [authStatus]);

  if (authStatus === 'checking') {
    return (
      <StorefrontShell>
        <div className="container-x py-16 text-center text-ink-600">Loading…</div>
      </StorefrontShell>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!subject.trim() || !body.trim()) {
      setError('Subject and message are required.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await supportService.createTicket({
        subject: subject.trim(),
        body: body.trim(),
        categoryId: categoryId || undefined,
        priority,
        relatedOrderId: orderId,
        relatedReturnId: returnId,
      });
      if (res.data?.id) {
        router.push(`/account/support/${res.data.id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create ticket');
      setSubmitting(false);
    }
  }

  return (
    <StorefrontShell>
      <div className="container-x py-8 sm:py-12 max-w-2xl">
        <Link
          href="/account/support"
          className="inline-flex items-center gap-1 text-caption text-ink-600 hover:text-ink-900 mb-4"
        >
          <ArrowLeft className="size-3.5" />
          Back to support
        </Link>

        <h1 className="font-display text-h1 text-ink-900 mb-2">Open a ticket</h1>
        <p className="text-body text-ink-600 mb-6">
          Tell us what's happening — the more detail, the faster we can help.
        </p>

        {(orderId || returnId) && (
          <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-body-sm text-blue-900">
            Linking this ticket to your {orderId ? 'order' : 'return'}.
          </div>
        )}

        <form onSubmit={submit} className="bg-white rounded-2xl border border-ink-200 p-6 space-y-5">
          <div>
            <label className="block text-body font-medium text-ink-900 mb-1.5">
              Subject<span className="text-sale">*</span>
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              placeholder="e.g. Order #SM-2026-001234 hasn't arrived"
              className="w-full px-3.5 py-2.5 border border-ink-300 rounded-lg text-body focus:outline-none focus:border-ink-900"
              required
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-body font-medium text-ink-900 mb-1.5">
                Category
              </label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-ink-300 rounded-lg text-body bg-white focus:outline-none focus:border-ink-900"
              >
                <option value="">— Select —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-body font-medium text-ink-900 mb-1.5">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
                className="w-full px-3.5 py-2.5 border border-ink-300 rounded-lg text-body bg-white focus:outline-none focus:border-ink-900"
              >
                {(['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-body font-medium text-ink-900 mb-1.5">
              Message<span className="text-sale">*</span>
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              maxLength={5000}
              placeholder="What's the problem? Include order numbers, dates, and any error messages."
              className="w-full px-3.5 py-2.5 border border-ink-300 rounded-lg text-body focus:outline-none focus:border-ink-900 resize-y"
              required
            />
            <div className="text-caption text-ink-500 mt-1 text-right">
              {body.length} / 5000
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-body-sm text-red-800">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Link
              href="/account/support"
              className="px-5 py-2.5 text-body font-medium text-ink-700 hover:text-ink-900"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting || !subject.trim() || !body.trim()}
              className="inline-flex items-center gap-2 bg-ink-900 text-white px-5 py-2.5 rounded-full text-body font-medium hover:bg-ink-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {submitting ? 'Sending…' : 'Submit ticket'}
            </button>
          </div>
        </form>
      </div>
    </StorefrontShell>
  );
}
