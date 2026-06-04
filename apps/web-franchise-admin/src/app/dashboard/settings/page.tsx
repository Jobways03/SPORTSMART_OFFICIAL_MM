'use client';

import { useSearchParams } from 'next/navigation';
import { PartnerRegistrationPanel } from '@/components/PartnerRegistrationPanel';

/**
 * Franchise-admin settings hub. Currently surfaces only the
 * "Logistics partners" panel — staff (logged in as a SportsMart admin)
 * registers the franchise's pickup location with each courier the
 * facade can talk to. Calls hit /admin/logistics-partner/* with the
 * admin JWT; the apiClient stamps X-Seller-Type: FRANCHISE.
 *
 * `sellerId` is resolved from a `?sellerId=` query param so the same
 * page can be reached from any franchise's detail view.
 *
 * Add tiles above the panel as more account-level controls land.
 */
export default function SettingsHubPage() {
  const searchParams = useSearchParams();
  const sellerId = searchParams?.get('sellerId') ?? '';

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1080, margin: '0 auto' }}>
      <header style={{ marginBottom: 28 }}>
        <h1
          style={{ fontSize: 26, fontWeight: 700, margin: 0, color: '#0f172a' }}
        >
          Settings
        </h1>
        <p style={{ marginTop: 6, fontSize: 14, color: '#64748b' }}>
          Account-level controls for your franchise admin profile.
        </p>
      </header>

      {/* Logistics partners — admin registers the franchise store as a
          pickup location with each courier the facade can talk to.
          Endpoints are scoped per-seller via the URL :sellerId param
          (sourced from `?sellerId=` here). */}
      <section>
        <header style={{ marginBottom: 12 }}>
          <h2
            style={{
              fontSize: 18,
              fontWeight: 700,
              margin: 0,
              color: '#0f172a',
            }}
          >
            Logistics partners
          </h2>
          <p style={{ marginTop: 4, fontSize: 13, color: '#64748b' }}>
            Register the franchise store as a pickup location with each
            courier you want to use. Required before shipments can be booked.
          </p>
        </header>
        {sellerId ? (
          <PartnerRegistrationPanel sellerId={sellerId} />
        ) : (
          <div
            style={{
              padding: '16px 20px',
              fontSize: 13,
              color: '#92400e',
              background: '#fef3c7',
              border: '1px solid #fde68a',
              borderRadius: 8,
            }}
          >
            Open this page from a franchise&apos;s detail view, or append
            <code style={{ marginLeft: 4 }}>?sellerId=&lt;id&gt;</code> to the
            URL, to manage that franchise&apos;s partner registrations.
          </div>
        )}
      </section>
    </div>
  );
}
