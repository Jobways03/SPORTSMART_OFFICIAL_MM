'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  franchiseSupportService,
  TicketCategory,
  TicketPriority,
} from '@/services/support.service';
import { validateText } from '@/lib/validators';

const PRIORITIES: { value: TicketPriority; label: string; hint: string }[] = [
  { value: 'LOW', label: 'Low', hint: 'General question, no rush' },
  { value: 'NORMAL', label: 'Normal', hint: 'Standard request' },
  { value: 'HIGH', label: 'High', hint: 'Affecting my store' },
  { value: 'URGENT', label: 'Urgent', hint: 'Blocking sales / payouts' },
];

const SUBJECT_MIN = 5;
const SUBJECT_MAX = 200;
const BODY_MIN = 10;
const BODY_MAX = 5000;

export default function NewFranchiseTicketPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<TicketCategory[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('NORMAL');
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    franchiseSupportService
      .listCategories()
      .then((res) => res.data && setCategories(res.data))
      .catch(() => {});
  }, []);

  // Live field validation — shown only after the first submit attempt so the
  // form isn't shouting at the seller before they've typed anything.
  const subjectErr = useMemo(
    () => validateText(subject, { min: SUBJECT_MIN, max: SUBJECT_MAX, label: 'Subject' }),
    [subject],
  );
  const bodyErr = useMemo(
    () => validateText(body, { min: BODY_MIN, max: BODY_MAX, label: 'Description' }),
    [body],
  );
  const canSubmit = !subjectErr && !bodyErr && !submitting;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setAttempted(true);
    if (subjectErr) return setError(subjectErr);
    if (bodyErr) return setError(bodyErr);
    setSubmitting(true);
    try {
      const res = await franchiseSupportService.createTicket({
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

  const counterClass =
    body.length >= BODY_MAX
      ? 'tkt-counter over'
      : body.length > BODY_MAX * 0.9
        ? 'tkt-counter warn'
        : 'tkt-counter';

  return (
    <div className="tkt-page">
      <style>{CSS}</style>

      <Link href="/dashboard/support" className="tkt-back">
        <span aria-hidden>←</span> Back to support
      </Link>
      <h1 className="tkt-title">Open a ticket</h1>
      <p className="tkt-sub">
        Tell us what&apos;s going on and we&apos;ll take it from there — we
        typically reply within one business day.
      </p>

      <div className="tkt-layout">
        <form onSubmit={submit} className="tkt-card" noValidate>
          {/* Subject */}
          <div className="tkt-field">
            <label htmlFor="tkt-subject" className="tkt-label">
              Subject
            </label>
            <input
              id="tkt-subject"
              type="text"
              className="tkt-input"
              maxLength={SUBJECT_MAX}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={submitting}
              placeholder="e.g. Procurement order delivery issue"
              aria-invalid={attempted && !!subjectErr}
            />
            {attempted && subjectErr ? (
              <p className="tkt-err">{subjectErr}</p>
            ) : (
              <p className="tkt-hint">A short summary helps us route it faster.</p>
            )}
          </div>

          {/* Category + Priority */}
          <div className="tkt-row">
            <div className="tkt-field">
              <label htmlFor="tkt-category" className="tkt-label">
                Category <span className="tkt-optional">(optional)</span>
              </label>
              <select
                id="tkt-category"
                className="tkt-select"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                disabled={submitting || categories.length === 0}
              >
                <option value="">Choose a category…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="tkt-field">
              <span className="tkt-label" id="tkt-priority-label">
                Priority
              </span>
              <div
                className="tkt-seg"
                role="radiogroup"
                aria-labelledby="tkt-priority-label"
              >
                {PRIORITIES.map((p) => {
                  const active = priority === p.value;
                  return (
                    <button
                      key={p.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      title={p.hint}
                      disabled={submitting}
                      onClick={() => setPriority(p.value)}
                      className={`tkt-seg-btn${active ? ` is-active prio-${p.value.toLowerCase()}` : ''}`}
                    >
                      <span className="tkt-dot" aria-hidden />
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="tkt-field">
            <label htmlFor="tkt-body" className="tkt-label">
              Describe the issue
            </label>
            <textarea
              id="tkt-body"
              className="tkt-textarea"
              maxLength={BODY_MAX}
              rows={7}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={submitting}
              placeholder="Share what happened, what you expected, and any order/return IDs or error messages that might help us resolve it quickly."
              aria-invalid={attempted && !!bodyErr}
            />
            <div className="tkt-meta">
              {attempted && bodyErr ? (
                <span className="tkt-err">{bodyErr}</span>
              ) : (
                <span />
              )}
              <span className={counterClass}>
                {body.length.toLocaleString()} / {BODY_MAX.toLocaleString()}
              </span>
            </div>
          </div>

          {error && (
            <div className="tkt-banner" role="alert">
              <span aria-hidden>⚠</span>
              <span>{error}</span>
            </div>
          )}

          <div className="tkt-actions">
            <Link href="/dashboard/support" className="tkt-btn-cancel">
              Cancel
            </Link>
            <button type="submit" disabled={!canSubmit} className="tkt-btn-submit">
              {submitting ? 'Submitting…' : 'Submit ticket'}
            </button>
          </div>
        </form>

        {/* Helper rail */}
        <aside className="tkt-aside">
          <div className="tkt-aside-card">
            <h2 className="tkt-aside-h">What happens next</h2>
            <ol className="tkt-steps">
              <li className="tkt-step">
                <span className="tkt-step-n">1</span>
                <span>We review your ticket and route it to the right team.</span>
              </li>
              <li className="tkt-step">
                <span className="tkt-step-n">2</span>
                <span>You&apos;ll get a first reply within one business day.</span>
              </li>
              <li className="tkt-step">
                <span className="tkt-step-n">3</span>
                <span>
                  Follow the conversation any time under <strong>Support</strong>.
                </span>
              </li>
            </ol>
          </div>

          <div className="tkt-aside-card">
            <h2 className="tkt-aside-h">Tips for a faster reply</h2>
            <ul className="tkt-tips">
              <li>Include the order or return ID if it&apos;s about one.</li>
              <li>Say what you expected vs. what actually happened.</li>
              <li>Paste any error message you saw, word for word.</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

const CSS = `
.tkt-page { padding: 24px 32px 48px; max-width: 1060px; }
.tkt-back {
  color: #525A65; font-size: 13px; text-decoration: none;
  display: inline-flex; align-items: center; gap: 6px; margin-bottom: 14px;
  transition: color .12s;
}
.tkt-back:hover { color: #0F1115; }
.tkt-title { font-size: 28px; font-weight: 700; margin: 0; color: #0F1115; letter-spacing: -0.02em; }
.tkt-sub { margin: 6px 0 0; font-size: 14px; line-height: 1.5; color: #525A65; max-width: 56ch; }

.tkt-layout {
  margin-top: 24px; display: grid;
  grid-template-columns: minmax(0, 1fr) 296px; gap: 24px; align-items: start;
}
@media (max-width: 980px) { .tkt-layout { grid-template-columns: 1fr; } }

.tkt-card {
  background: #fff; border: 1px solid #E5E7EB; border-radius: 16px; padding: 24px;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
}

.tkt-field { margin-bottom: 20px; }
.tkt-field:last-of-type { margin-bottom: 0; }
.tkt-label {
  display: block; font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.06em; color: #6B7280; margin-bottom: 7px;
}
.tkt-optional { font-weight: 600; text-transform: none; letter-spacing: 0; color: #9CA3AF; }

.tkt-input, .tkt-select, .tkt-textarea {
  width: 100%; border: 1px solid #D2D6DC; background: #fff; color: #0F1115;
  font-size: 14px; font-family: inherit; border-radius: 10px; box-sizing: border-box;
  outline: none; transition: border-color .15s, box-shadow .15s;
}
.tkt-input, .tkt-select { height: 44px; padding: 0 14px; }
.tkt-textarea { padding: 12px 14px; min-height: 168px; resize: vertical; line-height: 1.55; }
.tkt-input::placeholder, .tkt-textarea::placeholder { color: #9CA3AF; }
.tkt-input:focus, .tkt-select:focus, .tkt-textarea:focus {
  border-color: #0F1115; box-shadow: 0 0 0 3px rgba(15, 17, 21, 0.08);
}
.tkt-input[aria-invalid="true"], .tkt-textarea[aria-invalid="true"] {
  border-color: #DC2626; box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.08);
}
.tkt-input:disabled, .tkt-select:disabled, .tkt-textarea:disabled {
  background: #F9FAFB; color: #6B7280; cursor: not-allowed;
}
.tkt-select {
  appearance: none; -webkit-appearance: none; padding-right: 38px; cursor: pointer;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%236B7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M4 6l4 4 4-4'/></svg>");
  background-repeat: no-repeat; background-position: right 14px center;
}

.tkt-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 560px) { .tkt-row { grid-template-columns: 1fr; } }

.tkt-hint { margin: 7px 0 0; font-size: 12px; color: #6B7280; }
.tkt-err { margin: 7px 0 0; font-size: 12px; color: #DC2626; font-weight: 500; }

.tkt-meta { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 7px; }
.tkt-counter { font-size: 12px; color: #9CA3AF; font-variant-numeric: tabular-nums; white-space: nowrap; }
.tkt-counter.warn { color: #B45309; }
.tkt-counter.over { color: #DC2626; font-weight: 600; }

/* Priority segmented control */
.tkt-seg { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.tkt-seg-btn {
  height: 44px; border: 1px solid #D2D6DC; background: #fff; border-radius: 10px;
  font-size: 13px; font-weight: 600; color: #525A65; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  transition: border-color .12s, background .12s, color .12s, box-shadow .12s;
}
.tkt-seg-btn:hover:not(:disabled) { border-color: #9CA3AF; }
.tkt-seg-btn:disabled { cursor: not-allowed; opacity: .6; }
.tkt-dot { width: 7px; height: 7px; border-radius: 50%; background: #CBD5E1; flex-shrink: 0; }
.tkt-seg-btn.is-active { box-shadow: inset 0 0 0 1px currentColor; }
.tkt-seg-btn.prio-low { background: #F1F5F9; border-color: #CBD5E1; color: #475569; }
.tkt-seg-btn.prio-low .tkt-dot { background: #64748B; }
.tkt-seg-btn.prio-normal { background: #EFF6FF; border-color: #BFDBFE; color: #1D4ED8; }
.tkt-seg-btn.prio-normal .tkt-dot { background: #2563EB; }
.tkt-seg-btn.prio-high { background: #FFFBEB; border-color: #FDE68A; color: #B45309; }
.tkt-seg-btn.prio-high .tkt-dot { background: #D97706; }
.tkt-seg-btn.prio-urgent { background: #FEF2F2; border-color: #FECACA; color: #B91C1C; }
.tkt-seg-btn.prio-urgent .tkt-dot { background: #DC2626; }

/* Banner */
.tkt-banner {
  margin-top: 16px; padding: 12px 14px; border: 1px solid #FCA5A5; background: #FEF2F2;
  color: #B91C1C; border-radius: 10px; font-size: 13px; line-height: 1.5;
  display: flex; gap: 9px; align-items: flex-start;
}

/* Actions */
.tkt-actions {
  margin-top: 22px; padding-top: 18px; border-top: 1px solid #F1F3F5;
  display: flex; justify-content: flex-end; gap: 10px; align-items: center;
}
.tkt-btn-cancel {
  height: 44px; padding: 0 18px; display: inline-flex; align-items: center;
  border: 1px solid #D2D6DC; background: #fff; color: #0F1115; border-radius: 10px;
  font-size: 14px; font-weight: 600; text-decoration: none; cursor: pointer;
  transition: background .12s, border-color .12s;
}
.tkt-btn-cancel:hover { background: #F9FAFB; border-color: #9CA3AF; }
.tkt-btn-submit {
  height: 44px; padding: 0 22px; border: none; background: #0F1115; color: #fff;
  border-radius: 10px; font-weight: 600; font-size: 14px; cursor: pointer;
  transition: opacity .12s, transform .04s;
}
.tkt-btn-submit:hover:not(:disabled) { background: #1c1f26; }
.tkt-btn-submit:active:not(:disabled) { transform: translateY(1px); }
.tkt-btn-submit:disabled { opacity: .45; cursor: not-allowed; }

/* Helper rail */
.tkt-aside { display: flex; flex-direction: column; gap: 16px; position: sticky; top: 24px; }
@media (max-width: 980px) { .tkt-aside { position: static; } }
.tkt-aside-card { background: #F9FAFB; border: 1px solid #EEF0F2; border-radius: 14px; padding: 18px; }
.tkt-aside-h { font-size: 13px; font-weight: 700; color: #0F1115; margin: 0 0 14px; }
.tkt-steps { list-style: none; margin: 0; padding: 0; }
.tkt-step { display: flex; gap: 10px; font-size: 13px; color: #374151; line-height: 1.45; margin-bottom: 12px; }
.tkt-step:last-child { margin-bottom: 0; }
.tkt-step-n {
  flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%;
  background: #0F1115; color: #fff; font-size: 11px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
}
.tkt-tips { margin: 0; padding-left: 18px; }
.tkt-tips li { font-size: 13px; color: #374151; line-height: 1.45; margin-bottom: 8px; }
.tkt-tips li:last-child { margin-bottom: 0; }
`;
