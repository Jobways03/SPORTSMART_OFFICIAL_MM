'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

interface CommissionSettings {
  id: string;
  commissionType: string;
  commissionValue: number;
  secondCommissionValue: number;
  fixedCommissionType: string;
  enableMaxCommission: boolean;
  maxCommissionAmount: number | null;
}

const TYPES = [
  { value: 'PERCENTAGE', label: '%' },
  { value: 'FIXED', label: 'FIXED' },
  { value: 'PERCENTAGE_PLUS_FIXED', label: '% + FIXED' },
  { value: 'FIXED_PLUS_PERCENTAGE', label: 'FIXED + %' },
];

export default function CommissionSettingsPage() {
  const [settings, setSettings] = useState<CommissionSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Form state
  const [commissionType, setCommissionType] = useState('PERCENTAGE');
  const [commissionValue, setCommissionValue] = useState('20.00');
  const [secondCommissionValue, setSecondCommissionValue] = useState('0.00');
  const [fixedCommissionType, setFixedCommissionType] = useState('Product');
  const [enableMaxCommission, setEnableMaxCommission] = useState(false);
  const [maxCommissionAmount, setMaxCommissionAmount] = useState('0.00');

  useEffect(() => {
    apiClient<CommissionSettings>('/admin/commission/settings')
      .then((res) => {
        if (res.data) {
          const d = res.data;
          setSettings(d);
          setCommissionType(d.commissionType);
          setCommissionValue(Number(d.commissionValue).toFixed(2));
          setSecondCommissionValue(Number(d.secondCommissionValue).toFixed(2));
          setFixedCommissionType(d.fixedCommissionType || 'Product');
          setEnableMaxCommission(d.enableMaxCommission);
          setMaxCommissionAmount(d.maxCommissionAmount ? Number(d.maxCommissionAmount).toFixed(2) : '0.00');
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await apiClient<CommissionSettings>('/admin/commission/settings', {
        method: 'PUT',
        body: JSON.stringify({
          commissionType,
          commissionValue: parseFloat(commissionValue) || 0,
          secondCommissionValue: parseFloat(secondCommissionValue) || 0,
          fixedCommissionType,
          enableMaxCommission,
          maxCommissionAmount: enableMaxCommission ? parseFloat(maxCommissionAmount) || 0 : null,
        }),
      });
      if (res.data) setSettings(res.data);
      setMessage({ text: 'Commission settings saved successfully!', type: 'success' });
    } catch {
      setMessage({ text: 'Failed to save commission settings.', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const isCombo = commissionType === 'PERCENTAGE_PLUS_FIXED' || commissionType === 'FIXED_PLUS_PERCENTAGE';
  const primaryIsPercent = commissionType === 'PERCENTAGE' || commissionType === 'PERCENTAGE_PLUS_FIXED';
  const secondIsPercent = commissionType === 'FIXED_PLUS_PERCENTAGE';

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60, color: '#6b7280' }}>Loading settings...</div>;
  }

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        <Link href="/dashboard/commission" style={{ color: '#9ca3af', textDecoration: 'none' }}>COMMISSION</Link>
        {' / '}
        GLOBAL COMMISSION SETTINGS
      </div>

      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>Global Commission</h1>
      <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 24 }}>Here are settings for global commission.</p>

      {message && (
        <div style={{
          padding: '10px 16px',
          borderRadius: 6,
          marginBottom: 16,
          background: message.type === 'success' ? '#dcfce7' : '#fee2e2',
          color: message.type === 'success' ? '#166534' : '#991b1b',
          fontSize: 14,
          fontWeight: 500,
        }}>
          {message.text}
        </div>
      )}

      {/* Note card */}
      <div style={{
        borderLeft: '4px solid #3b82f6',
        background: '#f8fafc',
        padding: '16px 20px',
        borderRadius: '0 8px 8px 0',
        marginBottom: 28,
      }}>
        <div style={{ color: '#ef4444', fontWeight: 600, fontStyle: 'italic', marginBottom: 8 }}>Note :</div>
        <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.8 }}>
          <div><strong>%</strong> - In this type of commission, the percentage amount will be deducted from the base price of the product.</div>
          <div><strong>Fixed</strong> - In this type of commission, the fixed amount will be deducted from the base price.</div>
          <div><strong>% + Fixed</strong> - In this type of commission, first the percentage amount will be deducted from the base price of the product and then a fixed amount will be deducted from the remaining amount.</div>
          <div><strong>Fixed + %</strong> - In this type of commission, first a fixed amount will be deducted from the base price and then the percentage amount will be deducted from the remaining price.</div>
        </div>
      </div>

      {/* Settings form */}
      <div style={{
        borderLeft: '4px solid #3b82f6',
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: '24px 28px',
        marginBottom: 28,
      }}>
        {/* Commission Type */}
        <div style={{ marginBottom: 24 }}>
          <label style={labelStyle}>GLOBAL COMMISSION TYPE</label>
          <select
            value={commissionType}
            onChange={(e) => setCommissionType(e.target.value)}
            style={selectStyle}
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <div style={helpStyle}>Choose global commission type.</div>
        </div>

        {/* Fixed Commission Type (only for combo types) */}
        {isCombo && (
          <div style={{ marginBottom: 24 }}>
            <label style={labelStyle}>
              FIXED COMMISSION TYPE <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <select
              value={fixedCommissionType}
              onChange={(e) => setFixedCommissionType(e.target.value)}
              style={selectStyle}
            >
              <option value="Product">Product</option>
              <option value="Order">Order</option>
            </select>
          </div>
        )}

        {/* Primary Commission Value */}
        <div style={{ marginBottom: 24 }}>
          <label style={labelStyle}>
            GLOBAL COMMISSION <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={commissionValue}
              onChange={(e) => setCommissionValue(e.target.value)}
              style={inputStyle}
            />
            <span style={suffixStyle}>
              {primaryIsPercent ? '%' : 'FIXED'}
            </span>
          </div>
          <div style={helpStyle}>Enter global commission.</div>
        </div>

        {/* Second Commission Value (only for combo types) */}
        {isCombo && (
          <div style={{ marginBottom: 24 }}>
            <label style={labelStyle}>
              SECOND GLOBAL COMMISSION <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                value={secondCommissionValue}
                onChange={(e) => setSecondCommissionValue(e.target.value)}
                style={inputStyle}
              />
              <span style={suffixStyle}>
                {secondIsPercent ? '%' : 'FIXED'}
              </span>
            </div>
            <div style={helpStyle}>
              This is your second global commission that will apply on a product when second global commission is set.
            </div>
          </div>
        )}

        {/* Enable Max Commission */}
        <div style={{ marginBottom: 8 }}>
          <label style={labelStyle}>ENABLE MAXIMUM COMMISSION</label>
          <div
            onClick={() => setEnableMaxCommission(!enableMaxCommission)}
            style={{
              width: 52,
              height: 28,
              borderRadius: 14,
              background: enableMaxCommission ? '#22c55e' : '#d1d5db',
              cursor: 'pointer',
              position: 'relative',
              transition: 'background 0.2s',
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: '#fff',
                position: 'absolute',
                top: 3,
                left: enableMaxCommission ? 27 : 3,
                transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }}
            />
          </div>
          <div style={helpStyle}>From this option, you can opt maximum commission from a seller per order.</div>
        </div>

        {/* Max Commission Amount */}
        {enableMaxCommission && (
          <div style={{ marginBottom: 24, marginTop: 16 }}>
            <label style={labelStyle}>
              MAXIMUM COMMISSION AMOUNT <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                value={maxCommissionAmount}
                onChange={(e) => setMaxCommissionAmount(e.target.value)}
                style={inputStyle}
              />
              <span style={suffixStyle}>FIXED</span>
            </div>
            <div style={helpStyle}>Maximum commission amount per seller per order.</div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '10px 28px',
            fontSize: 14,
            fontWeight: 700,
            border: 'none',
            background: '#22c55e',
            color: '#fff',
            borderRadius: 6,
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? 'SAVING...' : 'SAVE'}
        </button>
        <Link
          href="/dashboard/commission"
          style={{ fontSize: 14, color: '#22c55e', fontWeight: 600, textDecoration: 'none' }}
        >
          CANCEL
        </Link>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: '#374151',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  marginBottom: 8,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 60px 10px 12px',
  fontSize: 14,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  outline: 'none',
  boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  fontSize: 14,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  outline: 'none',
  background: '#fff',
  boxSizing: 'border-box',
};

const suffixStyle: React.CSSProperties = {
  position: 'absolute',
  right: 12,
  top: '50%',
  transform: 'translateY(-50%)',
  fontSize: 13,
  color: '#6b7280',
  fontWeight: 600,
  pointerEvents: 'none',
};

const helpStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#9ca3af',
  marginTop: 4,
};
