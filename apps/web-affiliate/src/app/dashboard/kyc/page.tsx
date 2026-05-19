'use client';

// ─────────────────────────────────────────────────────────────────────
// KYC PAGE — TEMPORARILY DISABLED (commented out per product request).
//
// The full implementation (PAN/Aadhaar capture, Cloudinary uploads,
// admin review queue) is preserved below in a block comment. To re-
// enable: delete this stub, restore the block-commented code, restore
// the sidebar nav entry in components/AppShell.tsx, restore the KYC
// step in dashboard/page.tsx + payouts/page.tsx checklists, and
// restore the backend routes in affiliate-self.controller.ts and
// admin-affiliate.controller.ts.
// ─────────────────────────────────────────────────────────────────────

export default function KycPage() {
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
        KYC verification is temporarily unavailable
      </h1>
      <p style={{ fontSize: 13, color: '#64748b', margin: 0, lineHeight: 1.6 }}>
        We&apos;ve paused KYC submissions while we rework the verification
        flow. You can still earn commissions and request payouts during
        this period — no action needed on your side.
      </p>
    </div>
  );
}

/*
ORIGINAL IMPLEMENTATION — kept for reference, restore when re-enabling.

import { useEffect, useState } from 'react';
import { apiFetch, formatDate } from '../../../lib/api';

interface KycRecord {
  status: 'NOT_STARTED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  panLast4?: string | null;
  aadhaarLast4?: string | null;
  panDocumentUrl?: string | null;
  aadhaarDocumentUrl?: string | null;
  verifiedAt?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

// ... full PAN+Aadhaar capture, upload, status card, etc.
// (see git history for the previous implementation)
*/
