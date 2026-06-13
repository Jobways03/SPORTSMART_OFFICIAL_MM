'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  adminShippingService,
  LabelInfo,
  NdrRtoState,
  ShipmentDetail,
} from '@/services/admin-shipping.service';

interface Props {
  subOrderId: string;
  /** Allows the parent order detail to refresh after a status update. */
  onChange?: () => void;
}

/**
 * Story 3.3 — admin shipment panel for one sub-order. Renders the
 * current shipment (if any), an "Attach AWB/courier" form when there
 * isn't one yet, and a status-update mini-form for operators driving
 * the package through delivery manually (Shiprocket webhooks usually
 * advance it automatically; this is the override path).
 *
 * Label + NDR/RTO calls are lazy — only fired when the operator
 * expands the panel, so cards stay light when there are many
 * sub-orders on screen.
 */
export function ShipmentPanel({ subOrderId, onChange }: Props) {
  const [shipment, setShipment] = useState<ShipmentDetail | null>(null);
  const [label, setLabel] = useState<LabelInfo | null>(null);
  const [ndrRto, setNdrRto] = useState<NdrRtoState | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // Default OPEN so the carrier-actions (track / re-attempt / cancel / force-RTO)
  // are visible without hunting for the "Expand" toggle (2026-06-02).
  const [expanded, setExpanded] = useState(true);

  const [creating, setCreating] = useState(false);
  const [createCourier, setCreateCourier] = useState('');
  const [createAwb, setCreateAwb] = useState('');
  const [createUrl, setCreateUrl] = useState('');

  const [statusInput, setStatusInput] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const [loadingLabel, setLoadingLabel] = useState(false);
  const [loadingNdr, setLoadingNdr] = useState(false);

  // Phase 3 Delhivery wiring (2026-06-02) — carrier outbound actions.
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reattempting, setReattempting] = useState(false);
  const [rtoReason, setRtoReason] = useState('');
  const [forcingRto, setForcingRto] = useState(false);
  const [requestingPickup, setRequestingPickup] = useState(false);

  const fetchShipment = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await adminShippingService.getShipment(subOrderId);
      setShipment(res.data ?? null);
    } catch (e: any) {
      // 404 = no shipment yet; treat as null rather than an error so
      // the operator just sees the "Attach AWB" form.
      const status = e?.status ?? e?.response?.status;
      if (status === 404) {
        setShipment(null);
      } else {
        setErr(e?.message || 'Failed to load shipment');
      }
    } finally {
      setLoading(false);
    }
  }, [subOrderId]);

  useEffect(() => {
    fetchShipment();
  }, [fetchShipment]);

  // Auto-fetch the shipping label once a shipment with an AWB is loaded, so the
  // seller / franchise can download it in one click for their own order — no
  // waiting on the Super Admin to fetch + forward it. Fires once (guarded on
  // !label && !loadingLabel); a missing label just shows a "not ready" note.
  useEffect(() => {
    if (expanded && shipment?.awb && !label && !loadingLabel) {
      handleLoadLabel();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipment?.awb, expanded]);

  const handleCreate = async () => {
    if (!createCourier.trim() && !createAwb.trim()) {
      setErr('Provide at least a courier name or AWB');
      return;
    }
    // AWB, when given, is an alphanumeric carrier reference (8-30 chars).
    const awbTrimmed = createAwb.trim();
    if (awbTrimmed && !/^[A-Za-z0-9-]{8,30}$/.test(awbTrimmed)) {
      setErr('AWB must be 8-30 letters, digits, or hyphens');
      return;
    }
    // Tracking URL, when given, must be a valid http(s) URL.
    const urlTrimmed = createUrl.trim();
    if (urlTrimmed) {
      let parsed: URL | null = null;
      try {
        parsed = new URL(urlTrimmed);
      } catch {
        parsed = null;
      }
      if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
        setErr('Tracking URL must be a valid http(s) link');
        return;
      }
    }
    setCreating(true);
    setErr(null);
    try {
      const res = await adminShippingService.createShipment(subOrderId, {
        courierName: createCourier.trim() || undefined,
        awb: createAwb.trim() || undefined,
        trackingUrl: createUrl.trim() || undefined,
      });
      setShipment(res.data ?? null);
      setCreateCourier('');
      setCreateAwb('');
      setCreateUrl('');
      onChange?.();
    } catch (e: any) {
      setErr(e?.body?.message || e?.message || 'Failed to attach shipment');
    } finally {
      setCreating(false);
    }
  };

  const handleStatusUpdate = async () => {
    const statusTrimmed = statusInput.trim();
    if (!statusTrimmed) {
      setErr('Status is required');
      return;
    }
    // Status is a short carrier status token (letters, digits, _ - / and spaces).
    if (!/^[A-Za-z0-9 _/-]{2,40}$/.test(statusTrimmed)) {
      setErr('Status must be 2-40 letters, digits, spaces, or _ / -');
      return;
    }
    setUpdatingStatus(true);
    setErr(null);
    try {
      await adminShippingService.updateStatus(subOrderId, {
        status: statusInput.trim(),
        location: locationInput.trim() || undefined,
      });
      setStatusInput('');
      setLocationInput('');
      await fetchShipment();
      onChange?.();
    } catch (e: any) {
      setErr(e?.body?.message || e?.message || 'Status update failed');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleLoadLabel = async () => {
    setLoadingLabel(true);
    setErr(null);
    try {
      const res = await adminShippingService.getLabel(subOrderId);
      setLabel(res.data ?? null);
    } catch (e: any) {
      setErr(e?.body?.message || e?.message || 'Label not available');
    } finally {
      setLoadingLabel(false);
    }
  };

  const handleLoadNdr = async () => {
    setLoadingNdr(true);
    setErr(null);
    try {
      const res = await adminShippingService.getNdrRto(subOrderId);
      setNdrRto(res.data ?? null);
    } catch (e: any) {
      setErr(e?.body?.message || e?.message || 'NDR/RTO state not available');
    } finally {
      setLoadingNdr(false);
    }
  };

  // ── Phase 3 Delhivery wiring — carrier outbound actions ──
  const msgOf = (res: any, fallback: string) =>
    res?.message ?? res?.data?.message ?? fallback;

  const handleRefreshTracking = async () => {
    setRefreshing(true);
    setErr(null);
    setActionMsg(null);
    try {
      const res = await adminShippingService.refreshTracking(subOrderId);
      setActionMsg(msgOf(res, 'Tracking refreshed'));
      await fetchShipment();
      onChange?.();
    } catch (e: any) {
      setErr(e?.body?.message || e?.message || 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const handleRequestPickup = async () => {
    setRequestingPickup(true);
    setErr(null);
    setActionMsg(null);
    try {
      const res = await adminShippingService.requestPickup(subOrderId);
      const ok = res.data?.success ?? res.success ?? false;
      const msg = res.data?.message ?? res.message ?? 'Pickup requested';
      if (ok) {
        setActionMsg(msg);
        onChange?.();
      } else {
        setErr(msg);
      }
    } catch (e: any) {
      setErr(e?.body?.message || e?.message || 'Pickup request failed');
    } finally {
      setRequestingPickup(false);
    }
  };

  const handleCourierCancel = async () => {
    // Cancels the ORDER (sub-order) AND its Delhivery shipment together: the
    // order-cancel emits orders.sub_order.cancelled_by_admin, which the
    // DelhiveryCancelHandler consumes to void the AWB. force=true covers
    // in-transit (SHIPPED) goods and is permission-gated server-side.
    const reason = window.prompt(
      'Cancel this ORDER and its Delhivery shipment?\n\n' +
        'The sub-order is cancelled, a prepaid customer is refunded, and the ' +
        'Delhivery AWB is voided — this cannot be undone.\n\n' +
        'Enter a cancellation reason (min 10 characters) to confirm:',
      '',
    );
    if (reason === null) return; // operator dismissed the prompt
    if (reason.trim().length < 10) {
      setErr('Cancellation reason must be at least 10 characters.');
      return;
    }
    setCancelling(true);
    setErr(null);
    setActionMsg(null);
    try {
      await adminShippingService.cancelOrder(subOrderId, reason.trim(), true);
      setActionMsg('Order + Delhivery shipment cancelled.');
      await fetchShipment();
      onChange?.();
    } catch (e: any) {
      setErr(e?.body?.message || e?.message || 'Cancel failed');
    } finally {
      setCancelling(false);
    }
  };

  const handleNdrReattempt = async () => {
    setReattempting(true);
    setErr(null);
    setActionMsg(null);
    try {
      const res = await adminShippingService.ndrAction(subOrderId, 'REATTEMPT');
      setActionMsg(msgOf(res, 'Re-attempt requested'));
      await handleLoadNdr();
      onChange?.();
    } catch (e: any) {
      setErr(e?.body?.message || e?.message || 'NDR re-attempt failed');
    } finally {
      setReattempting(false);
    }
  };

  const handleForceRto = async () => {
    if (rtoReason.trim().length < 10) {
      setErr('RTO reason must be at least 10 characters');
      return;
    }
    setForcingRto(true);
    setErr(null);
    setActionMsg(null);
    try {
      const res = await adminShippingService.forceRto(subOrderId, rtoReason.trim());
      setActionMsg(msgOf(res, 'RTO initiated'));
      setRtoReason('');
      await fetchShipment();
      onChange?.();
    } catch (e: any) {
      setErr(e?.body?.message || e?.message || 'Force RTO failed');
    } finally {
      setForcingRto(false);
    }
  };

  return (
    <div style={cardStyle}>
      <div style={headerRow}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>Shipping</span>
          {shipment?.status && (
            <span style={statusPill}>{shipment.status}</span>
          )}
        </div>
        <button type="button" onClick={() => setExpanded((e) => !e)} style={linkBtn}>
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {loading ? (
        <div style={{ fontSize: 12, color: '#6b7280' }}>Loading shipment…</div>
      ) : shipment ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={kvRow}>
            <span style={kLabel}>Carrier</span>
            <span style={kValue}>{shipment.carrier ?? shipment.courierName ?? '—'}</span>
          </div>
          <div style={kvRow}>
            <span style={kLabel}>AWB</span>
            <span style={{ ...kValue, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
              {shipment.awb ?? shipment.trackingNumber ?? '—'}
            </span>
          </div>
          {shipment.lastTrackingEventAt && (
            <div style={kvRow}>
              <span style={kLabel}>Last event</span>
              <span style={kValue}>{formatWhen(shipment.lastTrackingEventAt)}</span>
            </div>
          )}
          {shipment.trackingUrl && (
            <div style={kvRow}>
              <span style={kLabel}>Tracking</span>
              <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                Open courier page ↗
              </a>
            </div>
          )}
        </div>
      ) : (
        <AttachShipmentForm
          courier={createCourier}
          awb={createAwb}
          url={createUrl}
          creating={creating}
          onCourier={setCreateCourier}
          onAwb={setCreateAwb}
          onUrl={setCreateUrl}
          onSubmit={handleCreate}
        />
      )}

      {err && <div style={errBanner}>{err}</div>}

      {expanded && shipment && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Manual status override */}
          <div>
            <div style={subHeader}>Override status</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <input
                type="text"
                value={statusInput}
                placeholder="e.g. SHIPPED / DELIVERED / RTO"
                onChange={(e) => setStatusInput(e.target.value)}
                style={inputStyle}
              />
              <input
                type="text"
                value={locationInput}
                placeholder="Location (optional)"
                onChange={(e) => setLocationInput(e.target.value)}
                style={inputStyle}
              />
              <button
                type="button"
                onClick={handleStatusUpdate}
                disabled={updatingStatus || !statusInput.trim()}
                style={btnPrimary(updatingStatus || !statusInput.trim())}
              >
                {updatingStatus ? 'Saving…' : 'Update'}
              </button>
            </div>
          </div>

          {/* Label — auto-fetched on open (see effect above) so sellers /
              franchise grab it in one click for their own order. */}
          <div>
            <div style={subHeader}>Shipping label</div>
            {label?.labelUrl ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                <a
                  href={String(label.labelUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    ...btnPrimary(false),
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    textDecoration: 'none',
                    width: 'fit-content',
                  }}
                >
                  ⬇ Download shipping label
                </a>
                {label.manifestUrl && (
                  <a href={String(label.manifestUrl)} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                    Download manifest ↗
                  </a>
                )}
              </div>
            ) : loadingLabel ? (
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>Loading label…</div>
            ) : label ? (
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
                Label not generated by Delhivery yet — available once the shipment
                is manifested / picked up.{' '}
                <button type="button" onClick={handleLoadLabel} style={linkBtn}>
                  Retry
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleLoadLabel}
                disabled={loadingLabel}
                style={{ ...btnSecondary(loadingLabel), marginTop: 6 }}
              >
                Get shipping label
              </button>
            )}
          </div>

          {/* NDR / RTO */}
          <div>
            <div style={subHeader}>NDR / RTO</div>
            {ndrRto ? (
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={kvRow}>
                  <span style={kLabel}>Status</span>
                  <span style={kValue}>{ndrRto.status ?? '—'}</span>
                </div>
                {ndrRto.remarks && (
                  <div style={kvRow}>
                    <span style={kLabel}>Remarks</span>
                    <span style={kValue}>{ndrRto.remarks}</span>
                  </div>
                )}
                {ndrRto.lastEventAt && (
                  <div style={kvRow}>
                    <span style={kLabel}>Last event</span>
                    <span style={kValue}>{formatWhen(ndrRto.lastEventAt)}</span>
                  </div>
                )}
                {ndrRto.attempts && ndrRto.attempts.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <div style={{ ...subHeader, fontSize: 11 }}>Attempts</div>
                    <ul style={{ paddingLeft: 18, margin: 0, fontSize: 12 }}>
                      {ndrRto.attempts.map((a, i) => (
                        <li key={i}>
                          {formatWhen(a.at)} {a.reason ? `· ${a.reason}` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={handleLoadNdr}
                disabled={loadingNdr}
                style={{ ...btnSecondary(loadingNdr), marginTop: 6 }}
              >
                {loadingNdr ? 'Fetching…' : 'Fetch NDR / RTO state'}
              </button>
            )}
          </div>

          {/* Phase 3 Delhivery wiring (2026-06-02) — carrier outbound actions.
              These hit Delhivery via the logistics-facade. Cancel is pre-pickup
              only; Force RTO aliases to cancel (Delhivery has no explicit RTO). */}
          <div>
            <div style={subHeader}>Carrier actions (Delhivery)</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleRefreshTracking}
                disabled={refreshing}
                style={btnSecondary(refreshing)}
              >
                {refreshing ? 'Refreshing…' : 'Refresh tracking'}
              </button>
              <button
                type="button"
                onClick={handleNdrReattempt}
                disabled={reattempting}
                style={btnSecondary(reattempting)}
              >
                {reattempting ? 'Requesting…' : 'Re-attempt delivery'}
              </button>
              <button
                type="button"
                onClick={handleCourierCancel}
                disabled={cancelling}
                style={btnSecondary(cancelling)}
              >
                {cancelling ? 'Cancelling…' : 'Cancel order + shipment'}
              </button>
              <button
                type="button"
                onClick={handleRequestPickup}
                disabled={requestingPickup}
                style={btnSecondary(requestingPickup)}
                title="Schedule a Delhivery pickup at your warehouse for today (collects all ready parcels)"
              >
                {requestingPickup ? 'Requesting…' : 'Request pickup'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <input
                type="text"
                value={rtoReason}
                placeholder="RTO reason (min 10 chars)"
                onChange={(e) => setRtoReason(e.target.value)}
                style={{ ...inputStyle, minWidth: 220 }}
              />
              <button
                type="button"
                onClick={handleForceRto}
                disabled={forcingRto || rtoReason.trim().length < 10}
                style={btnPrimary(forcingRto || rtoReason.trim().length < 10)}
              >
                {forcingRto ? 'Forcing…' : 'Force RTO'}
              </button>
            </div>
            {actionMsg && (
              <div style={{ marginTop: 6, fontSize: 12, color: '#065f46' }}>{actionMsg}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AttachShipmentForm({
  courier,
  awb,
  url,
  creating,
  onCourier,
  onAwb,
  onUrl,
  onSubmit,
}: {
  courier: string;
  awb: string;
  url: string;
  creating: boolean;
  onCourier: (v: string) => void;
  onAwb: (v: string) => void;
  onUrl: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
      <div style={{ color: '#6b7280' }}>
        No shipment recorded yet. Attach courier + AWB manually when Shiprocket isn't in the loop.
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input
          type="text"
          value={courier}
          placeholder="Courier name (e.g. Bluedart)"
          onChange={(e) => onCourier(e.target.value)}
          style={inputStyle}
        />
        <input
          type="text"
          value={awb}
          placeholder="AWB / tracking number"
          onChange={(e) => onAwb(e.target.value)}
          style={inputStyle}
        />
        <input
          type="text"
          value={url}
          placeholder="Tracking URL (optional)"
          onChange={(e) => onUrl(e.target.value)}
          style={{ ...inputStyle, minWidth: 240 }}
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={creating || (!courier.trim() && !awb.trim())}
          style={btnPrimary(creating || (!courier.trim() && !awb.trim()))}
        >
          {creating ? 'Attaching…' : 'Attach'}
        </button>
      </div>
    </div>
  );
}

// ── Styles (inline to match the page-level convention; this file is a
//   self-contained drop-in component for the order detail page). ────
const cardStyle: React.CSSProperties = {
  marginTop: 14,
  padding: 14,
  background: '#fff',
  borderRadius: 8,
  border: '1px solid #e5e7eb',
};
const headerRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 10,
};
const subHeader: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#374151',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};
const kvRow: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 13 };
const kLabel: React.CSSProperties = { color: '#6b7280' };
const kValue: React.CSSProperties = { fontWeight: 600, color: '#111827' };
const inputStyle: React.CSSProperties = {
  height: 32,
  padding: '0 8px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  minWidth: 140,
};
const statusPill: React.CSSProperties = {
  padding: '2px 8px',
  fontSize: 11,
  fontWeight: 600,
  background: '#dbeafe',
  color: '#1e3a8a',
  borderRadius: 999,
};
const linkBtn: React.CSSProperties = {
  background: 'transparent',
  border: 0,
  color: '#2563eb',
  fontWeight: 600,
  fontSize: 12,
  cursor: 'pointer',
  padding: 0,
};
const linkStyle: React.CSSProperties = { color: '#2563eb', fontWeight: 600, fontSize: 12, textDecoration: 'none' };
const errBanner: React.CSSProperties = {
  marginTop: 8,
  padding: '6px 10px',
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: 6,
  fontSize: 12,
  color: '#991b1b',
};
// preStyle removed — the raw-JSON label fallback was replaced with a friendly
// "label not generated yet" message, so the <pre> style is no longer needed.

function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    height: 32,
    padding: '0 14px',
    background: disabled ? '#cbd5e1' : '#111827',
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    border: 0,
    borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}
function btnSecondary(disabled: boolean): React.CSSProperties {
  return {
    height: 28,
    padding: '0 12px',
    background: '#fff',
    color: '#111827',
    fontSize: 12,
    fontWeight: 600,
    border: '1px solid #d1d5db',
    borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  };
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
