'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  franchiseReturnsService,
  FranchiseReturn,
} from '@/services/returns.service';
import { ApiError } from '@/lib/api-client';

/* -- helpers -- */
const fmt = (n: number) =>
  `\u20B9${Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const fmtDateTime = (d: string) => {
  const dt = new Date(d);
  return (
    dt.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }) +
    ' ' +
    dt.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
  );
};

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 11,
        fontWeight: 700,
        padding: '3px 10px',
        borderRadius: 4,
        background: color,
        color: '#fff',
        textTransform: 'capitalize',
      }}
    >
      {text}
    </span>
  );
}

function colorForReturnStatus(s: string) {
  if (s === 'COMPLETED' || s === 'APPROVED' || s === 'REFUNDED') return '#16a34a';
  if (s === 'REJECTED' || s === 'CANCELLED') return '#dc2626';
  if (s === 'IN_TRANSIT' || s === 'SHIPPED') return '#d97706';
  if (s === 'RECEIVED' || s === 'QC_IN_PROGRESS') return '#2563eb';
  return '#6b7280';
}

function colorForQcOutcome(s: string) {
  if (s === 'APPROVED') return '#16a34a';
  if (s === 'REJECTED' || s === 'DAMAGED') return '#dc2626';
  if (s === 'PARTIAL') return '#d97706';
  return '#6b7280';
}

const reasonLabel = (r: string) => {
  switch (r) {
    case 'WRONG_ITEM':
      return 'Wrong Item';
    case 'DAMAGED':
      return 'Damaged';
    case 'NOT_AS_DESCRIBED':
      return 'Not as Described';
    case 'SIZE_ISSUE':
      return 'Size Issue';
    case 'QUALITY_ISSUE':
      return 'Quality Issue';
    case 'OTHER':
      return 'Other';
    default:
      return r;
  }
};

/* -- page -- */
export default function FranchiseReturnDetailPage() {
  const { returnId } = useParams<{ returnId: string }>();
  const [ret, setRet] = useState<FranchiseReturn | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Mark received modal
  const [showReceivedModal, setShowReceivedModal] = useState(false);
  const [receivedNotes, setReceivedNotes] = useState('');

  // QC modal
  const [showQcModal, setShowQcModal] = useState(false);
  const [qcDecisions, setQcDecisions] = useState<
    Record<string, { qcOutcome: string; qcQuantityApproved: number; qcNotes: string }>
  >({});
  const [overallNotes, setOverallNotes] = useState('');

  // Upload evidence
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);

  const fetchReturn = useCallback(async () => {
    if (!returnId) return;
    setLoading(true);
    try {
      const res = await franchiseReturnsService.get(returnId);
      if (res.data) {
        setRet(res.data);
        // Pre-populate QC decisions with default values
        const defaults: Record<
          string,
          { qcOutcome: string; qcQuantityApproved: number; qcNotes: string }
        > = {};
        res.data.items.forEach((item) => {
          defaults[item.id] = {
            qcOutcome: item.qcOutcome || '',
            qcQuantityApproved: item.qcQuantityApproved ?? item.quantity,
            qcNotes: item.qcNotes || '',
          };
        });
        setQcDecisions(defaults);
      }
    } catch (err) {
      if (err instanceof ApiError) alert(err.body.message || 'Failed to load return');
      else alert('Failed to load return');
    } finally {
      setLoading(false);
    }
  }, [returnId]);

  useEffect(() => {
    fetchReturn();
  }, [fetchReturn]);

  const handleMarkReceived = async () => {
    if (!returnId) return;
    setActionLoading('received');
    try {
      await franchiseReturnsService.markReceived(returnId, receivedNotes || undefined);
      setShowReceivedModal(false);
      setReceivedNotes('');
      fetchReturn();
    } catch (err) {
      if (err instanceof ApiError)
        alert(err.body.message || 'Failed to mark as received');
      else alert('Failed to mark as received');
    } finally {
      setActionLoading(null);
    }
  };

  const handleQcSubmit = async () => {
    if (!returnId || !ret) return;
    // Validate all items have outcomes
    for (const item of ret.items) {
      const dec = qcDecisions[item.id];
      if (!dec || !dec.qcOutcome) {
        alert('Please select an outcome for all items');
        return;
      }
      if (dec.qcQuantityApproved < 0 || dec.qcQuantityApproved > item.quantity) {
        alert(
          `Approved quantity for an item must be between 0 and ${item.quantity}`,
        );
        return;
      }
    }
    setActionLoading('qc');
    try {
      const decisions = ret.items.map((item) => ({
        returnItemId: item.id,
        qcOutcome: qcDecisions[item.id].qcOutcome,
        qcQuantityApproved: Number(qcDecisions[item.id].qcQuantityApproved),
        qcNotes: qcDecisions[item.id].qcNotes || undefined,
      }));
      await franchiseReturnsService.submitQc(
        returnId,
        decisions,
        overallNotes || undefined,
      );
      setShowQcModal(false);
      setOverallNotes('');
      fetchReturn();
    } catch (err) {
      if (err instanceof ApiError) alert(err.body.message || 'Failed to submit QC');
      else alert('Failed to submit QC');
    } finally {
      setActionLoading(null);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!returnId || !e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    setUploadingEvidence(true);
    try {
      await franchiseReturnsService.uploadEvidence(returnId, file);
      fetchReturn();
    } catch (err) {
      alert((err as Error).message || 'Failed to upload evidence');
    } finally {
      setUploadingEvidence(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Return Details</h1>
          </div>
        </div>
        <div className="card">Loading...</div>
      </div>
    );
  }

  if (!ret) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Return Not Found</h1>
          </div>
        </div>
        <div className="card">
          <Link href="/dashboard/orders" style={{ color: '#2563eb' }}>
            Back to Orders
          </Link>
        </div>
      </div>
    );
  }

  const canMarkReceived = ret.status === 'IN_TRANSIT' || ret.status === 'SHIPPED';
  const canSubmitQc = ret.status === 'RECEIVED' || ret.status === 'QC_IN_PROGRESS';

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Link
          href="/dashboard/orders"
          style={{
            fontSize: 12,
            color: '#6b7280',
            textDecoration: 'none',
            marginBottom: 8,
            display: 'inline-block',
          }}
        >
          &#8592; Back to Orders
        </Link>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px 0' }}>
              Return {ret.returnNumber}
            </h1>
            <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
              Order: {ret.masterOrder?.orderNumber || '-'} &middot; Created{' '}
              {fmtDateTime(ret.createdAt)}
            </p>
          </div>
          <Badge text={ret.status} color={colorForReturnStatus(ret.status)} />
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 24,
          alignItems: 'flex-start',
          flexWrap: 'wrap',
        }}
      >
        {/* LEFT COLUMN */}
        <div style={{ flex: '1 1 620px', minWidth: 0 }}>
          {/* Items */}
          <div className="card">
            <h2>Return Items</h2>
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr
                    style={{
                      borderBottom: '2px solid #e5e7eb',
                      background: '#f9fafb',
                    }}
                  >
                    <th style={thStyle}>Product</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Qty</th>
                    <th style={thStyle}>Customer Reason</th>
                    <th style={thStyle}>QC Outcome</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Approved Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {ret.items.map((item) => (
                    <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div
                            style={{
                              width: 40,
                              height: 40,
                              borderRadius: 6,
                              background: '#f3f4f6',
                              border: '1px solid #e5e7eb',
                              overflow: 'hidden',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            {item.orderItem?.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={item.orderItem.imageUrl}
                                alt=""
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  objectFit: 'cover',
                                }}
                              />
                            ) : (
                              <span style={{ fontSize: 16, color: '#d1d5db' }}>
                                &#128722;
                              </span>
                            )}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: '#2563eb' }}>
                              {item.orderItem?.productTitle || 'Unknown Product'}
                            </div>
                            {item.orderItem?.variantTitle && (
                              <div style={{ fontSize: 11, color: '#6b7280' }}>
                                {item.orderItem.variantTitle}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600 }}>
                        {item.quantity}
                      </td>
                      <td style={tdStyle}>
                        <div>{reasonLabel(item.reasonCategory)}</div>
                        {item.reasonDetail && (
                          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                            {item.reasonDetail}
                          </div>
                        )}
                      </td>
                      <td style={tdStyle}>
                        {item.qcOutcome ? (
                          <Badge
                            text={item.qcOutcome}
                            color={colorForQcOutcome(item.qcOutcome)}
                          />
                        ) : (
                          <span style={{ color: '#9ca3af', fontSize: 12 }}>Pending</span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        {item.qcQuantityApproved != null ? item.qcQuantityApproved : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* QC Evidence Gallery */}
          {ret.evidence && ret.evidence.length > 0 && (
            <div className="card">
              <h2>QC Evidence</h2>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                  gap: 12,
                }}
              >
                {ret.evidence.map((ev) => (
                  <a
                    key={ev.id}
                    href={ev.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'block',
                      border: '1px solid #e5e7eb',
                      borderRadius: 8,
                      overflow: 'hidden',
                      textDecoration: 'none',
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={ev.fileUrl}
                      alt={ev.description || 'QC Evidence'}
                      style={{
                        width: '100%',
                        height: 120,
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                    {ev.description && (
                      <div
                        style={{
                          padding: 8,
                          fontSize: 11,
                          color: '#6b7280',
                          borderTop: '1px solid #e5e7eb',
                        }}
                      >
                        {ev.description}
                      </div>
                    )}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT SIDEBAR */}
        <div
          style={{ flex: '0 0 320px', minWidth: 280, position: 'sticky', top: 80 }}
        >
          {/* Actions */}
          <div className="card">
            <h2>Actions</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {canMarkReceived && (
                <button
                  onClick={() => setShowReceivedModal(true)}
                  disabled={!!actionLoading}
                  className="btn btn-primary"
                  style={{ width: '100%' }}
                >
                  {actionLoading === 'received' ? 'Updating...' : 'Mark as Received'}
                </button>
              )}

              {canSubmitQc && (
                <>
                  <button
                    onClick={() => setShowQcModal(true)}
                    disabled={!!actionLoading}
                    className="btn btn-primary"
                    style={{ width: '100%' }}
                  >
                    Submit QC Decision
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingEvidence}
                    className="btn btn-secondary"
                    style={{ width: '100%' }}
                  >
                    {uploadingEvidence ? 'Uploading...' : 'Upload Evidence'}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                  />
                </>
              )}

              {!canMarkReceived && !canSubmitQc && (
                <div style={{ fontSize: 13, color: '#6b7280' }}>
                  No actions available for current status.
                </div>
              )}
            </div>
          </div>

          {/* Return Info */}
          <div className="card">
            <h2>Return Info</h2>
            <div style={{ fontSize: 13, lineHeight: 1.9, color: '#374151' }}>
              <div>
                <strong>Return Number:</strong> {ret.returnNumber}
              </div>
              <div>
                <strong>Status:</strong> {ret.status}
              </div>
              {ret.refundAmount != null && (
                <div>
                  <strong>Refund Amount:</strong> {fmt(Number(ret.refundAmount))}
                </div>
              )}
              {ret.receivedAt && (
                <div>
                  <strong>Received At:</strong> {fmtDateTime(ret.receivedAt)}
                </div>
              )}
              {ret.qcCompletedAt && (
                <div>
                  <strong>QC Completed:</strong> {fmtDateTime(ret.qcCompletedAt)}
                </div>
              )}
              {ret.qcDecision && (
                <div>
                  <strong>QC Decision:</strong> {ret.qcDecision}
                </div>
              )}
            </div>
          </div>

          {/* Pickup Info */}
          {(ret.pickupScheduledAt ||
            ret.pickupTrackingNumber ||
            ret.pickupCourier) && (
            <div className="card">
              <h2>Pickup Information</h2>
              <div style={{ fontSize: 13, lineHeight: 1.9, color: '#374151' }}>
                {ret.pickupScheduledAt && (
                  <div>
                    <strong>Scheduled:</strong> {fmtDateTime(ret.pickupScheduledAt)}
                  </div>
                )}
                {ret.pickupCourier && (
                  <div>
                    <strong>Courier:</strong> {ret.pickupCourier}
                  </div>
                )}
                {ret.pickupTrackingNumber && (
                  <div>
                    <strong>Tracking:</strong>{' '}
                    <span style={{ fontFamily: 'monospace', color: '#2563eb' }}>
                      {ret.pickupTrackingNumber}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MARK RECEIVED MODAL */}
      {showReceivedModal && (
        <Modal
          onClose={() => {
            setShowReceivedModal(false);
            setReceivedNotes('');
          }}
        >
          <h3
            style={{
              margin: '0 0 4px 0',
              fontSize: 18,
              fontWeight: 700,
              color: '#2563eb',
            }}
          >
            Mark Return as Received
          </h3>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 20px 0' }}>
            Confirm that the return package has arrived at your warehouse.
          </p>

          <label
            style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}
          >
            Notes (optional)
          </label>
          <textarea
            value={receivedNotes}
            onChange={(e) => setReceivedNotes(e.target.value)}
            placeholder="Any notes about receipt condition..."
            rows={3}
            style={{ ...modalInput, resize: 'vertical', fontFamily: 'inherit' }}
          />

          <div style={modalFooter}>
            <button
              onClick={() => {
                setShowReceivedModal(false);
                setReceivedNotes('');
              }}
              style={btnCancel}
            >
              Cancel
            </button>
            <button
              onClick={handleMarkReceived}
              disabled={!!actionLoading}
              style={{ ...btnConfirm, background: '#2563eb' }}
            >
              {actionLoading === 'received' ? 'Saving...' : 'Confirm Received'}
            </button>
          </div>
        </Modal>
      )}

      {/* QC DECISION MODAL */}
      {showQcModal && ret && (
        <Modal onClose={() => setShowQcModal(false)}>
          <h3
            style={{
              margin: '0 0 4px 0',
              fontSize: 18,
              fontWeight: 700,
              color: '#2563eb',
            }}
          >
            Submit QC Decision
          </h3>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 20px 0' }}>
            Review each item and record the QC outcome.
          </p>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              marginBottom: 16,
            }}
          >
            {ret.items.map((item) => {
              const dec = qcDecisions[item.id] || {
                qcOutcome: '',
                qcQuantityApproved: item.quantity,
                qcNotes: '',
              };
              return (
                <div
                  key={item.id}
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: 8,
                    padding: 14,
                    background: '#f9fafb',
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>
                    {item.orderItem?.productTitle || 'Unknown Product'}
                  </div>
                  {item.orderItem?.variantTitle && (
                    <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>
                      {item.orderItem.variantTitle}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
                    Returned qty: <strong>{item.quantity}</strong> &middot; Reason:{' '}
                    {reasonLabel(item.reasonCategory)}
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 10,
                      marginBottom: 10,
                    }}
                  >
                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: 11,
                          fontWeight: 600,
                          marginBottom: 4,
                          color: '#6b7280',
                        }}
                      >
                        Outcome *
                      </label>
                      <select
                        value={dec.qcOutcome}
                        onChange={(e) =>
                          setQcDecisions((prev) => ({
                            ...prev,
                            [item.id]: { ...dec, qcOutcome: e.target.value },
                          }))
                        }
                        style={{
                          width: '100%',
                          padding: '8px',
                          border: '1px solid #d1d5db',
                          borderRadius: 6,
                          fontSize: 12,
                          background: '#fff',
                        }}
                      >
                        <option value="">Select...</option>
                        <option value="APPROVED">Approved</option>
                        <option value="REJECTED">Rejected</option>
                        <option value="PARTIAL">Partial</option>
                        <option value="DAMAGED">Damaged</option>
                      </select>
                    </div>
                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: 11,
                          fontWeight: 600,
                          marginBottom: 4,
                          color: '#6b7280',
                        }}
                      >
                        Approved Qty
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={item.quantity}
                        value={dec.qcQuantityApproved}
                        onChange={(e) =>
                          setQcDecisions((prev) => ({
                            ...prev,
                            [item.id]: {
                              ...dec,
                              qcQuantityApproved: Number(e.target.value),
                            },
                          }))
                        }
                        style={{
                          width: '100%',
                          padding: '8px',
                          border: '1px solid #d1d5db',
                          borderRadius: 6,
                          fontSize: 12,
                          background: '#fff',
                        }}
                      />
                    </div>
                  </div>

                  <label
                    style={{
                      display: 'block',
                      fontSize: 11,
                      fontWeight: 600,
                      marginBottom: 4,
                      color: '#6b7280',
                    }}
                  >
                    Notes (optional)
                  </label>
                  <textarea
                    value={dec.qcNotes}
                    onChange={(e) =>
                      setQcDecisions((prev) => ({
                        ...prev,
                        [item.id]: { ...dec, qcNotes: e.target.value },
                      }))
                    }
                    placeholder="Per-item QC notes..."
                    rows={2}
                    style={{
                      width: '100%',
                      padding: '8px',
                      border: '1px solid #d1d5db',
                      borderRadius: 6,
                      fontSize: 12,
                      resize: 'vertical',
                      fontFamily: 'inherit',
                      background: '#fff',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              );
            })}
          </div>

          <label
            style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}
          >
            Overall Notes (optional)
          </label>
          <textarea
            value={overallNotes}
            onChange={(e) => setOverallNotes(e.target.value)}
            placeholder="Overall QC notes..."
            rows={3}
            style={{ ...modalInput, resize: 'vertical', fontFamily: 'inherit' }}
          />

          <div style={modalFooter}>
            <button onClick={() => setShowQcModal(false)} style={btnCancel}>
              Cancel
            </button>
            <button
              onClick={handleQcSubmit}
              disabled={!!actionLoading}
              style={{ ...btnConfirm, background: '#2563eb' }}
            >
              {actionLoading === 'qc' ? 'Submitting...' : 'Submit QC'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* -- Modal wrapper -- */
function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: 28,
          width: 560,
          maxWidth: '90vw',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/* -- styles -- */
const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontWeight: 600,
  fontSize: 11,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '12px',
  verticalAlign: 'middle',
};

const modalInput: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 13,
  marginBottom: 16,
  background: '#fff',
  boxSizing: 'border-box',
};

const modalFooter: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 10,
  marginTop: 8,
};

const btnCancel: React.CSSProperties = {
  padding: '10px 20px',
  fontSize: 13,
  fontWeight: 600,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  cursor: 'pointer',
};

const btnConfirm: React.CSSProperties = {
  padding: '10px 20px',
  fontSize: 13,
  fontWeight: 700,
  border: 'none',
  color: '#fff',
  borderRadius: 6,
  cursor: 'pointer',
};
