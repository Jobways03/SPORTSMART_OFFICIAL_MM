'use client';

import { useState } from 'react';
import { apiClient } from '@/lib/api-client';

/**
 * Phase 193 (#15) — "Notify me when back in stock" capture, shown on the PDP
 * when the product/variant is out of stock. Gives the visitor a conversion
 * path instead of a dead end; the back-in-stock cron emails them on restock.
 */
export function NotifyWhenAvailable({ slug }: { slug: string }) {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiClient(`/storefront/products/${encodeURIComponent(slug)}/notify-when-available`, {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not register your request');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <p className="mt-3 text-body text-success">
        Thanks — we&apos;ll email you when this is back in stock.
      </p>
    );
  }

  return (
    <div className="mt-4">
      <p className="text-body text-ink-600 mb-2">Out of stock — get notified when it returns:</p>
      <div className="flex gap-2 max-w-sm">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          className="flex-1 h-11 px-3 border border-ink-300 focus:border-ink-900 focus:outline-none rounded-full text-body"
        />
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !email.trim()}
          className="h-11 px-5 bg-ink-900 text-white font-medium hover:bg-ink-800 disabled:opacity-50 rounded-full whitespace-nowrap"
        >
          {submitting ? 'Saving…' : 'Notify me'}
        </button>
      </div>
      {error && <p className="mt-2 text-caption text-danger">{error}</p>}
    </div>
  );
}
