// Shared return-detail formatters + status-badge classing for the Franchise
// admin. Mirrors web-d2c-seller-admin / web-retail-seller-admin so the Franchise
// returns surface renders with the same design language.

export function formatStatus(status?: string | null): string {
  return (status ?? '').replace(/_/g, ' ') || '—';
}

export function getStatusBadgeClass(status?: string | null): string {
  const base = 'return-status-badge';
  switch (status) {
    case 'REJECTED':
    case 'CANCELLED':
    case 'QC_REJECTED':
      return `${base} danger`;
    case 'REFUNDED':
    case 'COMPLETED':
    case 'QC_APPROVED':
      return `${base} success`;
    case 'IN_TRANSIT':
    case 'PICKUP_SCHEDULED':
    case 'REFUND_PROCESSING':
      return `${base} progress`;
    case 'RECEIVED':
    case 'PARTIALLY_APPROVED':
      return `${base} warning`;
    case 'REQUESTED':
    case 'APPROVED':
    default:
      return `${base} neutral`;
  }
}

export function formatCurrency(
  amount: number | string | null | undefined,
): string {
  if (amount == null || amount === '') return '—';
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return '—';
  }
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return '—';
  }
}
