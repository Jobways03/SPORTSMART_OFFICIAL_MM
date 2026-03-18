'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

interface Discount {
  id: string; code: string | null; title: string | null;
  type: string; method: string; valueType: string; value: number;
  status: string; usedCount: number;
  combineProduct: boolean; combineOrder: boolean; combineShipping: boolean;
  onePerCustomer: boolean;
}

interface Resp { discounts: Discount[]; pagination: { total: number } }

const TABS = ['All', 'Active', 'Scheduled', 'Expired'];

const TYPE_LABEL: Record<string, string> = {
  AMOUNT_OFF_PRODUCTS: 'Amount off products',
  AMOUNT_OFF_ORDER: 'Amount off order',
  BUY_X_GET_Y: 'Buy X get Y',
  FREE_SHIPPING: 'Free shipping',
};

const TYPE_ICON: Record<string, string> = {
  AMOUNT_OFF_PRODUCTS: '\u25C9',
  AMOUNT_OFF_ORDER: '\u2B1C',
  BUY_X_GET_Y: '\u25C9',
  FREE_SHIPPING: '\u2708',
};

const STATUS: Record<string, { bg: string; fg: string; dot: string }> = {
  ACTIVE:    { bg: '#dcfce7', fg: '#15803d', dot: '#22c55e' },
  SCHEDULED: { bg: '#fef9c3', fg: '#854d0e', dot: '#eab308' },
  EXPIRED:   { bg: '#f3f4f6', fg: '#6b7280', dot: '#9ca3af' },
  DRAFT:     { bg: '#f3f4f6', fg: '#6b7280', dot: '#9ca3af' },
};

const DISCOUNT_TYPES = [
  { type: 'AMOUNT_OFF_PRODUCTS', label: 'Amount off products', desc: 'Discount specific products or collections of products', icon: '\u25C9' },
  { type: 'BUY_X_GET_Y',        label: 'Buy X get Y',         desc: 'Discount specific products or collections of products', icon: '\u25C9' },
  { type: 'AMOUNT_OFF_ORDER',    label: 'Amount off order',    desc: 'Discount the total order amount',                       icon: '\u2B1C' },
  { type: 'FREE_SHIPPING',       label: 'Free shipping',       desc: 'Offer free shipping on an order',                       icon: '\u2708' },
];

