'use client';

// Phase 35 GST — Seller GSTIN verification admin panel.
//
// Lists every SellerGstin row with a "Verify" button that calls the
// GSTN portal via the active GSTN_PROVIDER (stub today; sandbox
// later). Stamps verifiedAt / verifiedBy / verificationNotes on
// the row. Non-verified rows surface first so the verification
// queue stays prioritised.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  adminTaxService,
  SellerGstinItem,
  GstnVerifyOutcome,
} from '@/services/admin-tax.service';

type Filter = 'ALL' | 'UNVERIFIED' | 'VERIFIED';

export default function SellerGstinsPage() {
  const [filter, setFilter] = useState<Filter>('UNVERIFIED');
  const [items, setItems] = useState<SellerGstinItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [lastOutcome, setLastOutcome] = useState<
    { id: string; outcome: GstnVerifyOutcome } | null
  >(null);

  // 194-O exemption modal state. The list endpoint doesn't echo the
  // seller's current exemption status, so the modal always asks the
  // operator to pick the new state explicitly (no "toggle" — explicit
  // affirmative action is required for an audit-bearing flag).
  const [exemptFor, setExemptFor] = useState<SellerGstinItem | null>(null);
  const [exemptValue, setExemptValue] = useState<'true' | 'false'>('true');
  const [exemptReason, setExemptReason] = useState('');
  const [exemptSaving, setExemptSaving] = useState(false);
  const [exemptErr, setExemptErr] = useState<string | null>(null);

  const submitExempt = async () => {
    if (!exemptFor) return;
    setExemptSaving(true);
    setExemptErr(null);
    try {
      await adminTaxService.setSeller194oExemption(
        exemptFor.sellerId,
        exemptValue === 'true',
        exemptReason.trim() || undefined,
      );
      setMsg({
        kind: 'ok',
        text:
          exemptValue === 'true'
            ? 'Seller marked 194-O exempt'
            : 'Seller 194-O exemption removed',
      });
      setExemptFor(null);
      setExemptReason('');
    } catch (err: any) {
      setExemptErr(err?.message ?? 'Update failed');
    } finally {
      setExemptSaving(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const verified =
        filter === 'UNVERIFIED'
          ? ('false' as const)
          : filter === 'VERIFIED'
            ? ('true' as const)
            : undefined;
      const res = await adminTaxService.listSellerGstins(verified);
      setItems(res.data?.items ?? []);
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Load failed' });
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const verify = async (id: string) => {
    setBusy(id);
    setLastOutcome(null);
    try {
      const res = await adminTaxService.verifySellerGstin(id);
      const outcome = res.data;
      if (outcome) {
        setLastOutcome({ id, outcome });
        setMsg({
          kind: outcome.verified ? 'ok' : 'err',
          text: outcome.verified
            ? `Verified via GSTN — status ${outcome.status}`
            : `Not verified — status ${outcome.status}${
                outcome.legalNameMismatch
                  ? ' (legal-name mismatch)'
                  : ''
              }`,
        });
      }
      await load();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Verify failed' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1400 }}>
      <Link href="/dashboard/tax" style={crumb}>
        &larr; Tax / GST
      </Link>
      <h1>Seller GSTIN verification</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        Run each seller&apos;s GSTIN against the GSTN portal. Today this uses
        the <strong>stub</strong> provider (derives from local Mod-36
        checksum). The real GSTN sandbox adapter lands when CBIC credentials
        are issued — flip{' '}
        <code style={{ background: '#f3f4f6', padding: '0 4px' }}>
          GSTN_PROVIDER=sandbox
        </code>{' '}
        to switch.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['UNVERIFIED', 'VERIFIED', 'ALL'] as Filter[]).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            style={filter === s ? btnFilterActive : btnFilter}
          >
            {s}
          </button>
        ))}
        <button onClick={load} style={btnSecondary}>
          Refresh
        </button>
      </div>

      {msg && (
        <div
          style={{
            ...note,
            background: msg.kind === 'ok' ? '#dcfce7' : '#fee2e2',
            color: msg.kind === 'ok' ? '#166534' : '#991b1b',
          }}
        >
          {msg.text}
        </div>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : items.length === 0 ? (
        <p style={{ color: '#666' }}>No seller GSTINs match this filter.</p>
      ) : (
        <table style={tbl}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <th style={th}>Seller</th>
              <th style={th}>GSTIN</th>
              <th style={th}>State</th>
              <th style={th}>Registration</th>
              <th style={th}>Verified</th>
              <th style={th}>Last note</th>
              <th style={th}>Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((g) => (
              <tr key={g.id} style={{ borderTop: '1px solid #eee' }}>
                <td style={td}>
                  <div style={{ fontWeight: 600 }}>
                    {g.seller?.sellerShopName ?? g.seller?.sellerName ?? '—'}
                  </div>
                  <div style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace' }}>
                    {g.sellerId.slice(0, 8)}
                  </div>
                </td>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>
                  {g.gstin}
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{g.legalName}</div>
                </td>
                <td style={td}>{g.stateCode}</td>
                <td style={td}>
                  <span style={regBadge(g.registrationType)}>
                    {g.registrationType}
                  </span>
                </td>
                <td style={td}>
                  {g.verifiedAt ? (
                    <>
                      <span style={{ color: '#16a34a', fontWeight: 600 }}>✓</span>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>
                        {new Date(g.verifiedAt).toLocaleString('en-IN')}
                      </div>
                    </>
                  ) : (
                    <span style={{ color: '#dc2626', fontWeight: 600 }}>—</span>
                  )}
                </td>
                <td style={{ ...td, fontSize: 11, color: '#6b7280', maxWidth: 320 }}>
                  {lastOutcome && lastOutcome.id === g.id ? (
                    <div>
                      <div>{lastOutcome.outcome.notes}</div>
                      {lastOutcome.outcome.legalNameMismatch && (
                        <div style={{ color: '#dc2626', marginTop: 4 }}>
                          ⚠ Portal name differs from local
                          {lastOutcome.outcome.legalName
                            ? `: "${lastOutcome.outcome.legalName}"`
                            : ''}
                        </div>
                      )}
                    </div>
                  ) : g.verificationNotes ? (
                    <div>{g.verificationNotes}</div>
                  ) : (
                    '—'
                  )}
                </td>
                <td style={td}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      onClick={() => verify(g.id)}
                      disabled={busy === g.id}
                      style={busy === g.id ? { ...btnPrimary, ...busyStyle } : btnPrimary}
                    >
                      {busy === g.id
                        ? 'Verifying…'
                        : g.verifiedAt
                          ? 'Re-verify'
                          : 'Verify with GSTN'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setExemptFor(g);
                        setExemptValue('true');
                        setExemptReason('');
                        setExemptErr(null);
                      }}
                      disabled={busy === g.id}
                      style={{
                        padding: '6px 12px',
                        border: '1px solid #d1d5db',
                        background: '#fff',
                        color: '#0f172a',
                        borderRadius: 9999,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                      title="Mark seller as TDS 194-O exempt (or remove exemption)"
                    >
                      TDS 194-O exempt…
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {exemptFor && (
        <div
          onClick={() => !exemptSaving && setExemptFor(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,17,21,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: 24,
              width: '100%',
              maxWidth: 520,
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}
          >
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              TDS 194-O exemption
            </h2>
            <p style={{ margin: '6px 0 14px', fontSize: 12, color: '#525A65' }}>
              Seller{' '}
              <strong>
                {exemptFor.seller?.sellerShopName ??
                  exemptFor.seller?.sellerName ??
                  exemptFor.sellerId.slice(0, 8)}
              </strong>{' '}
              · GSTIN{' '}
              <code style={{ fontFamily: 'ui-monospace, monospace' }}>
                {exemptFor.gstin}
              </code>
            </p>

            <label
              style={{
                display: 'block',
                fontSize: 12,
                color: '#525A65',
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              New status
            </label>
            <select
              value={exemptValue}
              onChange={(e) => setExemptValue(e.target.value as 'true' | 'false')}
              disabled={exemptSaving}
              style={{
                width: '100%',
                padding: '8px 10px',
                border: '1px solid #D2D6DC',
                borderRadius: 8,
                fontSize: 13,
                boxSizing: 'border-box',
                marginBottom: 12,
              }}
            >
              <option value="true">Exempt — do NOT deduct 194-O TDS</option>
              <option value="false">Not exempt — deduct 194-O TDS</option>
            </select>

            <label
              style={{
                display: 'block',
                fontSize: 12,
                color: '#525A65',
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              Attestation / reason (required by auditors)
            </label>
            <textarea
              value={exemptReason}
              onChange={(e) => setExemptReason(e.target.value)}
              disabled={exemptSaving}
              rows={3}
              placeholder="e.g. seller's gross receipts < ₹5L threshold per FY 2025-26 declaration"
              style={{
                width: '100%',
                padding: '8px 10px',
                border: '1px solid #D2D6DC',
                borderRadius: 8,
                fontSize: 13,
                boxSizing: 'border-box',
                fontFamily: 'inherit',
                resize: 'vertical',
              }}
            />

            {exemptErr && (
              <div
                style={{
                  marginTop: 10,
                  padding: '8px 12px',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#991b1b',
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                {exemptErr}
              </div>
            )}

            <div
              style={{
                display: 'flex',
                gap: 8,
                justifyContent: 'flex-end',
                marginTop: 16,
              }}
            >
              <button
                type="button"
                onClick={() => setExemptFor(null)}
                disabled={exemptSaving}
                style={{
                  height: 36,
                  padding: '0 16px',
                  border: '1px solid #D2D6DC',
                  background: '#fff',
                  color: '#0F1115',
                  borderRadius: 9999,
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitExempt}
                disabled={exemptSaving}
                style={{
                  height: 36,
                  padding: '0 16px',
                  border: 'none',
                  background: '#0F1115',
                  color: '#fff',
                  borderRadius: 9999,
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: exemptSaving ? 'wait' : 'pointer',
                  opacity: exemptSaving ? 0.6 : 1,
                }}
              >
                {exemptSaving ? 'Saving…' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function regBadge(reg: string): React.CSSProperties {
  const color =
    reg === 'REGULAR'
      ? '#2563eb'
      : reg === 'COMPOSITION'
        ? '#d97706'
        : '#6b7280';
  return {
    background: color,
    color: '#fff',
    padding: '2px 6px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
  };
}

const crumb: React.CSSProperties = { fontSize: 12, color: '#6b7280', textDecoration: 'none', marginBottom: 8, display: 'inline-block' };
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '8px', verticalAlign: 'top' };
const note: React.CSSProperties = { padding: '8px 12px', borderRadius: 4, marginBottom: 12, fontSize: 13 };
const btnPrimary: React.CSSProperties = { background: '#2563eb', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
const btnSecondary: React.CSSProperties = { background: '#f3f4f6', color: '#111', border: '1px solid #d1d5db', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
const btnFilter: React.CSSProperties = { background: '#fff', color: '#111', borderWidth: 1, borderStyle: 'solid', borderColor: '#d1d5db', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 };
const btnFilterActive: React.CSSProperties = { ...btnFilter, background: '#2563eb', color: '#fff', borderColor: '#2563eb' };
const busyStyle: React.CSSProperties = { opacity: 0.5, cursor: 'not-allowed' };
