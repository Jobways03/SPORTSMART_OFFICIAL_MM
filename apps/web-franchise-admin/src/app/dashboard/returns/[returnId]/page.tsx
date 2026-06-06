'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  franchiseReturnsService,
  FranchiseReturnDetail,
} from '@/services/franchise-returns.service';

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  padding: 20,
  marginBottom: 16,
};
const h2: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: '#111827',
  marginBottom: 12,
};

export default function FranchiseAdminReturnDetailPage() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const returnId = (params?.returnId as string) || '';
  const franchiseId = search?.get('franchiseId') || '';
  const [ret, setRet] = useState<FranchiseReturnDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!returnId || !franchiseId) {
      setError('Missing return or franchise reference');
      setLoading(false);
      return;
    }
    setLoading(true);
    franchiseReturnsService
      .get(returnId, franchiseId)
      .then((res) => {
        if (res.data) setRet(res.data);
        else setError('Return not found');
      })
      .catch(() => setError('Failed to load return'))
      .finally(() => setLoading(false));
  }, [returnId, franchiseId]);

  if (loading)
    return <p style={{ color: '#9ca3af', padding: 40 }}>Loading return...</p>;
  if (error || !ret)
    return (
      <div style={{ padding: 24 }}>
        <button
          onClick={() => router.back()}
          style={{
            border: 'none',
            background: 'none',
            color: '#2563eb',
            cursor: 'pointer',
            marginBottom: 16,
          }}
        >
          &larr; Back to Returns
        </button>
        <p style={{ color: '#9ca3af' }}>{error || 'Return not found'}</p>
      </div>
    );

  const items = ret.items ?? [];
  const history = ret.statusHistory ?? [];
  const evidence = ret.evidence ?? [];

  return (
    <div style={{ maxWidth: 900 }}>
      <button
        onClick={() => router.back()}
        style={{
          border: 'none',
          background: 'none',
          color: '#2563eb',
          cursor: 'pointer',
          marginBottom: 12,
          fontSize: 13,
        }}
      >
        &larr; Back to Returns
      </button>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>
            Return {ret.returnNumber || ret.id.slice(0, 8)}
          </h1>
          <p style={{ color: '#6b7280', fontSize: 13 }}>
            Order {ret.subOrder?.masterOrder?.orderNumber ?? '—'} ·{' '}
            {new Date(ret.createdAt).toLocaleString()}
          </p>
        </div>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: '4px 12px',
            borderRadius: 6,
            background: '#dbeafe',
            color: '#1d4ed8',
          }}
        >
          {ret.status?.replace(/_/g, ' ')}
        </span>
      </div>

      <div style={card}>
        <h2 style={h2}>Returned Items</h2>
        {items.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: 13 }}>No item rows</p>
        ) : (
          items.map((it) => (
            <div
              key={it.id}
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                padding: '8px 0',
                borderBottom: '1px solid #f3f4f6',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: 13 }}>
                  {it.orderItem?.productTitle ?? 'Item'}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: '#6b7280',
                    fontFamily: 'monospace',
                  }}
                >
                  {it.orderItem?.sku ?? '—'}
                </div>
              </div>
              <div style={{ fontSize: 13, color: '#374151' }}>
                Qty {it.quantity ?? 1}
              </div>
              {it.reasonCategory && (
                <div style={{ fontSize: 12, color: '#92400e' }}>
                  {it.reasonCategory.replace(/_/g, ' ')}
                </div>
              )}
            </div>
          ))
        )}
        {ret.reason && (
          <p style={{ fontSize: 13, color: '#374151', marginTop: 12 }}>
            <strong>Reason:</strong> {ret.reason}
          </p>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={card}>
          <h2 style={h2}>Status History</h2>
          {history.length === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: 13 }}>No history</p>
          ) : (
            history.map((hI) => (
              <div
                key={hI.id}
                style={{
                  fontSize: 13,
                  color: '#374151',
                  padding: '6px 0',
                  borderBottom: '1px solid #f3f4f6',
                }}
              >
                <span style={{ fontWeight: 600 }}>
                  {hI.status?.replace(/_/g, ' ')}
                </span>
                <span style={{ color: '#9ca3af', marginLeft: 8, fontSize: 12 }}>
                  {new Date(hI.createdAt).toLocaleString()}
                </span>
                {hI.note && (
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{hI.note}</div>
                )}
              </div>
            ))
          )}
        </div>

        <div style={card}>
          <h2 style={h2}>Evidence</h2>
          {evidence.length === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: 13 }}>No evidence uploaded</p>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {evidence.map((ev) => {
                const url = ev.viewUrl || ev.url || null;
                if (!url)
                  return (
                    <div
                      key={ev.id}
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: 6,
                        background: '#f3f4f6',
                        border: '1px solid #e5e7eb',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 18,
                        color: '#9ca3af',
                      }}
                    >
                      &#128247;
                    </div>
                  );
                return (
                  <a
                    key={ev.id}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 6,
                      overflow: 'hidden',
                      border: '1px solid #e5e7eb',
                      display: 'block',
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
