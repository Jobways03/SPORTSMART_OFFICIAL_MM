'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  sellerSupportService,
  TicketCategory,
  TicketPriority,
} from '@/services/support.service';
import { validateText } from '@/lib/validators';

const PRIORITIES: TicketPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

export default function NewSellerTicketPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<TicketCategory[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('NORMAL');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    sellerSupportService
      .listCategories()
      .then((res) => res.data && setCategories(res.data))
      .catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const subjectErr = validateText(subject, { min: 5, max: 200, label: 'Subject' });
    if (subjectErr) return setError(subjectErr);
    const bodyErr = validateText(body, { min: 15, max: 5000, label: 'Description' });
    if (bodyErr) return setError(bodyErr);
    setSubmitting(true);
    try {
      const res = await sellerSupportService.createTicket({
        subject: subject.trim(),
        body: body.trim(),
        priority,
        categoryId: categoryId || undefined,
      });
      if (res.data) router.push(`/dashboard/support/${res.data.id}`);
      else setError('Could not create ticket');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create ticket');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: 720 }}>
      <Link href="/dashboard/support" style={{ color: '#525A65', fontSize: 13, textDecoration: 'none', display: 'inline-block', marginBottom: 12 }}>
        ← Back to support
      </Link>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#0F1115' }}>Open a ticket</h1>
      <p style={{ marginTop: 4, fontSize: 14, color: '#525A65' }}>
        We typically reply within one business day.
      </p>

      <form onSubmit={submit} style={{ marginTop: 24, background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, padding: 20 }}>
        <Field label="Subject">
          <input
            type="text" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} disabled={submitting}
            placeholder="e.g. Question about commission calculation" style={input}
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Category">
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={submitting || categories.length === 0} style={input}>
              <option value="">Choose a category…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)} disabled={submitting} style={input}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</option>)}
            </select>
          </Field>
        </div>

        <Field label={`Describe the issue  (${body.length}/5000)`}>
          <textarea
            maxLength={5000} rows={6} value={body} onChange={(e) => setBody(e.target.value)} disabled={submitting}
            placeholder="Share what happened and any details that might help us resolve it quickly."
            style={{ ...input, height: 'auto', padding: 12, borderRadius: 12, resize: 'vertical', minHeight: 140, fontFamily: 'inherit' }}
          />
        </Field>

        {error && (
          <div style={{ marginTop: 8, padding: 10, border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', borderRadius: 12, fontSize: 13 }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Link href="/dashboard/support" style={{ height: 40, padding: '0 16px', display: 'inline-flex', alignItems: 'center', border: '1px solid #D2D6DC', background: '#fff', color: '#0F1115', borderRadius: 9999, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
            Cancel
          </Link>
          <button type="submit" disabled={submitting} style={{ height: 40, padding: '0 20px', border: 'none', background: '#0F1115', color: '#fff', borderRadius: 9999, fontWeight: 600, fontSize: 14, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.5 : 1 }}>
            {submitting ? 'Submitting…' : 'Submit ticket'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#525A65', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

const input: React.CSSProperties = {
  width: '100%', height: 40, padding: '0 12px', border: '1px solid #D2D6DC', background: '#fff',
  borderRadius: 9999, fontSize: 14, outline: 'none', boxSizing: 'border-box',
};