export default function DiscountsPage() {
  const router = useRouter();
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('All');
  const [showModal, setShowModal] = useState(false);

  const fetchData = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ limit: '50' });
    if (tab !== 'All') p.set('status', tab.toUpperCase());
    apiClient<Resp>(`/admin/discounts?${p}`)
      .then((r) => { if (r.data) setData(r.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const summary = (d: Discount) => {
    if (d.type === 'FREE_SHIPPING') return 'Free shipping';
    const v = d.valueType === 'PERCENTAGE' ? `${Number(d.value)}%` : `\u20B9${Number(d.value)}`;
    const parts = [`${v} off`];
    if (d.type === 'AMOUNT_OFF_ORDER') parts[0] += ' entire order';
    if (d.onePerCustomer) parts.push('One use per customer');
    return parts.join(' \u2022 ');
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>Discounts</h1>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setShowModal(true)} style={{
            padding: '9px 20px', fontSize: 13, fontWeight: 600,
            background: '#303030', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
            transition: 'background 0.15s',
          }}>
            Create discount
          </button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid #e2e4e7' }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '10px 18px', fontSize: 13, fontWeight: 600,
              border: 'none', background: 'none', cursor: 'pointer',
              color: tab === t ? '#303030' : '#8c9196',
              borderBottom: tab === t ? '2px solid #303030' : '2px solid transparent',
              marginBottom: -1, transition: 'all 0.15s',
            }}
          >{t}</button>
        ))}
      </div>

      {/* ── Content ── */}
      {loading && !data ? (
        <div style={{ textAlign: 'center', padding: 80, color: '#8c9196', fontSize: 14 }}>Loading discounts...</div>
      ) : !data || data.discounts.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '70px 20px',
          background: '#fff', border: '1px solid #e2e4e7', borderRadius: 12,
        }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#f6f6f7', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <span style={{ fontSize: 22 }}>&#127991;</span>
          </div>
          <h3 style={{ fontWeight: 600, fontSize: 16, margin: '0 0 8px', color: '#303030' }}>
            {tab !== 'All' ? `No ${tab.toLowerCase()} discounts` : 'No discounts yet'}
          </h3>
          <p style={{ color: '#8c9196', fontSize: 14, margin: 0, maxWidth: 360, marginInline: 'auto' }}>
            Create a discount code or automatic discount to offer special pricing to your customers.
          </p>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e2e4e7', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e2e4e7' }}>
                <th style={th}>Title</th>
                <th style={{ ...th, width: 90 }}>Status</th>
                <th style={{ ...th, width: 80 }}>Method</th>
                <th style={{ ...th, width: 200 }}>Type</th>
                <th style={{ ...th, width: 130, textAlign: 'center' }}>Combinations</th>
                <th style={{ ...th, width: 60, textAlign: 'right' }}>Used</th>
              </tr>
            </thead>
            <tbody>
              {data.discounts.map((d, i) => {
                const s = STATUS[d.status] || STATUS.DRAFT;
                return (
                  <tr
                    key={d.id}
                    onClick={() => router.push(`/dashboard/discounts/${d.id}`)}
                    style={{
                      borderTop: i > 0 ? '1px solid #f1f2f4' : 'none',
                      cursor: 'pointer', transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f6f6f7')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                  >
                    <td style={td}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: '#303030' }}>{d.code || d.title}</div>
                      <div style={{ fontSize: 12, color: '#8c9196', marginTop: 3, lineHeight: 1.3 }}>{summary(d)}</div>
                    </td>
                    <td style={td}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 20,
                        background: s.bg, color: s.fg,
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot }} />
                        {d.status.charAt(0) + d.status.slice(1).toLowerCase()}
                      </span>
                    </td>
                    <td style={{ ...td, fontSize: 13, color: '#616161' }}>
                      {d.method === 'CODE' ? '1 code' : 'Automatic'}
                    </td>
                    <td style={{ ...td, fontSize: 13, color: '#616161' }}>
                      <span style={{ marginRight: 6 }}>{TYPE_ICON[d.type]}</span>
                      {TYPE_LABEL[d.type]}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: 4 }}>
                        <CombIcon active={d.combineProduct} title="Product" icon="\u25C9" />
                        <CombIcon active={d.combineOrder} title="Order" icon="\u2B1C" />
                        <CombIcon active={d.combineShipping} title="Shipping" icon="\u2708" />
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontSize: 14, fontWeight: 500, color: '#303030' }}>
                      {d.usedCount}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Type Selector Modal ── */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: '#fff', borderRadius: 16, width: 540,
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
            overflow: 'hidden', animation: 'fadeIn 0.15s ease-out',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '20px 24px', borderBottom: '1px solid #e2e4e7',
            }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#303030' }}>Select discount type</h2>
              <button
                onClick={() => setShowModal(false)}
                style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#8c9196', width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >&times;</button>
            </div>

            <div style={{ padding: '8px 0' }}>
              {DISCOUNT_TYPES.map((item, i) => (
                <button
                  key={item.type}
                  onClick={() => { setShowModal(false); router.push(`/dashboard/discounts/new?type=${item.type}`); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 16, width: '100%',
                    padding: '16px 24px', border: 'none',
                    background: 'none', cursor: 'pointer', textAlign: 'left',
                    borderTop: i > 0 ? '1px solid #f1f2f4' : 'none',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f6f6f7')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: 8, background: '#f6f6f7',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 16, color: '#616161', flexShrink: 0,
                  }}>{item.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#303030' }}>{item.label}</div>
                    <div style={{ fontSize: 13, color: '#8c9196', marginTop: 2 }}>{item.desc}</div>
                  </div>
                  <span style={{ color: '#c9cccf', fontSize: 20 }}>&rsaquo;</span>
                </button>
              ))}
            </div>

            <div style={{ padding: '16px 24px', borderTop: '1px solid #e2e4e7', textAlign: 'right' }}>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  padding: '9px 20px', fontSize: 13, fontWeight: 600,
                  border: '1px solid #c9cccf', borderRadius: 8, background: '#fff',
                  cursor: 'pointer', color: '#303030',
                }}
              >Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ── */
function CombIcon({ active, title, icon }: { active: boolean; title: string; icon: string }) {
  return (
    <span
      title={`${title} discounts: ${active ? 'Can combine' : 'Cannot combine'}`}
      style={{
        width: 22, height: 22, borderRadius: 4,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, color: active ? '#616161' : '#d1d5db',
        background: active ? '#f1f2f4' : 'transparent',
      }}
    >{icon}</span>
  );
}

/* ── Styles ── */
const th: React.CSSProperties = {
  textAlign: 'left', padding: '12px 16px',
  fontWeight: 500, fontSize: 12, color: '#8c9196',
  textTransform: 'uppercase', letterSpacing: '0.03em',
};

const td: React.CSSProperties = {
  padding: '14px 16px', verticalAlign: 'middle',
};
