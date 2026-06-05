// Customer-facing labels + tones for MasterOrder statuses. Mirrors the
// web-storefront's customerStatusLabel/customerStatusTone helpers so the
// mobile UI agrees with the web on what users see for the same status.

export type StatusTone = 'success' | 'progress' | 'pending' | 'cancelled';

export function orderStatusLabel(
  status: string,
  paymentStatus?: string,
): string {
  if (paymentStatus === 'PAID' && status === 'DELIVERED') return 'Completed';
  switch (status) {
    case 'PLACED':
    case 'PENDING_VERIFICATION':
      return 'Order placed';
    case 'VERIFIED':
    case 'ROUTED_TO_SELLER':
    case 'SELLER_ACCEPTED':
      return 'Confirmed';
    case 'PACKED':
      return 'Packed';
    case 'SHIPPED':
    case 'DISPATCHED':
      return 'Shipped';
    case 'DELIVERED':
      return 'Delivered';
    case 'CANCELLED':
      return 'Cancelled';
    case 'EXCEPTION_QUEUE':
      return 'Processing';
    default:
      return status;
  }
}

export function orderStatusTone(
  status: string,
  paymentStatus?: string,
): StatusTone {
  if (paymentStatus === 'CANCELLED' || status === 'CANCELLED') return 'cancelled';
  if (paymentStatus === 'PAID' && status === 'DELIVERED') return 'success';
  if (status === 'DELIVERED') return 'success';
  if (
    [
      'SHIPPED',
      'DISPATCHED',
      'PACKED',
      'SELLER_ACCEPTED',
      'ROUTED_TO_SELLER',
      'VERIFIED',
    ].includes(status)
  ) {
    return 'progress';
  }
  return 'pending';
}

const TONE_BG: Record<StatusTone, string> = {
  success: 'bg-green-50',
  progress: 'bg-blue-50',
  pending: 'bg-amber-50',
  cancelled: 'bg-red-50',
};
const TONE_TEXT: Record<StatusTone, string> = {
  success: 'text-green-700',
  progress: 'text-blue-700',
  pending: 'text-amber-700',
  cancelled: 'text-red-700',
};

export function toneClasses(tone: StatusTone): {bg: string; text: string} {
  return {bg: TONE_BG[tone], text: TONE_TEXT[tone]};
}

/** Order can be cancelled by the customer up to PACKED. */
export function canCancelOrder(status: string): boolean {
  return [
    'PLACED',
    'PENDING_VERIFICATION',
    'VERIFIED',
    'ROUTED_TO_SELLER',
    'SELLER_ACCEPTED',
  ].includes(status);
}
