'use client';

/**
 * Tax mode toggle (Super Admin only).
 *
 * Three modes:
 *   OFF     — no tax validation; passthrough fallbacks on missing
 *             HSN / rate / GSTIN. Used only during initial onboarding.
 *   AUDIT   — validation runs; violations are logged but do NOT block
 *             the request. Use this for a 2-week soak after seeding
 *             tax masters; review logs daily, then graduate to STRICT.
 *   STRICT  — validation throws on any violation; requests fail with
 *             TaxStrictModeViolationError. This is the production mode.
 *
 * Each change writes an audit row (action='TAX_MODE_CHANGED') so the
 * compliance team has a full history. We pull the most-recent 20 audit
 * rows from /admin/audit?module=tax-mode to show alongside the toggle.
 */

import { useCallback, useEffect, useState } from 'react';
import { useModal } from '@sportsmart/ui';
import { apiClient } from '@/lib/api-client';

type TaxMode = 'OFF' | 'AUDIT' | 'STRICT';

interface ModeResponse {
  mode: TaxMode;
}

interface AuditEntry {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
}

const MODES: { value: TaxMode; label: string; description: string; danger: boolean }[] = [
  {
    value: 'OFF',
    label: 'OFF',
    danger: true,
    description:
      'No tax validation. Missing HSN / rate / GSTIN values silently fall back to defaults. ' +
      'Use ONLY during initial seeding. Never run a production day in OFF.',
  },
  {
    value: 'AUDIT',
    label: 'AUDIT',
    danger: false,
    description:
      'Validation runs but does NOT block requests. Violations are logged structurally so ' +
      'compliance can review the catalog data quality without breaking checkout. Use this ' +
      'for the soak period (2 weeks) after seeding tax masters.',
  },
  {
    value: 'STRICT',
    label: 'STRICT',
    danger: false,
    description:
      'Validation throws on any violation. This is the production mode. Only flip to STRICT ' +
      'after AUDIT mode shows a clean log for at least 7 consecutive days.',
  },
];

