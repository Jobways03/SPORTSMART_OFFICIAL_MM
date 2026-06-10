'use client';

// Product tax configuration (HSN / GST rate / supply taxability / cess /
// UQC) is managed by a SUPER-ADMIN only, per product, from the platform
// admin app. It is no longer available to seller-side admins — the API
// rejects the request (SUPER_ADMIN-gated), so this page now shows a notice
// instead of the (non-functional) bulk editor.

export default function BulkTaxConfigPage() {
  return (
    <main style={{ padding: 32, maxWidth: 640 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0F1115', margin: '0 0 8px' }}>
        Tax configuration
      </h1>
      <div
        style={{
          marginTop: 12,
          padding: '14px 16px',
          background: '#fef3c7',
          border: '1px solid #fde68a',
          borderRadius: 8,
          fontSize: 14,
          color: '#92400e',
          lineHeight: 1.5,
        }}
      >
        <strong>Managed by a super-admin.</strong> Product HSN codes and GST
        rates are now set exclusively by a platform super-admin, per product.
        Sellers and seller-admins can no longer edit tax classification.
        Please contact a super-admin for any HSN / GST corrections.
      </div>
    </main>
  );
}
