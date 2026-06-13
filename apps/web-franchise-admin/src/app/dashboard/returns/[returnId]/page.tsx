'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  franchiseReturnsService,
  FranchiseReturnDetail,
  FranchiseShipmentEvidence,
} from '@/services/franchise-returns.service';
import SubmitQcModal from '../components/submit-qc-modal';

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
  const [qcOpen, setQcOpen] = useState(false);
  // Bumped after a QC decision to re-fetch the (now-updated) return.
  const [refreshKey, setRefreshKey] = useState(0);
  // Franchise's pre-ship photos (proof-of-dispatch, attached to the sub-order).
  const [shipmentEvidence, setShipmentEvidence] = useState<
    FranchiseShipmentEvidence[]
  >([]);

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
  }, [returnId, franchiseId, refreshKey]);

  // Pull the franchise's pre-ship photos once we know the sub-order. Separate
  // from the main fetch so a missing/empty list never breaks the page.
  useEffect(() => {
    const subOrderId = ret?.subOrder?.id;
    if (!subOrderId) return;
    franchiseReturnsService
      .getShipmentEvidence(subOrderId)
      .then((res) => {
        setShipmentEvidence(Array.isArray(res.data) ? res.data : []);
      })
      .catch(() => setShipmentEvidence([]));
  }, [ret?.subOrder?.id]);

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
          {/* QC decision is the marketplace admin's call once the parcel is
              received back. */}
          {ret.status === 'RECEIVED' && (
            <button
              type="button"
              onClick={() => setQcOpen(true)}
              style={{
                fontSize: 13,
                fontWeight: 600,
                padding: '8px 16px',
                borderRadius: 8,
                border: 'none',
                background: '#2563eb',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              Submit QC Decision
            </button>
          )}
        </div>
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

        {/* Franchise's pre-ship evidence — proof-of-dispatch photos uploaded at
            packing time (attached to the sub-order). The "as shipped" baseline:
            compare against the customer's claim photos above before approving a
            contested return. */}
        {shipmentEvidence.length > 0 && (
          <div style={card}>
            <h2 style={h2}>
              Franchise&apos;s Pre-ship Evidence ({shipmentEvidence.length})
            </h2>
            <p
              style={{
                color: '#6b7280',
                fontSize: 12,
                marginTop: -4,
                marginBottom: 12,
                lineHeight: 1.5,
              }}
            >
              Photos the franchise uploaded <strong>before shipping</strong> (the
              &ldquo;as shipped&rdquo; baseline). Compare against the
              customer&apos;s evidence above before deciding a contested return.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {shipmentEvidence.map((att, i) => {
                // SHIPMENT_EVIDENCE is PRIVATE → providerUrl is null; the admin
                // endpoint enriches each row with a short-lived `viewUrl`.
                const url = att.viewUrl ?? att.file?.providerUrl ?? null;
                return url ? (
                  <a
                    key={att.id}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    title={`Pre-ship photo ${i + 1} — opens in new tab`}
                    style={{
                      width: 96,
                      height: 96,
                      borderRadius: 6,
                      overflow: 'hidden',
                      border: '2px solid #8b5cf6',
                      display: 'block',
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={`Pre-ship evidence ${i + 1}`}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  </a>
                ) : (
                  <div
                    key={att.id}
                    style={{
                      width: 96,
                      height: 96,
                      borderRadius: 6,
                      background: '#f3f4f6',
                      border: '1px solid #e5e7eb',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      color: '#9ca3af',
                      padding: 8,
                      textAlign: 'center',
                    }}
                  >
                    {att.file?.fileName ?? 'Photo'}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {qcOpen && (
          <SubmitQcModal
            returnId={ret.id}
            returnNumber={ret.returnNumber || ret.id.slice(0, 8)}
            items={ret.items ?? []}
            onClose={() => setQcOpen(false)}
            onSuccess={() => {
              setQcOpen(false);
              setRefreshKey((k) => k + 1);
            }}
          />
        )}
      </div>
    </div>
  );
}
