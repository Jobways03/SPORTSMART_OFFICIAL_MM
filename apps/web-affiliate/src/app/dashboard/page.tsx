'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { adminFranchisesService } from '@/services/admin-franchises.service';

interface KpiState {
  totalFranchises: number | null;
  activeFranchises: number | null;
  pendingVerification: number | null;
  totalOrders: number | null;
  pendingSettlements: number | null;
}

// Placeholder the cards render until each KPI resolves. Using null
// (not 0) so "--" stays visible during a genuine in-flight fetch and
// a real zero from the API still shows as "0".
const INITIAL_KPIS: KpiState = {
  totalFranchises: null,
  activeFranchises: null,
  pendingVerification: null,
  totalOrders: null,
  pendingSettlements: null,
};

export default function FranchiseAdminDashboardPage() {
  const [adminName, setAdminName] = useState('');
  const [kpis, setKpis] = useState<KpiState>(INITIAL_KPIS);

  useEffect(() => {
    try {
      const adminData = sessionStorage.getItem('admin');
      if (adminData) {
        const admin = JSON.parse(adminData);
        setAdminName(admin.name);
      }
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Fetch franchises once and derive three KPIs from the same
      // payload (total / active / pending-verification). Cheaper than
      // three parallel calls to list with different filters, and there
      // are only a handful of franchises at this scale.
      const franchisesPromise = adminFranchisesService
        .listFranchises({ limit: 100 })
        .then((res) => res.data ?? null)
        .catch(() => null);

      // Settlements list only needs the pagination header, not the
      // rows. Ask for the minimum page size.
      const pendingSettlementsPromise = adminFranchisesService
        .listSettlements({ status: 'PENDING', limit: 1 })
        .then((res: any) => res?.data?.pagination?.total ?? null)
        .catch(() => null);

      const [franchisesData, pendingSettlements] = await Promise.all([
        franchisesPromise,
        pendingSettlementsPromise,
      ]);

      if (cancelled) return;

      let totalFranchises: number | null = null;
      let activeFranchises: number | null = null;
      let pendingVerification: number | null = null;
      let franchiseIds: string[] = [];

      if (franchisesData) {
        totalFranchises = franchisesData.pagination.total;
        activeFranchises = franchisesData.franchises.filter(
          (f) => f.status === 'ACTIVE',
        ).length;
        // "Pending verification" = anything not already VERIFIED.
        // Covers NOT_VERIFIED + UNDER_REVIEW; REJECTED is rare but
        // intentionally counted so it stays visible to admins until
        // they re-process it.
        pendingVerification = franchisesData.franchises.filter(
          (f) => f.verificationStatus !== 'VERIFIED',
        ).length;
        franchiseIds = franchisesData.franchises.map((f) => f.id);
      }

      setKpis((prev) => ({
        ...prev,
        totalFranchises,
        activeFranchises,
        pendingVerification,
        pendingSettlements,
      }));

      // Total orders fans out: there's no aggregate endpoint today,
      // so we sum each franchise's orders-pagination.total. Cheap
      // enough at the current scale (one small request per franchise,
      // in parallel). If this grows, add a dedicated summary endpoint
      // instead of removing the KPI.
      if (franchiseIds.length > 0) {
        const totals = await Promise.all(
          franchiseIds.map((id) =>
            adminFranchisesService
              .listFranchiseOrders(id, { limit: 1 })
              .then((r) => r.data?.pagination.total ?? 0)
              .catch(() => 0),
          ),
        );
        if (cancelled) return;
        const totalOrders = totals.reduce((a, b) => a + b, 0);
        setKpis((prev) => ({ ...prev, totalOrders }));
      } else {
        setKpis((prev) => ({ ...prev, totalOrders: 0 }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const fmt = (v: number | null) => (v === null ? '--' : v.toLocaleString('en-IN'));

  return (
    <div style={{ padding: 32 }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          Franchise Admin Dashboard
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
          Welcome back, {adminName || 'Admin'}. Manage franchises and operations.
        </p>
      </div>

      {/* Quick Stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 16,
        marginBottom: 32,
      }}>
        <StatCard label="Total Franchises" value={fmt(kpis.totalFranchises)} color="#3b82f6" />
        <StatCard label="Active Franchises" value={fmt(kpis.activeFranchises)} color="#22c55e" />
        <StatCard label="Pending Verification" value={fmt(kpis.pendingVerification)} color="#eab308" />
        <StatCard label="Total Orders" value={fmt(kpis.totalOrders)} color="#0ea5e9" />
        <StatCard label="Pending Settlements" value={fmt(kpis.pendingSettlements)} color="#f97316" />
      </div>

      {/* Quick Actions */}
      <div>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Quick Actions</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <ActionCard href="/dashboard/franchises" title="Manage Franchises" desc="View, edit, and manage all franchises" />
          <ActionCard href="/dashboard/catalog" title="Catalog" desc="Review franchise catalog mappings" />
          <ActionCard href="/dashboard/orders" title="Orders" desc="Track franchise orders" />
          <ActionCard href="/dashboard/settlements" title="Settlements" desc="Manage franchise settlements" />
          <ActionCard href="/dashboard/commission" title="Commission" desc="View commission records" />
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 12,
      padding: 20,
      borderLeft: `4px solid ${color}`,
    }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>{value}</div>
    </div>
  );
}

function ActionCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '16px 20px',
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        textDecoration: 'none',
        color: 'var(--color-text)',
        transition: 'all 0.15s',
      }}
    >
      <div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{desc}</div>
      </div>
    </Link>
  );
}
