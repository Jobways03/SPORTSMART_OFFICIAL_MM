'use client';

/**
 * Customer privacy + marketing preferences (DPDP §6 consent surface).
 *
 * Renders one toggle per known consent purpose. Each flip writes an
 * audit row server-side, so the customer's compliance trail is
 * tamper-evident.
 *
 * Endpoints:
 *   GET  /customer/consent          — current state per purpose
 *   POST /customer/consent          — body: { purpose, granted }
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

interface ConsentEntry {
  purpose: string;
  granted: boolean;
  timestamp: string | null;
}

type ConsentSnapshot = Record<string, ConsentEntry>;

interface PurposeDescriptor {
  key: string;
  title: string;
  description: string;
  group: 'cookies' | 'marketing' | 'personalization';
}

const PURPOSES: PurposeDescriptor[] = [
  {
    key: 'COOKIE_ANALYTICS',
    title: 'Usage analytics cookies',
    description:
      'Lets us see how people use the site so we can fix slow pages and improve checkout. We never link this to your name or email.',
    group: 'cookies',
  },
  {
    key: 'COOKIE_MARKETING',
    title: 'Marketing cookies',
    description:
      'Lets us show you ads on other sites about products you looked at on SportSmart. Switch off if you prefer no retargeting.',
    group: 'cookies',
  },
  {
    key: 'EMAIL_MARKETING',
    title: 'Marketing emails',
    description:
      'Promotional emails about new products, sales, and seasonal collections. You\'ll still receive order updates and security emails regardless of this setting.',
    group: 'marketing',
  },
  {
    key: 'WHATSAPP_MARKETING',
    title: 'WhatsApp marketing',
    description:
      'Promotional WhatsApp messages. Order shipment + delivery notifications continue to come via WhatsApp regardless.',
    group: 'marketing',
  },
  {
    key: 'SMS_MARKETING',
    title: 'Promotional SMS',
    description:
      'Promotional text messages. Transactional SMS (OTPs, delivery alerts) is not affected.',
    group: 'marketing',
  },
  {
    key: 'PERSONALIZED_RECOMMENDATIONS',
    title: 'Personalized recommendations',
    description:
      'Lets us suggest products based on what you\'ve browsed or bought. Switch off to see only generic best-sellers.',
    group: 'personalization',
  },
];

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'Never';

export default function CustomerPrivacyPage() {
  const [snapshot, setSnapshot] = useState<ConsentSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ tone: 'success'; message: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient<ConsentSnapshot>('/customer/consent');
      const data =
        (res?.data as ConsentSnapshot) ?? (res as unknown as ConsentSnapshot);
      setSnapshot(data ?? {});
    } catch (err) {
      setError((err as Error).message || 'Failed to load preferences');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleToggle = async (purpose: string, granted: boolean) => {
    setUpdating(purpose);
    setBanner(null);
    try {
      await apiClient('/customer/consent', {
        method: 'POST',
        body: JSON.stringify({ purpose, granted }),
      });
      // Refresh from server so the timestamp updates.
      await load();
      setBanner({
        tone: 'success',
        message: granted
          ? 'Preference enabled.'
          : 'Preference turned off. Changes take effect immediately.',
      });
    } catch (err) {
      setError((err as Error).message || 'Could not save your preference');
    } finally {
      setUpdating(null);
    }
  };

  const grouped = (group: PurposeDescriptor['group']) =>
    PURPOSES.filter((p) => p.group === group);

  return (
    <main className="privacy">
      <h1>Privacy &amp; marketing preferences</h1>
      <p className="privacy__lede">
        Every change you make here is saved immediately and recorded in
        an audit trail. Transactional messages (order updates, delivery
        alerts, OTPs, security emails) are not affected by these
        toggles — those continue regardless.
      </p>

      {error && (
        <div role="alert" className="privacy__error">
          {error}
        </div>
      )}
      {banner && (
        <div role="status" className="privacy__banner">
          {banner.message}
        </div>
      )}

      {loading && <p className="privacy__hint">Loading your current settings…</p>}

      {!loading && snapshot && (
        <>
          <Section title="Cookies on this site" purposes={grouped('cookies')} snapshot={snapshot} updating={updating} onToggle={handleToggle} />
          <Section title="Marketing communications" purposes={grouped('marketing')} snapshot={snapshot} updating={updating} onToggle={handleToggle} />
          <Section title="Personalization" purposes={grouped('personalization')} snapshot={snapshot} updating={updating} onToggle={handleToggle} />
        </>
      )}

      <hr />

      <section className="privacy__related">
        <h2>Related</h2>
        <ul>
          <li>
            <Link href="/account/data-export">
              Download all your data
            </Link>
          </li>
          <li>
            <Link href="/account/invoices">View your tax invoices</Link>
          </li>
        </ul>
      </section>

      <style jsx>{`
        .privacy {
          padding: 32px 16px;
          max-width: 760px;
          margin: 0 auto;
        }
        .privacy h1 {
          margin: 0 0 8px;
          font-size: 24px;
        }
        .privacy__lede {
          color: #555;
          font-size: 14px;
          line-height: 1.6;
          margin: 0 0 24px;
        }
        .privacy__error {
          background: #ffebee;
          color: #c62828;
          padding: 10px 14px;
          border-radius: 6px;
          margin: 12px 0;
          font-size: 13px;
        }
        .privacy__banner {
          background: #e8f5e9;
          color: #2e7d32;
          padding: 10px 14px;
          border-radius: 6px;
          margin: 12px 0;
          font-size: 13px;
        }
        .privacy__hint {
          color: #555;
        }
        hr {
          border: none;
          border-top: 1px solid #eee;
          margin: 24px 0 16px;
        }
        .privacy__related h2 {
          font-size: 16px;
          margin: 0 0 8px;
        }
        .privacy__related ul {
          list-style: none;
          padding: 0;
        }
        .privacy__related li {
          margin-bottom: 6px;
        }
        .privacy__related :global(a) {
          color: #1565c0;
          text-decoration: underline;
          font-size: 14px;
        }
      `}</style>
    </main>
  );
}

function Section({
  title,
  purposes,
  snapshot,
  updating,
  onToggle,
}: {
  title: string;
  purposes: PurposeDescriptor[];
  snapshot: ConsentSnapshot;
  updating: string | null;
  onToggle: (purpose: string, granted: boolean) => void;
}) {
  return (
    <section className="privacy-section">
      <h2>{title}</h2>
      <div className="privacy-section__list">
        {purposes.map((p) => {
          const entry = snapshot[p.key];
          const granted = entry?.granted ?? false;
          return (
            <article key={p.key} className="privacy-section__row">
              <div className="privacy-section__text">
                <div className="privacy-section__title">{p.title}</div>
                <div className="privacy-section__desc">{p.description}</div>
                <div className="privacy-section__last">
                  Last changed: {fmtDate(entry?.timestamp ?? null)}
                </div>
              </div>
              <div className="privacy-section__toggle">
                <label className="privacy-switch">
                  <input
                    type="checkbox"
                    checked={granted}
                    disabled={updating === p.key}
                    onChange={(e) => onToggle(p.key, e.target.checked)}
                    aria-label={`Toggle ${p.title}`}
                  />
                  <span className="privacy-switch__slider" />
                </label>
                <div className="privacy-switch__label">
                  {updating === p.key
                    ? 'Saving…'
                    : granted
                      ? 'On'
                      : 'Off'}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <style jsx>{`
        .privacy-section {
          margin-bottom: 24px;
        }
        .privacy-section h2 {
          font-size: 17px;
          margin: 0 0 10px;
        }
        .privacy-section__list {
          background: #fff;
          border: 1px solid #d0d7de;
          border-radius: 8px;
          overflow: hidden;
        }
        .privacy-section__row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 14px 18px;
          border-bottom: 1px solid #eee;
          gap: 16px;
        }
        .privacy-section__row:last-child {
          border-bottom: none;
        }
        .privacy-section__title {
          font-weight: 600;
          font-size: 14px;
          margin-bottom: 2px;
        }
        .privacy-section__desc {
          color: #555;
          font-size: 13px;
          line-height: 1.5;
          margin-bottom: 4px;
        }
        .privacy-section__last {
          color: #999;
          font-size: 11px;
        }
        .privacy-section__toggle {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          min-width: 70px;
        }
        .privacy-switch {
          position: relative;
          display: inline-block;
          width: 50px;
          height: 26px;
        }
        .privacy-switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .privacy-switch__slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: #ccc;
          border-radius: 13px;
          transition: background 0.2s;
        }
        .privacy-switch__slider::before {
          content: '';
          position: absolute;
          height: 20px;
          width: 20px;
          left: 3px;
          bottom: 3px;
          background: white;
          border-radius: 50%;
          transition: transform 0.2s;
        }
        .privacy-switch input:checked + .privacy-switch__slider {
          background: #2e7d32;
        }
        .privacy-switch input:checked + .privacy-switch__slider::before {
          transform: translateX(24px);
        }
        .privacy-switch input:disabled + .privacy-switch__slider {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .privacy-switch__label {
          font-size: 11px;
          color: #555;
          font-weight: 600;
          letter-spacing: 0.05em;
        }
        @media (max-width: 600px) {
          .privacy-section__row {
            flex-direction: column;
            align-items: flex-start;
          }
        }
      `}</style>
    </section>
  );
}
