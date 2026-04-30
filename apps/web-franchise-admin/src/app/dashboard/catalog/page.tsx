'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFranchisesService } from '@/services/admin-franchises.service';
import { useModal } from '@sportsmart/ui';

// Must match the server-side MappingApprovalStatus enum in
// prisma/schema/_base.prisma. Keep in sync if the enum ever gains
// new values.
type ApprovalStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'STOPPED';

interface CatalogMapping {
  id: string;
  globalSku?: string | null;
  franchiseSku?: string | null;
  barcode?: string | null;
  approvalStatus: ApprovalStatus;
  isActive: boolean;
  createdAt: string;
  franchise?: {
    id: string;
    franchiseCode?: string | null;
    businessName?: string | null;
    ownerName?: string | null;
  } | null;
  product?: {
    id: string;
    title: string;
  } | null;
  variant?: {
    id: string;
    sku?: string | null;
  } | null;
  // Live FranchiseStock joined by the admin catalog endpoint. `null`
  // means the franchise has never received stock for this mapping —
  // distinct from `onHandQty: 0` (received some, sold all).
  stock?: {
    onHandQty: number;
    reservedQty: number;
    availableQty: number;
    damagedQty: number;
    inTransitQty: number;
    lowStockThreshold: number;
    lastRestockedAt: string | null;
  } | null;
}

const APPROVAL_LABELS: Record<ApprovalStatus, string> = {
  PENDING_APPROVAL: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  STOPPED: 'Stopped',
};

const APPROVAL_COLORS: Record<ApprovalStatus, { bg: string; fg: string }> = {
  PENDING_APPROVAL: { bg: '#fef3c7', fg: '#92400e' },
  APPROVED: { bg: '#dcfce7', fg: '#15803d' },
  REJECTED: { bg: '#fee2e2', fg: '#991b1b' },
  STOPPED: { bg: '#e5e7eb', fg: '#374151' },
};

const DASH = '—';

interface FranchiseGroup {
  franchiseId: string;
  businessName: string | null;
  franchiseCode: string | null;
  mappings: CatalogMapping[];
}

// Group mappings by franchise so each franchise renders as one card.
// Preserves the order in which franchises first appear in the input
// list (which is what the API returned, so the UI matches the
// backend's natural ordering — usually most recently created first).
function groupByFranchise(mappings: CatalogMapping[]): FranchiseGroup[] {
  const groups: FranchiseGroup[] = [];
  const byId = new Map<string, FranchiseGroup>();
  for (const m of mappings) {
    const fid = m.franchise?.id || 'unknown';
    let g = byId.get(fid);
    if (!g) {
      g = {
        franchiseId: fid,
        businessName: m.franchise?.businessName || null,
        franchiseCode: m.franchise?.franchiseCode || null,
        mappings: [],
      };
      byId.set(fid, g);
      groups.push(g);
    }
    g.mappings.push(m);
  }
  return groups;
}

// Deterministic per-franchise avatar colour so each card has a
// distinct identity stripe without manual configuration.
function avatarPalette(seed: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return {
    bg: `hsl(${hue}, 65%, 92%)`,
    fg: `hsl(${hue}, 55%, 32%)`,
  };
}

function MenuItem({
  label,
  onClick,
  disabled,
  tone,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'success' | 'danger';
}) {
  const color = disabled
    ? '#9ca3af'
    : tone === 'success'
      ? '#15803d'
      : tone === 'danger'
        ? '#991b1b'
        : '#374151';
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '9px 14px',
        fontSize: 13,
        fontWeight: 500,
        color,
        background: 'transparent',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = '#f9fafb';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {label}
    </button>
  );
}

function CountChip({
  label,
  count,
  bg,
  fg,
}: {
  label: string;
  count: number;
  bg: string;
  fg: string;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 10px',
        background: bg,
        color: fg,
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.4,
      }}
    >
      <span>{label}</span>
      <span style={{ fontWeight: 700 }}>{count}</span>
    </span>
  );
}

