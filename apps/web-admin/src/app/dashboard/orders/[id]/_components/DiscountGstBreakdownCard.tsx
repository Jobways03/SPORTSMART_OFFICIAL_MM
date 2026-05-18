// Per-item GST + discount breakdown.
//
// Renders the OrderItemTaxSnapshot rows from the admin orders API
// (`/api/v1/admin/orders/:id` → orders.service.getOrder), giving the
// Seller Admin the same per-line CGST/SGST/IGST visibility the Super
// Admin has. Source of truth is the allocation snapshot taken at
// checkout — values here are historical and survive later discount edits.
//
// Empty for legacy orders without snapshot rows; the parent only mounts
// when at least one row exists.

'use client';

interface OrderItemLite {
  id: string;
  productTitle: string;
  sku?: string | null;
  unitPrice: number;
  quantity: number;
}

interface OrderDiscountRow {
  id: string;
  discountId: string;
  discountCode: string | null;
  discountType: string;
  discountMethod: string;
  discountNature: string;
  source: string;
  discountAmountInPaise: string;
  fundingType: string;
}

interface OrderItemDiscountRow {
  id: string;
  orderItemId: string;
  subOrderId: string;
  sellerId: string | null;
  productId: string;
  discountId: string;
  discountCode: string | null;
  discountAmountInPaise: string;
  fundingType: string;
}

interface OrderItemTaxSnapshotRow {
  orderItemId: string;
  grossLineAmountInPaise: string;
  discountAmountInPaise: string;
  taxableAmountInPaise: string;
  gstRateBps: number;
  cgstAmountInPaise: string;
  sgstAmountInPaise: string;
  igstAmountInPaise: string;
  totalTaxAmountInPaise: string;
  lineTotalAfterDiscountAndTaxInPaise: string;
}

interface DiscountLiabilityLedgerRow {
  id: string;
  orderItemId: string | null;
  sellerId: string | null;
  fundingType: string;
  liabilityParty: string;
  amountInPaise: string;
  status: string;
}

interface Props {
  breakdown: {
    orderDiscounts: OrderDiscountRow[];
    orderItemDiscounts: OrderItemDiscountRow[];
    taxSnapshots: OrderItemTaxSnapshotRow[];
    liabilityLedger: DiscountLiabilityLedgerRow[];
  };
  orderItems: OrderItemLite[];
}

