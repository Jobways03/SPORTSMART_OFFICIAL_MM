export const RETURNS_EVENTS = {
  REQUESTED: 'returns.requested',
  APPROVED: 'returns.approved',
  REJECTED: 'returns.rejected',
  PICKUP_CREATED: 'returns.pickup.created',
  ITEM_RECEIVED: 'returns.item.received',
  QC_COMPLETED: 'returns.qc.completed',
  REFUND_APPROVED: 'returns.refund.approved',
  REFUND_REJECTED: 'returns.refund.rejected',
  ADJUSTMENT_REQUESTED: 'returns.adjustment.requested',
  DISPUTE_OPENED: 'returns.dispute.opened',
  DISPUTE_CLOSED: 'returns.dispute.closed',
} as const;
