'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/lib/api-client';

/* ── Wire shapes ───────────────────────────────────────────────── */

type WarehouseCapability = 'REQUIRED' | 'NOT_NEEDED' | 'OPTIONAL';

interface PartnerInfo {
  code: string;
  displayName: string;
  capabilities: { warehouseRegistration: WarehouseCapability };
}

type RegistrationStatus = 'PENDING' | 'REGISTERED' | 'FAILED' | 'NOT_NEEDED';

interface SellerRegistrationItem {
  partner: string;
  warehouseName: string | null;
  status: RegistrationStatus;
  lastError: string | null;
  registeredAt: string | null;
  registeredBy: string | null;
  updatedAt: string;
}

interface RegisterResponse {
  ok: boolean;
  partner: string;
  status: RegistrationStatus;
  warehouseName: string | null;
  registeredAt: string | null;
  error?: string;
}

interface RowState {
  partner: PartnerInfo;
  registration: SellerRegistrationItem | null;
}

/* ── Component ────────────────────────────────────────────────── */

export interface PartnerRegistrationPanelProps {
  sellerId: string;
}

/**
 * FRANCHISE admin variant of the partner-registration panel. The staff
 * member is logged in as a SportsMart admin and operates on a specific
 * franchise's behalf, so the panel takes `sellerId` as a prop
 * (resolved by the mounting page from a `?sellerId=` query param) and
 * calls the admin endpoints. The `X-Seller-Type: FRANCHISE` header is
 * attached automatically by the app's apiClient.
 *
 * Endpoints:
 *   GET  /admin/logistics-partner/partners
 *   GET  /admin/logistics-partner/sellers/:sellerId/registrations
 *   POST /admin/logistics-partner/sellers/:sellerId/partners/:code/register
 *
 * Component duplicated per seller-persona app (retail / d2c / franchise)
 * to match the existing per-app duplication pattern used for
 * CaseTimeline / DeliveryMethodBadge / RiskBadge.
 */