export default function FranchiseCatalogPage() {
  const { confirmDialog, notify } = useModal();
  const [mappings, setMappings] = useState<CatalogMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  // Per-card kebab menu — at most one open at a time, keyed by franchiseId
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  // Per-card bulk-action busy flag — disables the menu while a batch runs
  const [bulkBusyFor, setBulkBusyFor] = useState<string | null>(null);
  // Accordion: which franchise cards are expanded. Empty = all collapsed,
  // showing just the franchise header + summary chips. Click the chevron
  // (or the header itself) to expand a card's product table.
  const [expandedFor, setExpandedFor] = useState<Set<string>>(new Set());
  const menuRef = useRef<HTMLDivElement | null>(null);

  const toggleExpanded = (franchiseId: string) => {
    setExpandedFor((prev) => {
      const next = new Set(prev);
      if (next.has(franchiseId)) next.delete(franchiseId);
      else next.add(franchiseId);
      return next;
    });
  };

  // Close the menu when clicking anywhere outside it
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setOpenMenuFor(null);
    };
    if (openMenuFor) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openMenuFor]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFranchisesService.listCatalog({
        page,
        limit: 50,
        approvalStatus: statusFilter || undefined,
      });
      const data = res.data as any;
      setMappings(data?.mappings ?? []);
      setTotalPages(data?.pagination?.totalPages ?? 1);
    } catch {
      // Soft-fail: render the empty-state instead of crashing the page.
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleApprove = async (mappingId: string) => {
    setPendingAction(mappingId);
    try {
      await adminFranchisesService.approveCatalogMapping(mappingId);
      await load();
    } catch {
      /* swallow; row stays pending */
    } finally {
      setPendingAction(null);
    }
  };

  const handleStop = async (mappingId: string) => {
    if (!(await confirmDialog('Stop this franchise catalog mapping? The franchise will no longer sell this product.'))) return;
    setPendingAction(mappingId);
    try {
      await adminFranchisesService.stopCatalogMapping(mappingId);
      await load();
    } catch {
      /* swallow */
    } finally {
      setPendingAction(null);
    }
  };

  const handleReject = async (mappingId: string) => {
    if (
      !(await confirmDialog(
        'Reject this submission? The franchise will be able to edit it and re-submit for review.',
      ))
    )
      return;
    setPendingAction(mappingId);
    try {
      await adminFranchisesService.rejectCatalogMapping(mappingId);
      await load();
    } catch (err: any) {
      // Surface the failure — silent swallow was masking the case
      // where the migration hadn't been applied (REJECTED enum value
      // missing in the DB) and the API was 500-ing. The list still
      // re-loads so other rows reflect any successful changes.
      const msg =
        err?.body?.message ||
        err?.message ||
        'Failed to reject. Make sure the API has been restarted and the latest migration is applied.';
      void notify(msg);
      await load();
    } finally {
      setPendingAction(null);
    }
  };

  // Bulk-approve every PENDING mapping for this franchise. The backend
  // doesn't expose a batch endpoint yet, so we fan out one call per row
  // — fine for the current page size (max 50).
  const bulkApprove = async (group: FranchiseGroup) => {
    setOpenMenuFor(null);
    const targets = group.mappings.filter((m) => m.approvalStatus === 'PENDING_APPROVAL');
    if (targets.length === 0) return;
    if (!(await confirmDialog(`Approve all ${targets.length} pending mapping(s) for ${group.businessName || 'this franchise'}?`))) return;
    setBulkBusyFor(group.franchiseId);
    try {
      await Promise.allSettled(
        targets.map((m) => adminFranchisesService.approveCatalogMapping(m.id)),
      );
      await load();
    } finally {
      setBulkBusyFor(null);
    }
  };

  const bulkStop = async (group: FranchiseGroup) => {
    setOpenMenuFor(null);
    const targets = group.mappings.filter((m) => m.approvalStatus === 'APPROVED');
    if (targets.length === 0) return;
    if (!(await confirmDialog(`Stop all ${targets.length} approved mapping(s) for ${group.businessName || 'this franchise'}? The franchise will no longer sell these products.`))) return;
    setBulkBusyFor(group.franchiseId);
    try {
      await Promise.allSettled(
        targets.map((m) => adminFranchisesService.stopCatalogMapping(m.id)),
      );
      await load();
    } finally {
      setBulkBusyFor(null);
    }
  };

  const groups = groupByFranchise(mappings);

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Franchise Catalog Mappings</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
        Review and manage product mappings across all franchises.
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <select
          value={statusFilter}
          onChange={(e) => {
            setPage(1);
            setStatusFilter(e.target.value);
          }}
          style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, background: '#fff' }}
        >
          <option value="">All approval statuses</option>
          <option value="PENDING_APPROVAL">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="STOPPED">Stopped</option>
        </select>
        {!loading && groups.length > 0 && (
          <span style={{ fontSize: 13, color: '#6b7280' }}>
            {groups.length} franchise{groups.length === 1 ? '' : 's'} · {mappings.length} mapping{mappings.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10 }}>Loading...</div>
      ) : mappings.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10 }}>No catalog mappings found</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {groups.map((group) => {
            const approvedCount = group.mappings.filter((m) => m.approvalStatus === 'APPROVED').length;
            const pendingCount = group.mappings.filter((m) => m.approvalStatus === 'PENDING_APPROVAL').length;
            const stoppedCount = group.mappings.filter((m) => m.approvalStatus === 'STOPPED').length;
            const rejectedCount = group.mappings.filter((m) => m.approvalStatus === 'REJECTED').length;
            // Card-header stock totals — sum across every mapping in
            // this franchise so the admin can scan card headers without
            // expanding each. `availableQty` is what the routing engine
            // actually offers customers; `reservedQty` shows in-flight
            // orders.
            const onHandTotal = group.mappings.reduce((s, m) => s + (m.stock?.onHandQty ?? 0), 0);
            const reservedTotal = group.mappings.reduce((s, m) => s + (m.stock?.reservedQty ?? 0), 0);
            const availableTotal = group.mappings.reduce((s, m) => s + (m.stock?.availableQty ?? 0), 0);
            const initial = (group.businessName || group.franchiseCode || '?').charAt(0).toUpperCase();
            const avatar = avatarPalette(group.franchiseId);
            const isExpanded = expandedFor.has(group.franchiseId);

            return (
              <div
                key={group.franchiseId}
                style={{
                  background: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: 12,
                  overflow: 'hidden',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                }}
              >
                {/* Card header — clickable to expand/collapse the body. */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  onClick={() => toggleExpanded(group.franchiseId)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleExpanded(group.franchiseId);
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '14px 18px',
                    background: '#fafafa',
                    borderBottom: isExpanded ? '1px solid #e5e7eb' : 'none',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: '50%',
                      background: avatar.bg,
                      color: avatar.fg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 16,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {initial}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>
                      {group.businessName || DASH}
                    </div>
                    {group.franchiseCode && (
                      <div style={{ fontSize: 12, color: '#6b7280', fontFamily: 'monospace' }}>
                        {group.franchiseCode}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
                    {/* Stock totals — these update live as orders are
                        placed (reservedQty bumps) and shipped/sold
                        (onHandQty drops). Showing both lets the admin
                        spot a franchise that's selling fast or stuck
                        with reserved-but-not-shipped inventory. */}
                    <CountChip label="On hand" count={onHandTotal} bg="#ecfeff" fg="#0e7490" />
                    {reservedTotal > 0 && (
                      <CountChip label="Reserved" count={reservedTotal} bg="#fef9c3" fg="#854d0e" />
                    )}
                    <CountChip label="Available" count={availableTotal} bg="#f0fdf4" fg="#166534" />

                    {approvedCount > 0 && (
                      <CountChip label="Approved" count={approvedCount} bg={APPROVAL_COLORS.APPROVED.bg} fg={APPROVAL_COLORS.APPROVED.fg} />
                    )}
                    {pendingCount > 0 && (
                      <CountChip label="Pending" count={pendingCount} bg={APPROVAL_COLORS.PENDING_APPROVAL.bg} fg={APPROVAL_COLORS.PENDING_APPROVAL.fg} />
                    )}
                    {rejectedCount > 0 && (
                      <CountChip label="Rejected" count={rejectedCount} bg={APPROVAL_COLORS.REJECTED.bg} fg={APPROVAL_COLORS.REJECTED.fg} />
                    )}
                    {stoppedCount > 0 && (
                      <CountChip label="Stopped" count={stoppedCount} bg={APPROVAL_COLORS.STOPPED.bg} fg={APPROVAL_COLORS.STOPPED.fg} />
                    )}
                    <CountChip label="Total" count={group.mappings.length} bg="#eef2ff" fg="#4338ca" />

                    {/* Per-card kebab menu — bulk actions for this franchise.
                        stopPropagation so opening the menu doesn't also
                        toggle the accordion expand/collapse. */}
                    <div
                      style={{ position: 'relative', marginLeft: 4 }}
                      ref={openMenuFor === group.franchiseId ? menuRef : null}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        aria-label="Bulk actions"
                        aria-haspopup="menu"
                        aria-expanded={openMenuFor === group.franchiseId}
                        disabled={bulkBusyFor === group.franchiseId}
                        onClick={() =>
                          setOpenMenuFor((prev) => (prev === group.franchiseId ? null : group.franchiseId))
                        }
                        style={{
                          width: 32,
                          height: 32,
                          padding: 0,
                          border: '1px solid #e5e7eb',
                          background: openMenuFor === group.franchiseId ? '#f3f4f6' : '#fff',
                          borderRadius: 6,
                          cursor: bulkBusyFor === group.franchiseId ? 'wait' : 'pointer',
                          color: '#6b7280',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {bulkBusyFor === group.franchiseId ? (
                          <span style={{ fontSize: 13 }}>...</span>
                        ) : (
                          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                            <circle cx="12" cy="5" r="1.5" fill="currentColor" />
                            <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                            <circle cx="12" cy="19" r="1.5" fill="currentColor" />
                          </svg>
                        )}
                      </button>

                      {openMenuFor === group.franchiseId && (
                        <div
                          role="menu"
                          style={{
                            position: 'absolute',
                            top: '100%',
                            right: 0,
                            marginTop: 6,
                            minWidth: 220,
                            background: '#fff',
                            border: '1px solid #e5e7eb',
                            borderRadius: 8,
                            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                            zIndex: 30,
                            overflow: 'hidden',
                          }}
                        >
                          <MenuItem
                            label={`Approve all pending${pendingCount > 0 ? ` (${pendingCount})` : ''}`}
                            disabled={pendingCount === 0}
                            onClick={() => bulkApprove(group)}
                            tone="success"
                          />
                          <MenuItem
                            label={`Stop all approved${approvedCount > 0 ? ` (${approvedCount})` : ''}`}
                            disabled={approvedCount === 0}
                            onClick={() => bulkStop(group)}
                            tone="danger"
                          />
                          <div style={{ borderTop: '1px solid #f3f4f6' }} />
                          <MenuItem
                            label="Filter: pending only"
                            disabled={statusFilter === 'PENDING_APPROVAL' || pendingCount === 0}
                            onClick={() => {
                              setOpenMenuFor(null);
                              setPage(1);
                              setStatusFilter('PENDING_APPROVAL');
                            }}
                          />
                          <MenuItem
                            label="Filter: approved only"
                            disabled={statusFilter === 'APPROVED' || approvedCount === 0}
                            onClick={() => {
                              setOpenMenuFor(null);
                              setPage(1);
                              setStatusFilter('APPROVED');
                            }}
                          />
                          {statusFilter !== '' && (
                            <MenuItem
                              label="Show all statuses"
                              onClick={() => {
                                setOpenMenuFor(null);
                                setPage(1);
                                setStatusFilter('');
                              }}
                            />
                          )}
                        </div>
                      )}
                    </div>

                    {/* Expand/collapse chevron — visible cue for the
                        accordion. Whole header is clickable too, but the
                        chevron makes the affordance explicit. */}
                    <button
                      type="button"
                      aria-label={isExpanded ? 'Collapse' : 'Expand'}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpanded(group.franchiseId);
                      }}
                      style={{
                        width: 32,
                        height: 32,
                        padding: 0,
                        border: '1px solid #e5e7eb',
                        background: '#fff',
                        borderRadius: 6,
                        cursor: 'pointer',
                        color: '#6b7280',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginLeft: 2,
                      }}
                    >
                      <svg
                        viewBox="0 0 20 20"
                        width="16"
                        height="16"
                        aria-hidden="true"
                        style={{
                          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 0.15s ease',
                        }}
                      >
                        <path
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 8l5 5 5-5"
                        />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Mapping rows for this franchise — accordion body, only
                    rendered when this card is expanded. */}
                {isExpanded && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e5e7eb', background: '#fcfcfd' }}>
                      {['Product', 'SKU', 'On hand', 'Reserved', 'Available', 'Approval', 'Created', 'Actions'].map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: h === 'On hand' || h === 'Reserved' || h === 'Available' ? 'right' : 'left',
                            padding: '8px 18px',
                            fontSize: 10,
                            fontWeight: 700,
                            color: '#6b7280',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {group.mappings.map((m, idx) => {
                      // Display SKU — prefer the franchise's override,
                      // fall back to the master/global SKU otherwise.
                      // Empty franchiseSku is the common case now that
                      // it's optional (defaults to the master SKU).
                      const sku = m.franchiseSku || m.globalSku || m.variant?.sku || DASH;
                      const usingMaster = !m.franchiseSku;
                      const color = APPROVAL_COLORS[m.approvalStatus];
                      const isBusy = pendingAction === m.id;
                      // Live stock for this row. `null` means no
                      // FranchiseStock row exists yet — render a faint
                      // dash so it's clearly distinct from "0 units".
                      const stock = m.stock;
                      const onHand = stock?.onHandQty;
                      const reserved = stock?.reservedQty ?? 0;
                      const available = stock?.availableQty;
                      const lowThreshold = stock?.lowStockThreshold ?? 5;
                      const isLow = available !== undefined && available > 0 && available <= lowThreshold;
                      const isOut = available === 0;

                      return (
                        <tr
                          key={m.id}
                          style={{
                            borderBottom: idx === group.mappings.length - 1 ? 'none' : '1px solid #f3f4f6',
                          }}
                        >
                          <td style={{ padding: '10px 18px', color: '#111827' }}>
                            {m.product?.title || DASH}
                          </td>
                          <td
                            style={{
                              padding: '10px 18px',
                              fontFamily: 'monospace',
                              fontSize: 12,
                              color: usingMaster ? '#94a3b8' : '#374151',
                            }}
                            title={
                              usingMaster
                                ? 'Master SKU — this franchise has not set a custom SKU'
                                : 'Custom franchise SKU'
                            }
                          >
                            {sku}
                          </td>
                          <td
                            style={{
                              padding: '10px 18px',
                              textAlign: 'right',
                              color: stock ? '#111827' : '#9ca3af',
                              fontVariantNumeric: 'tabular-nums',
                              fontWeight: 600,
                            }}
                          >
                            {onHand ?? DASH}
                          </td>
                          <td
                            style={{
                              padding: '10px 18px',
                              textAlign: 'right',
                              color: reserved > 0 ? '#854d0e' : '#9ca3af',
                              fontVariantNumeric: 'tabular-nums',
                              fontWeight: reserved > 0 ? 600 : 400,
                            }}
                          >
                            {stock ? reserved : DASH}
                          </td>
                          <td
                            style={{
                              padding: '10px 18px',
                              textAlign: 'right',
                              color: !stock
                                ? '#9ca3af'
                                : isOut
                                  ? '#b91c1c'
                                  : isLow
                                    ? '#b45309'
                                    : '#166534',
                              fontVariantNumeric: 'tabular-nums',
                              fontWeight: 700,
                            }}
                            title={
                              !stock
                                ? 'No stock record yet — never received'
                                : isOut
                                  ? 'Out of stock'
                                  : isLow
                                    ? `Low stock (≤ ${lowThreshold})`
                                    : ''
                            }
                          >
                            {available ?? DASH}
                          </td>
                          <td style={{ padding: '10px 18px' }}>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                padding: '2px 8px',
                                borderRadius: 4,
                                background: color.bg,
                                color: color.fg,
                              }}
                            >
                              {APPROVAL_LABELS[m.approvalStatus] || m.approvalStatus}
                            </span>
                          </td>
                          <td style={{ padding: '10px 18px', color: '#6b7280', fontSize: 12 }}>
                            {new Date(m.createdAt).toLocaleDateString()}
                          </td>
                          <td style={{ padding: '10px 18px' }}>
                            {m.approvalStatus === 'PENDING_APPROVAL' ? (
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button
                                  disabled={isBusy}
                                  onClick={() => handleApprove(m.id)}
                                  style={{
                                    padding: '6px 12px',
                                    border: '1px solid #15803d',
                                    background: isBusy ? '#e5e7eb' : '#16a34a',
                                    color: '#fff',
                                    borderRadius: 6,
                                    fontSize: 12,
                                    fontWeight: 500,
                                    cursor: isBusy ? 'default' : 'pointer',
                                  }}
                                >
                                  {isBusy ? '...' : 'Approve'}
                                </button>
                                <button
                                  disabled={isBusy}
                                  onClick={() => handleReject(m.id)}
                                  title="Send back to franchise for revision"
                                  style={{
                                    padding: '6px 12px',
                                    border: '1px solid #fecaca',
                                    background: isBusy ? '#fef2f2' : '#fff',
                                    color: '#b91c1c',
                                    borderRadius: 6,
                                    fontSize: 12,
                                    fontWeight: 500,
                                    cursor: isBusy ? 'default' : 'pointer',
                                  }}
                                >
                                  {isBusy ? '...' : 'Reject'}
                                </button>
                              </div>
                            ) : m.approvalStatus === 'APPROVED' ? (
                              <button
                                disabled={isBusy}
                                onClick={() => handleStop(m.id)}
                                style={{
                                  padding: '6px 12px',
                                  border: '1px solid #d1d5db',
                                  background: '#fff',
                                  color: '#991b1b',
                                  borderRadius: 6,
                                  fontSize: 12,
                                  fontWeight: 500,
                                  cursor: isBusy ? 'default' : 'pointer',
                                }}
                              >
                                {isBusy ? '...' : 'Stop'}
                              </button>
                            ) : m.approvalStatus === 'REJECTED' ? (
                              // Rejected mappings are now in the franchise's
                              // court — they need to fix and re-submit. Show a
                              // muted "awaiting revision" state instead of an
                              // action so the admin doesn't repeatedly reject
                              // the same row.
                              <span
                                style={{
                                  fontSize: 11,
                                  color: '#991b1b',
                                  fontStyle: 'italic',
                                  fontWeight: 500,
                                }}
                              >
                                Awaiting franchise revision
                              </span>
                            ) : (
                              <span style={{ color: '#9ca3af', fontSize: 12 }}>{DASH}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                )}
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            style={{
              padding: '8px 16px',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              background: '#fff',
              cursor: page <= 1 ? 'default' : 'pointer',
              fontSize: 13,
            }}
          >
            Prev
          </button>
          <span style={{ padding: '8px 12px', fontSize: 13 }}>
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            style={{
              padding: '8px 16px',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              background: '#fff',
              cursor: page >= totalPages ? 'default' : 'pointer',
              fontSize: 13,
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
