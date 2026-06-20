'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, AlertCircle, Loader2, Send } from 'lucide-react';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import { useAuthGuard } from '@/lib/useAuthGuard';
import {
  supportService,
  TicketCategory,
  TicketPriority,
} from '@/services/support.service';
import { validateText } from '@/lib/validators';

const PRIORITY_OPTIONS: TicketPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

function NewTicketContent() {
  const router = useRouter();
  const params = useSearchParams();
  const authStatus = useAuthGuard();

  const presetOrderId = params?.get('orderId') ?? '';
  const presetReturnId = params?.get('returnId') ?? '';

  const [categories, setCategories] = useState<TicketCategory[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('NORMAL');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus !== 'authed') return;
    supportService
      .listCategories()
      .then((res) => res.data && setCategories(res.data))
      .catch(() => {});
  }, [authStatus]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const subjectError = validateText(subject, { label: 'Subject', min: 3, max: 200 });
    if (subjectError) {
      setError(subjectError);
      return;
    }
    const bodyError = validateText(body, { label: 'Description', min: 3, max: 5000 });
    if (bodyError) {
      setError(bodyError);
      return;
    }
    setSubmitting(true);
    try {
      const res = await supportService.createTicket({
        subject: subject.trim(),
        body: body.trim(),
        priority,
        categoryId: categoryId || undefined,
        relatedOrderId: presetOrderId || undefined,
        relatedReturnId: presetReturnId || undefined,
      });
      if (res.data) {
        router.push(`/help/tickets/${res.data.id}`);
      } else {
        setError('Could not create ticket. Please try again.');
        setSubmitting(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create ticket');
      setSubmitting(false);
    }
  };

  if (authStatus === 'checking') {
    return (
      <StorefrontShell>
        <div className="container-x py-16 text-center text-ink-600">Loading…</div>
      </StorefrontShell>
    );
  }

  return (
    <StorefrontShell>
      <div className="container-x py-8 sm:py-12 max-w-2xl">
        <Link
          href="/help/tickets"
          className="inline-flex items-center gap-1.5 text-body text-ink-600 hover:text-ink-900 mb-4"
        >
          <ArrowLeft className="size-4" />
          Back to tickets
        </Link>

        <h1 className="font-display text-h1 text-ink-900">Open a ticket</h1>
        <p className="mt-2 text-body-lg text-ink-600">
          Tell us what's going on. We typically reply within one business day.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-5">
          {(presetOrderId || presetReturnId) && (
            <div className="text-caption text-ink-600 bg-accent-soft/40 border border-accent/30 rounded-2xl px-4 py-3">
              Linked to{' '}
              {presetOrderId ? (
                <span className="font-mono text-ink-900">order {presetOrderId.slice(0, 8)}…</span>
              ) : null}
              {presetReturnId ? (
                <span className="font-mono text-ink-900">return {presetReturnId.slice(0, 8)}…</span>
              ) : null}
            </div>
          )}

          <div>
            <label htmlFor="subject" className="block text-caption uppercase tracking-wider font-semibold text-ink-700 mb-2">
              Subject
            </label>
            <input
              id="subject"
              type="text"
              maxLength={200}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={submitting}
              placeholder="e.g. Order arrived damaged"
              className="w-full h-12 px-4 border border-ink-300 hover:border-ink-500 focus:border-ink-900 bg-white text-body-lg focus:outline-none transition-colors rounded-full"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="category" className="block text-caption uppercase tracking-wider font-semibold text-ink-700 mb-2">
                Category
              </label>
              <select
                id="category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                disabled={submitting || categories.length === 0}
                className="w-full h-12 px-4 border border-ink-300 hover:border-ink-500 focus:border-ink-900 bg-white text-body focus:outline-none transition-colors rounded-full"
              >
                <option value="">Choose a category…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="priority" className="block text-caption uppercase tracking-wider font-semibold text-ink-700 mb-2">
                Priority
              </label>
              <select
                id="priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
                disabled={submitting}
                className="w-full h-12 px-4 border border-ink-300 hover:border-ink-500 focus:border-ink-900 bg-white text-body focus:outline-none transition-colors rounded-full"
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p.charAt(0) + p.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="body" className="block text-caption uppercase tracking-wider font-semibold text-ink-700 mb-2">
              Describe the issue
            </label>
            <textarea
              id="body"
              maxLength={5000}
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={submitting}
              placeholder="Share what happened, what you expected, and any details that might help us resolve it quickly."
              className="w-full px-4 py-3 border border-ink-300 hover:border-ink-500 focus:border-ink-900 bg-white text-body focus:outline-none transition-colors rounded-2xl resize-y min-h-[160px]"
            />
            <p className="mt-1 text-caption text-ink-500 text-right tabular">
              {body.length} / 5000
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 p-3 border border-danger/30 bg-red-50 text-danger text-body rounded-2xl"
            >
              <AlertCircle className="size-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Link
              href="/help/tickets"
              className="inline-flex items-center justify-center h-12 px-5 border border-ink-300 hover:border-ink-900 text-body font-medium text-ink-900 rounded-full transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting}
              aria-busy={submitting}
              className="inline-flex items-center justify-center gap-2 h-12 px-6 bg-ink-900 text-white font-semibold hover:bg-ink-800 disabled:opacity-50 rounded-full transition-colors"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Submitting…
                </>
              ) : (
                <>
                  <Send className="size-4" />
                  Submit ticket
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </StorefrontShell>
  );
}

export default function NewTicketPage() {
  return (
    <Suspense
      fallback={
        <StorefrontShell>
          <div className="container-x py-16 text-center text-ink-600">Loading…</div>
        </StorefrontShell>
      }
    >
      <NewTicketContent />
    </Suspense>
  );
}