export default function TaxModePage() {
  const { confirmDialog } = useModal();
  const [currentMode, setCurrentMode] = useState<TaxMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<TaxMode | null>(null);
  const [banner, setBanner] = useState<
    { tone: 'success' | 'error'; message: string } | null
  >(null);

  const [history, setHistory] = useState<AuditEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadMode = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient<ModeResponse>('/admin/tax/reports/mode');
      const data = (res?.data as ModeResponse) ?? (res as unknown as ModeResponse);
      setCurrentMode(data?.mode ?? null);
    } catch (err) {
      setError((err as Error).message || 'Failed to load current tax mode');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await apiClient<{ items: AuditEntry[] }>(
        '/admin/audit?module=tax-mode&limit=20',
      );
      const items =
        ((res?.data as { items?: AuditEntry[] })?.items as AuditEntry[]) ??
        [];
      setHistory(items);
    } catch {
      // Best-effort: missing audit endpoint shouldn't break the page.
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMode();
    loadHistory();
  }, [loadMode, loadHistory]);

  const handleChange = async (target: TaxMode) => {
    if (target === currentMode) return;
    const message =
      target === 'OFF'
        ? 'Are you sure you want to turn tax validation OFF? This bypasses ALL validation and lets bad data into invoices. Only do this for initial seeding.'
        : target === 'STRICT'
          ? 'Switch tax mode to STRICT? Once this is on, every order that fails validation will be rejected. Make sure AUDIT mode has shown a clean log for at least 7 days.'
          : "Switch tax mode to AUDIT? Validation will run but won't block requests.";
    const ok = await confirmDialog({
      title: `Switch tax mode to ${target}?`,
      message,
      confirmText: `Set ${target}`,
      cancelText: 'Cancel',
      danger: target === 'OFF' || target === 'STRICT',
    });
    if (!ok) return;

    setSubmitting(target);
    setBanner(null);
    try {
      await apiClient('/admin/tax/reports/mode', {
        method: 'POST',
        body: JSON.stringify({ mode: target }),
      });
      setBanner({
        tone: 'success',
        message: `Tax mode set to ${target}.`,
      });
      setCurrentMode(target);
      // Refresh audit history to show the new row.
      await loadHistory();
    } catch (err) {
      setBanner({
        tone: 'error',
        message: (err as Error).message || 'Failed to change tax mode',
      });
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <main className="tax-mode">
      <header className="tax-mode__header">
        <h1>Tax mode</h1>
        <p>
          Controls how strict the tax engine is about missing or invalid data.
          Changes are audited and require <code>tax.configure</code> permission.
        </p>
      </header>

      {banner && (
        <div
          role="alert"
          className={`tax-mode__banner tax-mode__banner--${banner.tone}`}
        >
          <span>{banner.message}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <section className="tax-mode__current">
        <h2>Current mode</h2>
        {loading && <p>Loading…</p>}
        {error && <p className="tax-mode__error">{error}</p>}
        {!loading && !error && currentMode && (
          <p className="tax-mode__current-value">
            <span
              className={`tax-mode__pill tax-mode__pill--${currentMode.toLowerCase()}`}
            >
              {currentMode}
            </span>
          </p>
        )}
      </section>

      <section className="tax-mode__options">
        <h2>Switch to</h2>
        <div className="tax-mode__cards">
          {MODES.map((m) => (
            <div
              key={m.value}
              className={`tax-mode__card ${
                currentMode === m.value ? 'tax-mode__card--active' : ''
              } ${m.danger ? 'tax-mode__card--danger' : ''}`}
            >
              <div className="tax-mode__card-title">
                {m.label}
                {currentMode === m.value && (
                  <span className="tax-mode__active-tag">current</span>
                )}
              </div>
              <p className="tax-mode__card-desc">{m.description}</p>
              <button
                type="button"
                disabled={currentMode === m.value || submitting !== null}
                onClick={() => handleChange(m.value)}
                className="tax-mode__card-btn"
              >
                {submitting === m.value
                  ? 'Switching…'
                  : currentMode === m.value
                    ? 'Already active'
                    : `Switch to ${m.label}`}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="tax-mode__history">
        <h2>Recent changes</h2>
        {historyLoading && <p>Loading history…</p>}
        {!historyLoading && history.length === 0 && (
          <p className="tax-mode__hint">
            No tax-mode changes recorded yet (or audit-log endpoint not
            wired). Once a change is made, it will appear here.
          </p>
        )}
        {history.length > 0 && (
          <table className="tax-mode__table">
            <thead>
              <tr>
                <th>When</th>
                <th>Admin</th>
                <th>From → To</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => {
                const oldMode = (row.oldValue as { mode?: string })?.mode ?? '—';
                const newMode = (row.newValue as { mode?: string })?.mode ?? '—';
                return (
                  <tr key={row.id}>
                    <td>{new Date(row.createdAt).toLocaleString('en-IN')}</td>
                    <td>{row.actorId ?? '—'}</td>
                    <td>
                      <code>{oldMode}</code> → <code>{newMode}</code>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <style jsx>{`
        .tax-mode {
          padding: 24px;
          max-width: 960px;
          margin: 0 auto;
        }
        .tax-mode__header h1 {
          margin: 0 0 4px;
          font-size: 22px;
        }
        .tax-mode__header p {
          margin: 0 0 24px;
          color: #555;
          font-size: 14px;
        }
        .tax-mode__header code {
          background: #f3f4f6;
          padding: 1px 5px;
          border-radius: 4px;
          font-size: 12px;
        }
        .tax-mode__banner {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 14px;
          border-radius: 6px;
          margin-bottom: 16px;
          font-size: 13px;
        }
        .tax-mode__banner--success {
          background: #e8f5e9;
          color: #2e7d32;
        }
        .tax-mode__banner--error {
          background: #ffebee;
          color: #c62828;
        }
        .tax-mode__banner button {
          background: transparent;
          border: none;
          font-size: 20px;
          cursor: pointer;
          color: inherit;
        }
        .tax-mode__current,
        .tax-mode__options,
        .tax-mode__history {
          background: #fff;
          border: 1px solid #d0d7de;
          border-radius: 8px;
          padding: 18px 22px;
          margin-bottom: 16px;
        }
        .tax-mode__current h2,
        .tax-mode__options h2,
        .tax-mode__history h2 {
          margin: 0 0 12px;
          font-size: 16px;
        }
        .tax-mode__pill {
          display: inline-block;
          padding: 4px 14px;
          border-radius: 999px;
          font-weight: 600;
          font-size: 13px;
          letter-spacing: 0.06em;
        }
        .tax-mode__pill--off {
          background: #ffebee;
          color: #c62828;
        }
        .tax-mode__pill--audit {
          background: #fff8e1;
          color: #ef6c00;
        }
        .tax-mode__pill--strict {
          background: #e8f5e9;
          color: #2e7d32;
        }
        .tax-mode__error {
          color: #c62828;
        }
        .tax-mode__cards {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 14px;
        }
        .tax-mode__card {
          border: 1px solid #d0d7de;
          border-radius: 8px;
          padding: 14px 16px;
          background: #fafbfc;
        }
        .tax-mode__card--active {
          border-color: #1565c0;
          background: #e3f2fd;
        }
        .tax-mode__card--danger {
          border-left: 3px solid #c62828;
        }
        .tax-mode__card-title {
          font-weight: 700;
          margin-bottom: 6px;
          font-size: 16px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .tax-mode__active-tag {
          font-size: 10px;
          background: #1565c0;
          color: #fff;
          padding: 2px 6px;
          border-radius: 999px;
          font-weight: 600;
          letter-spacing: 0.06em;
        }
        .tax-mode__card-desc {
          font-size: 12px;
          color: #555;
          margin: 0 0 12px;
          line-height: 1.5;
        }
        .tax-mode__card-btn {
          width: 100%;
          padding: 8px 12px;
          background: #1565c0;
          color: #fff;
          border: none;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .tax-mode__card-btn:disabled {
          background: #b0bec5;
          cursor: not-allowed;
        }
        .tax-mode__hint {
          color: #666;
          font-size: 13px;
        }
        .tax-mode__table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .tax-mode__table th,
        .tax-mode__table td {
          text-align: left;
          padding: 8px 10px;
          border-bottom: 1px solid #eee;
        }
        .tax-mode__table th {
          color: #666;
          font-weight: 600;
          font-size: 12px;
          text-transform: uppercase;
        }
        .tax-mode__table code {
          background: #f3f4f6;
          padding: 1px 5px;
          border-radius: 4px;
        }
      `}</style>
    </main>
  );
}