export function PartnerRegistrationPanel({
  sellerId,
}: PartnerRegistrationPanelProps) {
  const [partners, setPartners] = useState<PartnerInfo[] | null>(null);
  const [registrations, setRegistrations] = useState<
    SellerRegistrationItem[] | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const [partnersRes, regsRes] = await Promise.all([
        apiClient<PartnerInfo[]>(`/admin/logistics-partner/partners`),
        apiClient<SellerRegistrationItem[]>(
          `/admin/logistics-partner/franchises/${encodeURIComponent(sellerId)}/registrations`,
        ),
      ]);
      if (partnersRes.data) setPartners(partnersRes.data);
      if (regsRes.data) setRegistrations(regsRes.data);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        (err as Error)?.message ?? 'Unable to load partner registrations.',
      );
    }
  }, [sellerId]);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const rows: RowState[] = useMemo(() => {
    if (!partners) return [];
    return partners
      .filter((p) => p.capabilities.warehouseRegistration === 'REQUIRED')
      .map((p) => {
        const reg = registrations?.find((r) => r.partner === p.code) ?? null;
        return { partner: p, registration: reg };
      });
  }, [partners, registrations]);

  const onRegister = useCallback(
    async (code: string) => {
      setActing(code);
      setRowError((prev) => {
        const next = { ...prev };
        delete next[code];
        return next;
      });
      try {
        const res = await apiClient<RegisterResponse>(
          `/admin/logistics-partner/franchises/${encodeURIComponent(sellerId)}/partners/${encodeURIComponent(code)}/register`,
          { method: 'POST', body: JSON.stringify({}) },
        );
        if (res.data && res.data.ok === false) {
          setRowError((prev) => ({
            ...prev,
            [code]:
              res.data?.error ?? 'Partner declined the registration.',
          }));
        }
        await refresh();
      } catch (err) {
        setRowError((prev) => ({
          ...prev,
          [code]:
            (err as Error)?.message ??
            'Network error — could not register with partner.',
        }));
      } finally {
        setActing(null);
      }
    },
    [refresh, sellerId],
  );

  // Push the seller's CURRENT address to an already-registered partner
  // warehouse. The seller can't edit their address once registered, so
  // the admin edits the profile then syncs it to the courier here.
  const onUpdateAddress = useCallback(
    async (code: string) => {
      setUpdating(code);
      setRowError((prev) => {
        const next = { ...prev };
        delete next[code];
        return next;
      });
      try {
        const res = await apiClient<RegisterResponse>(
          `/admin/logistics-partner/franchises/${encodeURIComponent(sellerId)}/partners/${encodeURIComponent(code)}/update-address`,
          { method: 'POST', body: JSON.stringify({}) },
        );
        if (res.data && res.data.ok === false) {
          setRowError((prev) => ({
            ...prev,
            [code]: res.data?.error ?? 'Partner declined the address update.',
          }));
        }
        await refresh();
      } catch (err) {
        setRowError((prev) => ({
          ...prev,
          [code]:
            (err as Error)?.message ??
            'Network error — could not update the address.',
        }));
      } finally {
        setUpdating(null);
      }
    },
    [refresh, sellerId],
  );

  if (loading) {
    return <div style={styles.loading}>Loading partner registrations…</div>;
  }

  if (loadError) {
    return (
      <div style={styles.errorBanner}>
        <strong>Could not load partners.</strong> {loadError}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div style={styles.empty}>
        No logistics partners require pickup-location registration right now.
      </div>
    );
  }

  return (
    <div style={styles.wrapper}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Partner</th>
            <th style={styles.th}>Status</th>
            <th style={styles.th}>Warehouse name</th>
            <th style={{ ...styles.th, textAlign: 'right' as const }}>
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ partner, registration }) => {
            const status: RegistrationStatus =
              registration?.status ?? 'PENDING';
            const error = rowError[partner.code] ?? registration?.lastError;
            const busy = acting === partner.code;
            const buttonLabel =
              status === 'REGISTERED' || registration?.warehouseName
                ? 'Re-register'
                : `Add pickup location to ${partner.displayName}`;
            return (
              <tr key={partner.code} style={styles.tr}>
                <td style={styles.td}>
                  <div style={styles.partnerName}>{partner.displayName}</div>
                  <div style={styles.partnerCode}>{partner.code}</div>
                </td>
                <td style={styles.td}>
                  <StatusPill status={status} />
                  {status === 'FAILED' && error && (
                    <div style={styles.errorText} title={error}>
                      {truncate(error, 80)}
                    </div>
                  )}
                </td>
                <td style={styles.td}>
                  <span style={styles.warehouseName}>
                    {registration?.warehouseName ?? '—'}
                  </span>
                  {registration?.registeredAt && (
                    <div style={styles.registeredAt}>
                      Registered{' '}
                      {new Date(registration.registeredAt).toLocaleDateString(
                        'en-IN',
                        { day: 'numeric', month: 'short', year: 'numeric' },
                      )}
                    </div>
                  )}
                </td>
                <td style={{ ...styles.td, textAlign: 'right' as const }}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onRegister(partner.code)}
                    style={{
                      ...styles.button,
                      ...(status === 'REGISTERED' ? styles.buttonGhost : {}),
                      ...(busy ? styles.buttonBusy : {}),
                    }}
                  >
                    {busy ? 'Registering…' : buttonLabel}
                  </button>
                  {status === 'REGISTERED' && (
                    <button
                      type="button"
                      disabled={updating === partner.code}
                      onClick={() => onUpdateAddress(partner.code)}
                      style={{
                        ...styles.button,
                        marginLeft: 8,
                        ...(updating === partner.code ? styles.buttonBusy : {}),
                      }}
                    >
                      {updating === partner.code
                        ? 'Updating…'
                        : `Update address to ${partner.displayName}`}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Sub-components ────────────────────────────────────────────── */

function StatusPill({ status }: { status: RegistrationStatus }) {
  const c = pillColors[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        fontSize: 12,
        fontWeight: 500,
        borderRadius: 999,
        border: `1px solid ${c.border}`,
        background: c.bg,
        color: c.fg,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: c.dot,
        }}
      />
      {labelFor(status)}
    </span>
  );
}

function labelFor(status: RegistrationStatus): string {
  switch (status) {
    case 'REGISTERED':
      return 'Registered';
    case 'PENDING':
      return 'Not registered';
    case 'FAILED':
      return 'Failed';
    case 'NOT_NEEDED':
      return 'Not required';
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/* ── Styles ───────────────────────────────────────────────────── */

const pillColors: Record<
  RegistrationStatus,
  { bg: string; fg: string; border: string; dot: string }
> = {
  REGISTERED: {
    bg: 'rgba(22, 163, 74, 0.08)',
    fg: '#15803d',
    border: 'rgba(22, 163, 74, 0.2)',
    dot: '#16a34a',
  },
  PENDING: {
    bg: '#f1f5f9',
    fg: '#475569',
    border: '#e2e8f0',
    dot: '#94a3b8',
  },
  FAILED: {
    bg: 'rgba(220, 38, 38, 0.08)',
    fg: '#b91c1c',
    border: 'rgba(220, 38, 38, 0.2)',
    dot: '#dc2626',
  },
  NOT_NEEDED: {
    bg: 'rgba(14, 116, 144, 0.08)',
    fg: '#0e7490',
    border: 'rgba(14, 116, 144, 0.2)',
    dot: '#0891b2',
  },
};

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    overflow: 'hidden',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  th: {
    textAlign: 'left',
    padding: '10px 16px',
    fontSize: 11,
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
    whiteSpace: 'nowrap',
  },
  tr: {
    borderBottom: '1px solid #f1f5f9',
  },
  td: {
    padding: '12px 16px',
    verticalAlign: 'middle',
    color: '#0f172a',
  },
  partnerName: {
    fontWeight: 600,
    color: '#0f172a',
  },
  partnerCode: {
    fontSize: 11,
    color: '#64748b',
    fontFamily: 'monospace',
    marginTop: 2,
  },
  warehouseName: {
    fontFamily: 'monospace',
    color: '#0f172a',
  },
  registeredAt: {
    marginTop: 2,
    fontSize: 11,
    color: '#64748b',
  },
  errorText: {
    marginTop: 4,
    fontSize: 11,
    color: '#b91c1c',
    maxWidth: 320,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  button: {
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    color: '#ffffff',
    background: '#0f172a',
    border: '1px solid #0f172a',
    borderRadius: 8,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  buttonGhost: {
    color: '#0f172a',
    background: '#ffffff',
    border: '1px solid #cbd5e1',
  },
  buttonBusy: {
    opacity: 0.6,
    cursor: 'wait',
  },
  loading: {
    padding: '16px 20px',
    fontSize: 13,
    color: '#64748b',
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
  },
  empty: {
    padding: '16px 20px',
    fontSize: 13,
    color: '#64748b',
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
  },
  errorBanner: {
    padding: '12px 16px',
    fontSize: 13,
    color: '#92400e',
    background: '#fef3c7',
    border: '1px solid #fde68a',
    borderRadius: 8,
  },
};
