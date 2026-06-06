'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { adminFranchisesService } from '@/services/admin-franchises.service';
import { ApiError } from '@/lib/api-client';

/**
 * Franchise commission settings — the franchise equivalent of the seller-admin
 * commission/settings page. Franchise commission is NOT a global singleton like
 * the seller side; it's two flat per-partner rates (onlineFulfillmentRate,
 * procurementFeeRate). So this is a master/detail editor over the existing
 * GET /admin/franchises/:id + PATCH /admin/franchises/:id/commission endpoints.
 * Rate edits affect FUTURE orders only (the rate is snapshotted at order time).
 */
export default function FranchiseCommissionSettingsPage() {
  const [franchises, setFranchises] = useState<
    Array<{ id: string; businessName?: string; ownerName?: string }>
  >([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [onlineRate, setOnlineRate] = useState('');
  const [procurementRate, setProcurementRate] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminFranchisesService
      .listFranchises({ limit: 100 })
      .then((res) => setFranchises(res.data?.franchises || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const select = async (id: string) => {
    setSelected(id);
    setDetailLoading(true);
    setError('');
    setMsg('');
    try {
      const res = await adminFranchisesService.getFranchise(id);
      setOnlineRate(
        res.data?.onlineFulfillmentRate != null
          ? String(res.data.onlineFulfillmentRate)
          : '15',
      );
      setProcurementRate(
        res.data?.procurementFeeRate != null
          ? String(res.data.procurementFeeRate)
          : '5',
      );
    } catch {
      setError('Failed to load franchise commission rates');
    } finally {
      setDetailLoading(false);
    }
  };

  const validate = (): string | null => {
    const o = parseFloat(onlineRate);
    const p = parseFloat(procurementRate);
    if (isNaN(o) || isNaN(p)) return 'Rates must be valid numbers';
    if (o < 0 || o > 100)
      return 'Online fulfillment rate must be between 0 and 100';
    if (p < 0 || p > 100) return 'Procurement fee rate must be between 0 and 100';
    return null;
  };

  const save = async () => {
    if (!selected) return;
    const vError = validate();
    if (vError) {
      setError(vError);
      return;
    }
    setSaving(true);
    setError('');
    setMsg('');
    try {
      await adminFranchisesService.updateCommission(selected, {
        onlineFulfillmentRate: parseFloat(onlineRate),
        procurementFeeRate: parseFloat(procurementRate),
      });
      setMsg('Commission rates saved. Applies to future orders.');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (typeof err.body?.message === 'string' && err.body.message) ||
              'Failed to save'
          : 'Failed to save',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Link
        href="/dashboard/commission"
        style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}
      >
        &larr; Back to Commission
      </Link>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '8px 0 4px' }}>
        Commission Settings
      </h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
        Per-franchise commission rates. Edits apply to future orders only — each
        order snapshots the rate in effect at the time it&apos;s placed.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 24 }}>
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            padding: 16,
          }}
        >
          <h3
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: '#6b7280',
              marginBottom: 12,
              textTransform: 'uppercase',
            }}
          >
            Select Franchise
          </h3>
          {loading ? (
            <p style={{ color: '#9ca3af', fontSize: 13 }}>Loading...</p>
          ) : (
            franchises.map((f) => (
              <button
                key={f.id}
                onClick={() => select(f.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  border: 'none',
                  borderRadius: 6,
                  marginBottom: 4,
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 500,
                  background: selected === f.id ? '#eff6ff' : 'transparent',
                  color: selected === f.id ? '#2563eb' : '#111827',
                }}
              >
                {f.businessName || f.ownerName}
              </button>
            ))
          )}
        </div>

        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            padding: 24,
          }}
        >
          {!selected ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>
              Select a franchise to edit its commission rates
            </p>
          ) : detailLoading ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>
              Loading rates...
            </p>
          ) : (
            <div style={{ maxWidth: 420 }}>
              {error && (
                <div
                  style={{
                    background: '#fee2e2',
                    border: '1px solid #fecaca',
                    color: '#991b1b',
                    borderRadius: 8,
                    padding: '10px 12px',
                    fontSize: 13,
                    marginBottom: 14,
                  }}
                >
                  {error}
                </div>
              )}
              {msg && (
                <div
                  style={{
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    color: '#166534',
                    borderRadius: 8,
                    padding: '10px 12px',
                    fontSize: 13,
                    marginBottom: 14,
                  }}
                >
                  {msg}
                </div>
              )}

              <label
                style={{
                  display: 'block',
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#374151',
                  marginBottom: 6,
                }}
              >
                Online fulfillment rate (%)
              </label>
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={onlineRate}
                onChange={(e) => setOnlineRate(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: 8,
                  fontSize: 14,
                  marginBottom: 6,
                }}
              />
              <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 18 }}>
                Applied to online-fulfilled (storefront) orders this franchise
                ships.
              </p>

              <label
                style={{
                  display: 'block',
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#374151',
                  marginBottom: 6,
                }}
              >
                Procurement fee rate (%)
              </label>
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={procurementRate}
                onChange={(e) => setProcurementRate(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: 8,
                  fontSize: 14,
                  marginBottom: 6,
                }}
              />
              <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 22 }}>
                Applied to procurement transactions for this franchise.
              </p>

              <button
                onClick={save}
                disabled={saving}
                style={{
                  padding: '10px 22px',
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  background: saving ? '#9ca3af' : '#2563eb',
                  cursor: saving ? 'not-allowed' : 'pointer',
                }}
              >
                {saving ? 'Saving...' : 'Save rates'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