const fmtPaise = (v: string | number): string => {
  // BigInt → string on the wire (Prisma's BigInt → JSON convention).
  const n = Number(v);
  return `₹${(n / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const fmtRate = (bps: number): string =>
  bps === 0 ? '—' : `${(bps / 100).toFixed(2)}%`;

const fundingPillStyle = (fundingType: string): React.CSSProperties => {
  const colors: Record<string, { bg: string; fg: string; border: string }> = {
    PLATFORM: { bg: '#eff6ff', fg: '#1e40af', border: '#bfdbfe' },
    SELLER: { bg: '#fef3c7', fg: '#92400e', border: '#fde68a' },
    BRAND: { bg: '#fae8ff', fg: '#86198f', border: '#f5d0fe' },
    SHARED: { bg: '#ecfdf5', fg: '#065f46', border: '#a7f3d0' },
    NONE: { bg: '#f3f4f6', fg: '#374151', border: '#e5e7eb' },
  };
  const c = colors[fundingType] ?? colors.NONE;
  return {
    display: 'inline-block',
    padding: '2px 8px',
    background: c.bg,
    color: c.fg,
    border: `1px solid ${c.border}`,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.3,
  };
};

const liabilityStatusStyle = (status: string): React.CSSProperties => {
  const colors: Record<string, { bg: string; fg: string }> = {
    PENDING: { bg: '#fef3c7', fg: '#92400e' },
    APPLIED: { bg: '#ecfdf5', fg: '#065f46' },
    REVERSED: { bg: '#fee2e2', fg: '#991b1b' },
    SETTLED: { bg: '#dbeafe', fg: '#1e40af' },
  };
  const c = colors[status] ?? { bg: '#f3f4f6', fg: '#374151' };
  return {
    display: 'inline-block',
    padding: '2px 8px',
    background: c.bg,
    color: c.fg,
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
  };
};

export function DiscountGstBreakdownCard({ breakdown, orderItems }: Props) {
  const itemById = new Map(orderItems.map((it) => [it.id, it]));

  const liabilityByParty = breakdown.liabilityLedger.reduce<
    Record<string, number>
  >((acc, row) => {
    const amount = Number(row.amountInPaise);
    acc[row.liabilityParty] = (acc[row.liabilityParty] ?? 0) + amount;
    return acc;
  }, {});

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: 20,
        marginBottom: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
          Discount &amp; GST Breakdown
        </h3>
      </div>
      <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 16px' }}>
        Per-item discount allocation, GST on post-discount taxable value, and
        funding split. Snapshot at order time — survives later discount edits.
      </p>

      {breakdown.orderDiscounts.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px', color: '#374151' }}>
            Discount applied
          </h4>
          {breakdown.orderDiscounts.map((od) => (
            <div
              key={od.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                background: '#fafbfc',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                marginBottom: 6,
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 13, color: '#111827' }}>
                {od.discountCode ?? '—'}
              </span>
              <span style={{ fontSize: 11, color: '#6b7280' }}>
                {od.discountType.replace(/_/g, ' ')} · {od.source}
              </span>
              <span style={fundingPillStyle(od.fundingType)}>{od.fundingType}</span>
              <span style={{ marginLeft: 'auto', fontWeight: 600, fontSize: 13, color: '#dc2626' }}>
                −{fmtPaise(od.discountAmountInPaise)}
              </span>
            </div>
          ))}
        </div>
      )}

      {breakdown.taxSnapshots.length > 0 && (
        <div style={{ marginBottom: 18, overflowX: 'auto' }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px', color: '#374151' }}>
            Per-line allocation &amp; GST
          </h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <th style={th}>Item</th>
                <th style={thRight}>Gross</th>
                <th style={thRight}>Discount</th>
                <th style={thRight}>Taxable</th>
                <th style={thRight}>GST rate</th>
                <th style={thRight}>CGST</th>
                <th style={thRight}>SGST</th>
                <th style={thRight}>IGST</th>
                <th style={thRight}>Line total</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.taxSnapshots.map((snap) => {
                const item = itemById.get(snap.orderItemId);
                const itemDiscounts = breakdown.orderItemDiscounts.filter(
                  (d) => d.orderItemId === snap.orderItemId,
                );
                return (
                  <tr key={snap.orderItemId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={td}>
                      <div style={{ fontWeight: 600, color: '#111827' }}>
                        {item?.productTitle ?? snap.orderItemId.slice(0, 8)}
                      </div>
                      {item?.sku && (
                        <div style={{ fontSize: 10, color: '#6b7280', fontFamily: 'monospace' }}>
                          {item.sku}
                        </div>
                      )}
                      {itemDiscounts.length > 0 && (
                        <div style={{ marginTop: 4 }}>
                          {itemDiscounts.map((d) => (
                            <span
                              key={d.id}
                              style={{ ...fundingPillStyle(d.fundingType), marginRight: 4 }}
                            >
                              {d.discountCode ?? d.fundingType}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td style={tdRight}>{fmtPaise(snap.grossLineAmountInPaise)}</td>
                    <td style={tdRight}>
                      {Number(snap.discountAmountInPaise) > 0 ? (
                        <span style={{ color: '#dc2626', fontWeight: 600 }}>
                          −{fmtPaise(snap.discountAmountInPaise)}
                        </span>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>—</span>
                      )}
                    </td>
                    <td style={{ ...tdRight, fontWeight: 600 }}>
                      {fmtPaise(snap.taxableAmountInPaise)}
                    </td>
                    <td style={tdRight}>{fmtRate(snap.gstRateBps)}</td>
                    <td style={tdRight}>
                      {Number(snap.cgstAmountInPaise) > 0
                        ? fmtPaise(snap.cgstAmountInPaise)
                        : '—'}
                    </td>
                    <td style={tdRight}>
                      {Number(snap.sgstAmountInPaise) > 0
                        ? fmtPaise(snap.sgstAmountInPaise)
                        : '—'}
                    </td>
                    <td style={tdRight}>
                      {Number(snap.igstAmountInPaise) > 0
                        ? fmtPaise(snap.igstAmountInPaise)
                        : '—'}
                    </td>
                    <td style={{ ...tdRight, fontWeight: 700 }}>
                      {fmtPaise(snap.lineTotalAfterDiscountAndTaxInPaise)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {breakdown.liabilityLedger.length > 0 && (
        <div>
          <h4 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px', color: '#374151' }}>
            Funding liability
          </h4>
          <p style={{ fontSize: 11, color: '#6b7280', margin: '0 0 8px' }}>
            Source of truth for who absorbs the discount cost. SHARED-funded
            discounts produce one entry per party.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            {Object.entries(liabilityByParty).map(([party, total]) => (
              <div
                key={party}
                style={{
                  padding: '8px 14px',
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  background: '#fafbfc',
                }}
              >
                <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {party}
                </div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {fmtPaise(total.toString())}
                </div>
              </div>
            ))}
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <th style={th}>Item</th>
                <th style={th}>Funding</th>
                <th style={th}>Liability party</th>
                <th style={thRight}>Amount</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.liabilityLedger.map((row) => {
                const item = row.orderItemId ? itemById.get(row.orderItemId) : null;
                return (
                  <tr key={row.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={td}>
                      {item?.productTitle ?? row.orderItemId?.slice(0, 8) ?? '—'}
                    </td>
                    <td style={td}>
                      <span style={fundingPillStyle(row.fundingType)}>{row.fundingType}</span>
                    </td>
                    <td style={td}>
                      <span style={fundingPillStyle(row.liabilityParty)}>
                        {row.liabilityParty}
                      </span>
                    </td>
                    <td style={{ ...tdRight, fontWeight: 600 }}>
                      {fmtPaise(row.amountInPaise)}
                    </td>
                    <td style={td}>
                      <span style={liabilityStatusStyle(row.status)}>{row.status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '8px 10px',
  fontWeight: 600,
  fontSize: 11,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  textAlign: 'left',
};

const thRight: React.CSSProperties = {
  ...th,
  textAlign: 'right',
};

const td: React.CSSProperties = {
  padding: '10px',
  fontSize: 12,
  color: '#374151',
  textAlign: 'left',
  verticalAlign: 'top',
};

const tdRight: React.CSSProperties = {
  ...td,
  textAlign: 'right',
};
