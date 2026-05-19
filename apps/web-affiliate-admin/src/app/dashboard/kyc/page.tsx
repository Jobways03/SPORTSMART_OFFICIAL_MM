'use client';

// ─────────────────────────────────────────────────────────────────────
// KYC REVIEW — TEMPORARILY DISABLED (commented out per product request).
//
// The full review-queue implementation (list filter, verify/reject
// modal, full PAN/Aadhaar reveal) is preserved in git history. To
// re-enable: restore this page, restore the sidebar entry in
// components/AppShell.tsx, restore the kyc-pending KPI tile in
// dashboard/overview/page.tsx, and restore the backend routes in
// admin-affiliate.controller.ts.
// ─────────────────────────────────────────────────────────────────────

export default function KycReviewPage() {
  return (
    <div
      style={{
        maxWidth: 560,
        marginInline: 'auto',
        marginTop: 80,
        padding: 32,
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
        Feature paused
      </div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px', color: '#0f172a' }}>
        KYC review is temporarily disabled
      </h1>
      <p style={{ fontSize: 13, color: '#64748b', margin: 0, lineHeight: 1.6 }}>
        Affiliate KYC submissions are paused. Approve / reject decisions
        on the existing queue will resume once the workflow is restored.
      </p>
    </div>
  );
}
