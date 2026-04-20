'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  franchiseOrdersService,
  FranchiseOrder,
} from '@/services/orders.service';
import { ApiError } from '@/lib/api-client';

/* -- helpers -- */
const fmt = (n: number) =>
  `\u20B9${Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

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

function colorForAcceptStatus(s: string) {
  if (s === 'ACCEPTED') return '#2563eb';
  if (s === 'REJECTED' || s === 'CANCELLED') return '#dc2626';
  return '#6b7280';
}

function colorForFulfillment(s: string) {
  if (s === 'DELIVERED' || s === 'FULFILLED') return '#16a34a';
  if (s === 'SHIPPED') return '#d97706';
  if (s === 'PACKED') return '#2563eb';
  if (s === 'CANCELLED') return '#dc2626';
  return '#6b7280';
}

const fulfillmentLabel = (status: string) => {
  switch (status) {
    case 'DELIVERED':
      return 'Delivered';
    case 'SHIPPED':
      return 'Shipped';
    case 'PACKED':
      return 'Packed';
    case 'FULFILLED':
      return 'Fulfilled';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return 'Unfulfilled';
  }
};

const rejectionReasonLabel = (reason: string) => {
  switch (reason) {
    case 'OUT_OF_STOCK':
      return 'Out of Stock';
    case 'CANNOT_SHIP':
      return 'Cannot Ship to Location';
    case 'LOCATION_ISSUE':
      return 'Location Issue';
    case 'OTHER':
      return 'Other';
    default:
      return reason;
  }
};

/* -- page -- */
export default function FranchiseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<FranchiseOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Accept modal
  const [showAcceptModal, setShowAcceptModal] = useState(false);
  const [expectedDispatchDate, setExpectedDispatchDate] = useState('');

  // Reject modal
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectNote, setRejectNote] = useState('');

  // Pack modal
  const [showPackModal, setShowPackModal] = useState(false);
  const [packNote, setPackNote] = useState('');

  // Ship modal
  const [showShipModal, setShowShipModal] = useState(false);
  const [shipTrackingNumber, setShipTrackingNumber] = useState('');
  const [shipCourierSelection, setShipCourierSelection] = useState('');
  const [shipCourierOther, setShipCourierOther] = useState('');
  const [shipError, setShipError] = useState('');

  const fetchOrder = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await franchiseOrdersService.get(id);
      if (res.data) setOrder(res.data);
    } catch (err) {
      if (err instanceof ApiError) alert(err.body.message || 'Failed to load order');
      else alert('Failed to load order');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  const handleAcceptConfirm = async () => {
    if (!id) return;
    setActionLoading('accept');
    try {
      await franchiseOrdersService.accept(id, expectedDispatchDate || undefined);
      setShowAcceptModal(false);
      setExpectedDispatchDate('');
      fetchOrder();
    } catch (err) {
      if (err instanceof ApiError) alert(err.body.message || 'Failed to accept order');
      else alert('Failed to accept order');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRejectConfirm = async () => {
    if (!id) return;
    setActionLoading('reject');
    try {
      await franchiseOrdersService.reject(
        id,
        rejectReason || undefined,
        rejectNote || undefined,
      );
      setShowRejectModal(false);
      setRejectReason('');
      setRejectNote('');
      fetchOrder();
    } catch (err) {
      if (err instanceof ApiError) alert(err.body.message || 'Failed to reject order');
      else alert('Failed to reject order');
    } finally {
      setActionLoading(null);
    }
  };

  const handlePackConfirm = async () => {
    if (!id) return;
    setActionLoading('pack');
    try {
      await franchiseOrdersService.updateStatus(id, 'PACKED');
      setShowPackModal(false);
      setPackNote('');
      fetchOrder();
    } catch (err) {
      if (err instanceof ApiError) alert(err.body.message || 'Failed to mark as packed');
      else alert('Failed to mark as packed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleShipConfirm = async () => {
    if (!id) return;
    setShipError('');
    const trackingNumber = shipTrackingNumber.trim();
    const courierName =
      shipCourierSelection === 'Other' ? shipCourierOther.trim() : shipCourierSelection;
    if (!trackingNumber) {
      setShipError('Tracking number is required');
      return;
    }
    if (!courierName) {
      setShipError('Courier name is required');
      return;
    }
    setActionLoading('ship');
    try {
      await franchiseOrdersService.updateStatus(
        id,
        'SHIPPED',
        trackingNumber,
        courierName,
      );
      setShowShipModal(false);
      setShipTrackingNumber('');
      setShipCourierSelection('');
      setShipCourierOther('');
      fetchOrder();
    } catch (err) {
      if (err instanceof ApiError)
        setShipError(err.body.message || 'Failed to mark as shipped');
      else setShipError('Failed to mark as shipped');
    } finally {
      setActionLoading(null);
    }
  };

  const resetShipModal = () => {
    setShowShipModal(false);
    setShipTrackingNumber('');
    setShipCourierSelection('');
    setShipCourierOther('');
    setShipError('');
  };

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Order Details</h1>
          </div>
        </div>
        <div className="card">Loading...</div>
      </div>
    );
  }

  if (!order) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Order Not Found</h1>
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

  const mo = order.masterOrder;
  const items = order.items || [];
  const totalQty = items.reduce((a, i) => a + i.quantity, 0);

  const canMarkPacked =
    order.acceptStatus === 'ACCEPTED' && order.fulfillmentStatus === 'UNFULFILLED';
  const canMarkShipped =
    order.acceptStatus === 'ACCEPTED' && order.fulfillmentStatus === 'PACKED';

  const addr = mo?.shippingAddressSnapshot;

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
              Order {mo?.orderNumber || order.id.slice(0, 8)}
            </h1>
            <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
              Placed on {fmtDateTime(order.createdAt)}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge
              text={order.acceptStatus}
              color={colorForAcceptStatus(order.acceptStatus)}
            />
            <Badge
              text={fulfillmentLabel(order.fulfillmentStatus)}
              color={colorForFulfillment(order.fulfillmentStatus)}
            />
          </div>
        </div>
      </div>

      {/* Status timeline */}
      <StatusTimeline
        acceptStatus={order.acceptStatus}
        fulfillmentStatus={order.fulfillmentStatus}
      />

      {/* Two-column layout */}
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
          {/* Customer address card */}
          {addr && (
            <div className="card">
              <h2>Customer Shipping Address</h2>
              <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.8 }}>
                <div>
                  <strong>{addr.fullName}</strong>
                </div>
                {addr.phone && <div>{addr.phone}</div>}
                {addr.addressLine1 && <div>{addr.addressLine1}</div>}
                {addr.addressLine2 && <div>{addr.addressLine2}</div>}
                <div>
                  {addr.city}
                  {addr.city && addr.state ? ', ' : ''}
                  {addr.state}
                  {addr.postalCode ? ` - ${addr.postalCode}` : ''}
                </div>
                {addr.country && <div>{addr.country}</div>}
              </div>
            </div>
          )}

          {/* Items table */}
          <div className="card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 16,
              }}
            >
              <h2 style={{ margin: 0 }}>Order Items</h2>
              <span style={{ fontSize: 13, color: '#6b7280' }}>
                Total Products: {totalQty}
              </span>
            </div>
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
                    <th style={thStyle}>Image</th>
                    <th style={thStyle}>Product</th>
                    <th style={thStyle}>SKU</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Qty</th>
                    <th style={thStyle}>Unit Price</th>
                    <th style={thStyle}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={tdStyle}>
                        <div
                          style={{
                            width: 48,
                            height: 48,
                            borderRadius: 6,
                            background: '#f3f4f6',
                            border: '1px solid #e5e7eb',
                            overflow: 'hidden',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {item.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.imageUrl}
                              alt=""
                              style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover',
                              }}
                            />
                          ) : (
                            <span style={{ fontSize: 18, color: '#d1d5db' }}>
                              &#128722;
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600, color: '#2563eb' }}>
                          {item.productTitle}
                        </div>
                        {item.variantTitle && (
                          <div style={{ fontSize: 12, color: '#6b7280' }}>
                            {item.variantTitle}
                          </div>
                        )}
                      </td>
                      <td style={tdStyle}>{item.sku || '-'}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        {item.quantity}
                      </td>
                      <td style={tdStyle}>{fmt(Number(item.unitPrice))}</td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>
                        {fmt(Number(item.totalPrice))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Order summary */}
            <div
              style={{
                borderTop: '1px solid #e5e7eb',
                marginTop: 16,
                paddingTop: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                alignItems: 'flex-end',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  gap: 40,
                  fontSize: 13,
                  color: '#6b7280',
                }}
              >
                <span>Subtotal</span>
                <span>{fmt(Number(order.subTotal))}</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 40,
                  fontSize: 15,
                  fontWeight: 700,
                  color: '#111827',
                  paddingTop: 6,
                  borderTop: '1px solid #e5e7eb',
                  width: 220,
                  justifyContent: 'space-between',
                }}
              >
                <span>Total</span>
                <span>{fmt(Number(order.subTotal))}</span>
              </div>
            </div>
          </div>

          {/* Rejection details (if rejected) */}
          {order.acceptStatus === 'REJECTED' &&
            (order.rejectionReason || order.rejectionNote) && (
              <div
                className="card"
                style={{ borderColor: '#fecaca', background: '#fef2f2' }}
              >
                <h2 style={{ color: '#dc2626' }}>Rejection Details</h2>
                {order.rejectionReason && (
                  <div style={{ marginBottom: 8, fontSize: 13 }}>
                    <strong>Reason:</strong> {rejectionReasonLabel(order.rejectionReason)}
                  </div>
                )}
                {order.rejectionNote && (
                  <div style={{ fontSize: 13 }}>
                    <strong>Note:</strong> {order.rejectionNote}
                  </div>
                )}
              </div>
            )}
        </div>

        {/* RIGHT SIDEBAR - sticky actions */}
        <div style={{ flex: '0 0 320px', minWidth: 280, position: 'sticky', top: 80 }}>
          <div className="card">
            <h2>Actions</h2>

            {order.acceptStatus === 'OPEN' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button
                  onClick={() => setShowAcceptModal(true)}
                  disabled={!!actionLoading}
                  className="btn btn-primary"
                  style={{ width: '100%', background: '#16a34a', borderColor: '#16a34a' }}
                >
                  {actionLoading === 'accept' ? 'Processing...' : 'Accept Order'}
                </button>
                <button
                  onClick={() => setShowRejectModal(true)}
                  disabled={!!actionLoading}
                  className="btn btn-secondary"
                  style={{
                    width: '100%',
                    background: '#fff',
                    color: '#dc2626',
                    borderColor: '#dc2626',
                  }}
                >
                  Reject Order
                </button>
              </div>
            )}

            {canMarkPacked && (
              <button
                onClick={() => setShowPackModal(true)}
                disabled={!!actionLoading}
                className="btn btn-primary"
                style={{ width: '100%', background: '#d97706', borderColor: '#d97706' }}
              >
                {actionLoading === 'pack' ? 'Updating...' : 'Mark as Packed'}
              </button>
            )}

            {canMarkShipped && (
              <button
                onClick={() => setShowShipModal(true)}
                disabled={!!actionLoading}
                className="btn btn-primary"
                style={{ width: '100%' }}
              >
                {actionLoading === 'ship' ? 'Updating...' : 'Mark as Shipped'}
              </button>
            )}

            {order.fulfillmentStatus === 'SHIPPED' &&
              (order.trackingNumber || order.courierName) && (
                <div
                  style={{
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: 8,
                    padding: 14,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#2563eb',
                      textTransform: 'uppercase',
                      marginBottom: 8,
                    }}
                  >
                    Shipment Tracking
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.7 }}>
                    <div>
                      <strong>Courier:</strong> {order.courierName || '-'}
                    </div>
                    <div>
                      <strong>Tracking:</strong>{' '}
                      <span style={{ fontFamily: 'monospace', color: '#2563eb' }}>
                        {order.trackingNumber || '-'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

            {order.fulfillmentStatus === 'DELIVERED' && order.deliveredAt && (
              <div
                style={{
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: 8,
                  padding: 14,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#16a34a',
                    textTransform: 'uppercase',
                    marginBottom: 4,
                  }}
                >
                  Delivered
                </div>
                <div style={{ fontSize: 13 }}>{fmtDateTime(order.deliveredAt)}</div>
              </div>
            )}

            {order.acceptStatus === 'REJECTED' && (
              <div style={{ fontSize: 13, color: '#dc2626', fontWeight: 600 }}>
                This order has been rejected.
              </div>
            )}
          </div>

          {/* Order Info */}
          <div className="card">
            <h2>Order Info</h2>
            <div style={{ fontSize: 13, lineHeight: 1.9, color: '#374151' }}>
              {mo?.orderNumber && (
                <div>
                  <strong>Order Number:</strong> {mo.orderNumber}
                </div>
              )}
              {mo?.paymentMethod && (
                <div>
                  <strong>Payment:</strong> {mo.paymentMethod}
                </div>
              )}
              <div>
                <strong>Payment Status:</strong> {order.paymentStatus}
              </div>
              {order.expectedDispatchDate && (
                <div>
                  <strong>Expected Dispatch:</strong>{' '}
                  {fmtDate(order.expectedDispatchDate)}
                </div>
              )}
              {order.acceptDeadlineAt && order.acceptStatus === 'OPEN' && (
                <div>
                  <strong>Accept By:</strong> {fmtDateTime(order.acceptDeadlineAt)}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ACCEPT MODAL */}
      {showAcceptModal && (
        <Modal
          onClose={() => {
            setShowAcceptModal(false);
            setExpectedDispatchDate('');
          }}
        >
          <h3 style={{ margin: '0 0 4px 0', fontSize: 18, fontWeight: 700, color: '#16a34a' }}>
            Accept Order
          </h3>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 20px 0' }}>
            You can optionally set an expected dispatch date for this order.
          </p>

          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            Expected Dispatch Date (optional)
          </label>
          <input
            type="date"
            value={expectedDispatchDate}
            onChange={(e) => setExpectedDispatchDate(e.target.value)}
            min={new Date().toISOString().split('T')[0]}
            style={modalInput}
          />

          <div style={modalFooter}>
            <button
              onClick={() => {
                setShowAcceptModal(false);
                setExpectedDispatchDate('');
              }}
              style={btnCancel}
            >
              Cancel
            </button>
            <button
              onClick={handleAcceptConfirm}
              disabled={!!actionLoading}
              style={{ ...btnConfirm, background: '#16a34a' }}
            >
              {actionLoading === 'accept' ? 'Accepting...' : 'Confirm Accept'}
            </button>
          </div>
        </Modal>
      )}

      {/* REJECT MODAL */}
      {showRejectModal && (
        <Modal
          onClose={() => {
            setShowRejectModal(false);
            setRejectReason('');
            setRejectNote('');
          }}
        >
          <h3 style={{ margin: '0 0 4px 0', fontSize: 18, fontWeight: 700, color: '#dc2626' }}>
            Reject Order
          </h3>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 20px 0' }}>
            Please provide a reason for rejecting this order.
          </p>

          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            Reason
          </label>
          <select
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            style={modalInput}
          >
            <option value="">Select a reason...</option>
            <option value="OUT_OF_STOCK">Out of Stock</option>
            <option value="CANNOT_SHIP">Cannot Ship to Location</option>
            <option value="LOCATION_ISSUE">Location Issue</option>
            <option value="OTHER">Other</option>
          </select>

          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            Note (optional)
          </label>
          <textarea
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="Additional details..."
            rows={3}
            style={{ ...modalInput, resize: 'vertical', fontFamily: 'inherit' }}
          />

          <div style={modalFooter}>
            <button
              onClick={() => {
                setShowRejectModal(false);
                setRejectReason('');
                setRejectNote('');
              }}
              style={btnCancel}
            >
              Cancel
            </button>
            <button
              onClick={handleRejectConfirm}
              disabled={!!actionLoading}
              style={{ ...btnConfirm, background: '#dc2626' }}
            >
              {actionLoading === 'reject' ? 'Rejecting...' : 'Confirm Reject'}
            </button>
          </div>
        </Modal>
      )}

      {/* PACK MODAL */}
      {showPackModal && (
        <Modal
          onClose={() => {
            setShowPackModal(false);
            setPackNote('');
          }}
        >
          <h3 style={{ margin: '0 0 4px 0', fontSize: 18, fontWeight: 700, color: '#d97706' }}>
            Mark Order as Packed
          </h3>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 20px 0' }}>
            Confirm that the items for this order have been packed.
          </p>

          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            Internal Note (optional)
          </label>
          <textarea
            value={packNote}
            onChange={(e) => setPackNote(e.target.value)}
            placeholder="Internal note about the packing..."
            rows={3}
            style={{ ...modalInput, resize: 'vertical', fontFamily: 'inherit' }}
          />

          <div style={modalFooter}>
            <button
              onClick={() => {
                setShowPackModal(false);
                setPackNote('');
              }}
              style={btnCancel}
            >
              Cancel
            </button>
            <button
              onClick={handlePackConfirm}
              disabled={!!actionLoading}
              style={{ ...btnConfirm, background: '#d97706' }}
            >
              {actionLoading === 'pack' ? 'Updating...' : 'Confirm Packed'}
            </button>
          </div>
        </Modal>
      )}

      {/* SHIP MODAL */}
      {showShipModal && (
        <Modal onClose={resetShipModal}>
          <h3 style={{ margin: '0 0 4px 0', fontSize: 18, fontWeight: 700, color: '#2563eb' }}>
            Mark Order as Shipped
          </h3>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 20px 0' }}>
            Provide the courier and tracking details.
          </p>

          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            Tracking Number *
          </label>
          <input
            type="text"
            value={shipTrackingNumber}
            onChange={(e) => setShipTrackingNumber(e.target.value)}
            placeholder="e.g. 1Z999AA10123456784"
            style={modalInput}
          />

          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            Courier *
          </label>
          <select
            value={shipCourierSelection}
            onChange={(e) => setShipCourierSelection(e.target.value)}
            style={modalInput}
          >
            <option value="">Select a courier...</option>
            <option value="BlueDart">BlueDart</option>
            <option value="Delhivery">Delhivery</option>
            <option value="FedEx">FedEx</option>
            <option value="DTDC">DTDC</option>
            <option value="India Post">India Post</option>
            <option value="Other">Other</option>
          </select>

          {shipCourierSelection === 'Other' && (
            <>
              <label
                style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}
              >
                Courier Name *
              </label>
              <input
                type="text"
                value={shipCourierOther}
                onChange={(e) => setShipCourierOther(e.target.value)}
                placeholder="Enter courier name"
                style={modalInput}
              />
            </>
          )}

          {shipError && (
            <div
              style={{
                fontSize: 12,
                color: '#dc2626',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 6,
                padding: '8px 12px',
                marginBottom: 16,
              }}
            >
              {shipError}
            </div>
          )}

          <div style={modalFooter}>
            <button onClick={resetShipModal} style={btnCancel}>
              Cancel
            </button>
            <button
              onClick={handleShipConfirm}
              disabled={!!actionLoading}
              style={{ ...btnConfirm, background: '#2563eb' }}
            >
              {actionLoading === 'ship' ? 'Shipping...' : 'Confirm Shipped'}
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
          width: 460,
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

/* -- Status timeline -- */
function StatusTimeline({
  acceptStatus,
  fulfillmentStatus,
}: {
  acceptStatus: string;
  fulfillmentStatus: string;
}) {
  const isCancelled =
    acceptStatus === 'REJECTED' ||
    acceptStatus === 'CANCELLED' ||
    fulfillmentStatus === 'CANCELLED';

  const accepted = acceptStatus === 'ACCEPTED';
  const packed =
    accepted && ['PACKED', 'SHIPPED', 'FULFILLED', 'DELIVERED'].includes(fulfillmentStatus);
  const shipped =
    accepted && ['SHIPPED', 'FULFILLED', 'DELIVERED'].includes(fulfillmentStatus);
  const delivered = accepted && ['FULFILLED', 'DELIVERED'].includes(fulfillmentStatus);

  const steps = [
    { label: 'Order Placed', done: true, current: false },
    {
      label: 'Accepted',
      done: accepted,
      current: acceptStatus === 'OPEN',
    },
    {
      label: 'Packed',
      done: packed,
      current: accepted && fulfillmentStatus === 'UNFULFILLED',
    },
    {
      label: 'Shipped',
      done: shipped,
      current: accepted && fulfillmentStatus === 'PACKED',
    },
    {
      label: 'Delivered',
      done: delivered,
      current: accepted && fulfillmentStatus === 'SHIPPED',
    },
  ];

  if (isCancelled) {
    return (
      <div
        style={{
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: 10,
          padding: '14px 18px',
          marginBottom: 16,
          fontSize: 13,
          fontWeight: 600,
          color: '#dc2626',
        }}
      >
        Order {acceptStatus === 'REJECTED' ? 'Rejected' : 'Cancelled'}
      </div>
    );
  }

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        padding: '20px 24px',
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          position: 'relative',
        }}
      >
        {steps.map((step, idx) => {
          const isLast = idx === steps.length - 1;
          const active = step.done;
          const isCurrent = step.current && !step.done;
          const circleBg = active ? '#16a34a' : isCurrent ? '#2563eb' : '#e5e7eb';
          const circleColor = active || isCurrent ? '#fff' : '#9ca3af';
          const labelColor = active ? '#16a34a' : isCurrent ? '#2563eb' : '#9ca3af';
          const nextDone = !isLast && steps[idx + 1].done;
          const connectorColor = nextDone ? '#16a34a' : '#e5e7eb';

          return (
            <div
              key={step.label}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                position: 'relative',
                minWidth: 0,
              }}
            >
              {!isLast && (
                <div
                  style={{
                    position: 'absolute',
                    top: 14,
                    left: '50%',
                    width: '100%',
                    height: 3,
                    background: connectorColor,
                    zIndex: 0,
                  }}
                />
              )}
              <div
                style={{
                  position: 'relative',
                  zIndex: 1,
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  background: circleBg,
                  color: circleColor,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  fontWeight: 700,
                  border: isCurrent ? '3px solid #bfdbfe' : 'none',
                  boxShadow: isCurrent ? '0 0 0 3px rgba(37,99,235,0.15)' : 'none',
                }}
              >
                {active ? '\u2713' : idx + 1}
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  color: labelColor,
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                }}
              >
                {step.label}
              </div>
            </div>
          );
        })}
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
