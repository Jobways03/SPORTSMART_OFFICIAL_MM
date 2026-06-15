'use client';

import { FormEvent, useEffect, useState } from 'react';
import { apiFetch, formatDate } from '../../../lib/api';
import { validateIndianMobile, validatePersonName } from '../../../lib/validators';

interface Profile {
  id: string;
  email: string;
  phone?: string | null;
  firstName: string;
  lastName: string;
  websiteUrl?: string | null;
  socialHandle?: string | null;
  joinReason?: string | null;
  status: string;
  kycStatus: string;
  commissionPercentage?: string | null;
  approvedAt?: string | null;
  createdAt?: string;
}

interface FormState {
  firstName: string;
  lastName: string;
  phone: string;
  websiteUrl: string;
  socialHandle: string;
  joinReason: string;
}

const formFromProfile = (p: Profile): FormState => ({
  firstName: p.firstName ?? '',
  lastName: p.lastName ?? '',
  phone: p.phone ?? '',
  websiteUrl: p.websiteUrl ?? '',
  socialHandle: p.socialHandle ?? '',
  joinReason: p.joinReason ?? '',
});

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    apiFetch<Profile>('/affiliate/me')
      .then((p) => {
        setProfile(p);
        setForm(formFromProfile(p));
      })
      .catch((e) => setLoadError(e?.message ?? 'Could not load profile.'));
  }, []);

  if (loadError) return <p style={{ color: '#b91c1c' }}>{loadError}</p>;
  if (!profile || !form) {
    return (
      <div style={{ maxWidth: 760, marginInline: 'auto' }}>
        <div style={{ height: 30, width: 200, background: '#f1f5f9', borderRadius: 8, marginBottom: 8 }} />
        <div style={{ height: 14, width: 360, background: '#f1f5f9', borderRadius: 6, marginBottom: 24 }} />
        <div style={{ height: 220, background: '#f1f5f9', borderRadius: 12 }} />
      </div>
    );
  }

  const initials = `${profile.firstName?.[0] ?? ''}${profile.lastName?.[0] ?? ''}`.toUpperCase();

  // Build the payload with only changed fields — empty string is a
  // valid "clear" signal for the optional fields, so we keep it.
  const buildPatch = (): Partial<FormState> => {
    const patch: Partial<FormState> = {};
    (Object.keys(form) as (keyof FormState)[]).forEach((key) => {
      const original = (profile as any)[key] ?? '';
      if (form[key] !== original) patch[key] = form[key];
    });
    return patch;
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaveError('');
    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      // Nothing changed — just bail out of edit mode.
      setEditing(false);
      return;
    }
    // Validate only the changed fields so an unrelated edit isn't blocked.
    const fieldError =
      (patch.firstName !== undefined
        ? validatePersonName(form.firstName, 'First name')
        : null) ||
      (patch.lastName !== undefined
        ? validatePersonName(form.lastName, 'Last name')
        : null) ||
      (patch.phone !== undefined ? validateIndianMobile(form.phone) : null);
    if (fieldError) {
      setSaveError(fieldError);
      return;
    }
    setSaving(true);
    try {
      const updated = await apiFetch<Profile>('/affiliate/me', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setProfile(updated);
      setForm(formFromProfile(updated));
      setEditing(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2200);
    } catch (e: any) {
      setSaveError(e?.message ?? 'Could not save your changes.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setForm(formFromProfile(profile));
    setSaveError('');
    setEditing(false);
  };

  const isDirty = JSON.stringify(form) !== JSON.stringify(formFromProfile(profile));

  return (
    <div style={{ maxWidth: 760, marginInline: 'auto' }}>
      <header style={{ marginBottom: 22, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.02em' }}>
            Profile
          </h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
            {editing
              ? 'Edit your details below. Email stays the same — contact support to change it.'
              : 'Your affiliate account details. Click Edit to update name, contact, or bio.'}
          </p>
        </div>
        {!editing && (
          <button onClick={() => setEditing(true)} style={btnPrimary}>
            Edit profile
          </button>
        )}
      </header>

      {savedFlash && !editing && (
        <div role="status" style={successBanner}>
          ✓ Profile saved.
        </div>
      )}

      <form onSubmit={handleSave}>
        {/* Identity card */}
        <section
          style={{
            padding: 24,
            background: 'linear-gradient(135deg, #fff 0%, #f8fafc 100%)',
            border: '1px solid #e2e8f0',
            borderRadius: 14,
            marginBottom: 16,
            display: 'flex',
            alignItems: editing ? 'flex-start' : 'center',
            gap: 18,
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)',
              color: '#1d4ed8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 26,
              fontWeight: 700,
              flexShrink: 0,
              boxShadow: '0 4px 12px rgba(29, 78, 216, 0.1)',
            }}
          >
            {initials || '?'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {editing ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <FormField label="First name" required>
                  <input
                    value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                    required
                    maxLength={64}
                    disabled={saving}
                    style={inputStyle}
                  />
                </FormField>
                <FormField label="Last name" required>
                  <input
                    value={form.lastName}
                    onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                    required
                    maxLength={64}
                    disabled={saving}
                    style={inputStyle}
                  />
                </FormField>
              </div>
            ) : (
              <div style={{ fontSize: 20, fontWeight: 700 }}>
                {profile.firstName} {profile.lastName}
              </div>
            )}
            <div style={{ fontSize: 13, color: '#64748b', marginTop: editing ? 8 : 2 }}>
              {profile.email}
              {!editing && profile.phone && <> · {profile.phone}</>}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <Pill tone={pillTone(profile.status)}>{profile.status.replace(/_/g, ' ')}</Pill>
              <Pill tone={kycTone(profile.kycStatus)}>KYC: {profile.kycStatus.replace(/_/g, ' ')}</Pill>
              {profile.commissionPercentage != null && (
                <Pill tone="info">{Number(profile.commissionPercentage).toFixed(2)}% commission</Pill>
              )}
            </div>
          </div>
        </section>

        <Section title="Contact & online presence">
          {editing ? (
            <div style={{ padding: '16px 18px', display: 'grid', gap: 14 }}>
              <FormField
                label="Phone"
                required
                hint="10-digit Indian mobile starting with 6, 7, 8, or 9."
              >
                <input
                  type="tel"
                  inputMode="numeric"
                  value={form.phone}
                  onChange={(e) => {
                    // Indian mobile only: strip non-digits, drop any
                    // leading 0–5 (so the first digit is always 6–9),
                    // cap at 10 digits. Server re-validates with the
                    // same rule so any bypass still fails on submit.
                    let next = e.target.value.replace(/\D/g, '');
                    next = next.replace(/^[0-5]+/, '');
                    next = next.slice(0, 10);
                    setForm({ ...form, phone: next });
                  }}
                  required
                  pattern="^[6-9]\d{9}$"
                  maxLength={10}
                  placeholder="9876543210"
                  disabled={saving}
                  style={inputStyle}
                />
              </FormField>
              <FormField label="Website" optional>
                <input
                  type="url"
                  value={form.websiteUrl}
                  onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })}
                  placeholder="https://"
                  maxLength={2048}
                  disabled={saving}
                  style={inputStyle}
                />
              </FormField>
              <FormField label="Social handle" optional>
                <input
                  value={form.socialHandle}
                  onChange={(e) => setForm({ ...form, socialHandle: e.target.value })}
                  placeholder="@yourhandle"
                  maxLength={64}
                  disabled={saving}
                  style={inputStyle}
                />
              </FormField>
            </div>
          ) : (
            <>
              <Field label="Phone" value={profile.phone ?? '—'} />
              <Field label="Website" value={profile.websiteUrl ?? '—'} link={profile.websiteUrl} />
              <Field label="Social handle" value={profile.socialHandle ?? '—'} last />
            </>
          )}
        </Section>

        <Section title="Why you joined">
          {editing ? (
            <div style={{ padding: '16px 18px' }}>
              <FormField label="Reason" optional>
                <textarea
                  rows={3}
                  value={form.joinReason}
                  onChange={(e) => setForm({ ...form, joinReason: e.target.value })}
                  placeholder="Tell us a bit about how you'll promote SportsMart…"
                  maxLength={2000}
                  disabled={saving}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                />
              </FormField>
            </div>
          ) : profile.joinReason ? (
            <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, padding: '12px 18px' }}>
              {profile.joinReason}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: '#94a3b8', fontStyle: 'italic', padding: '12px 18px' }}>
              Not provided.
            </div>
          )}
        </Section>

        <Section title="Account & compensation">
          <Field
            label="Status"
            value={profile.status.replace(/_/g, ' ')}
            accent={profile.status === 'ACTIVE' ? 'success' : 'warning'}
          />
          <Field
            label="KYC"
            value={profile.kycStatus.replace(/_/g, ' ')}
            accent={profile.kycStatus === 'VERIFIED' ? 'success' : 'warning'}
          />
          <Field
            label="Commission rate"
            value={
              profile.commissionPercentage != null
                ? `${Number(profile.commissionPercentage).toFixed(2)}% (custom)`
                : 'Platform default'
            }
          />
          {profile.approvedAt && <Field label="Approved on" value={formatDate(profile.approvedAt)} />}
          {profile.createdAt && <Field label="Member since" value={formatDate(profile.createdAt)} last />}
        </Section>

        {editing && (
          <>
            {saveError && (
              <div role="alert" style={errorBanner}>
                {saveError}
              </div>
            )}
            <div
              style={{
                position: 'sticky',
                bottom: 0,
                background: '#fff',
                borderTop: '1px solid #e2e8f0',
                padding: '14px 0',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 10,
                marginTop: 12,
              }}
            >
              <button type="button" onClick={handleCancel} disabled={saving} style={btnGhost}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !isDirty}
                style={{ ...btnPrimary, opacity: saving || !isDirty ? 0.5 : 1, cursor: saving || !isDirty ? 'not-allowed' : 'pointer' }}
              >
                {saving ? 'Saving…' : isDirty ? 'Save changes' : 'No changes'}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, marginBottom: 16, overflow: 'hidden' }}>
      <header style={{ padding: '12px 18px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
        <h3 style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', margin: 0 }}>
          {title}
        </h3>
      </header>
      <div>{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  link,
  last,
  accent,
}: {
  label: string;
  value: string;
  link?: string | null;
  last?: boolean;
  accent?: 'success' | 'warning';
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '180px 1fr',
        gap: 16,
        padding: '12px 18px',
        borderBottom: last ? 'none' : '1px solid #f1f5f9',
        fontSize: 13,
      }}
    >
      <div style={{ color: '#64748b', fontWeight: 500 }}>{label}</div>
      <div
        style={{
          color: accent === 'success' ? '#15803d' : accent === 'warning' ? '#b45309' : '#0f172a',
          fontWeight: accent ? 600 : 400,
        }}
      >
        {link ? (
          <a href={link} target="_blank" rel="noreferrer" style={{ color: '#1d4ed8' }}>
            {value}
          </a>
        ) : (
          value
        )}
      </div>
    </div>
  );
}

function FormField({
  label,
  required,
  optional,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
        {label}
        {required && <span style={{ color: '#dc2626' }}> *</span>}
        {optional && <span style={{ color: '#94a3b8', fontWeight: 500 }}> (optional)</span>}
      </label>
      {children}
      {hint && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone: 'success' | 'warning' | 'info' | 'neutral' | 'danger' }) {
  const palette = {
    success: { bg: '#dcfce7', fg: '#15803d' },
    warning: { bg: '#fef3c7', fg: '#92400e' },
    info: { bg: '#dbeafe', fg: '#1e40af' },
    neutral: { bg: '#f1f5f9', fg: '#475569' },
    danger: { bg: '#fee2e2', fg: '#991b1b' },
  }[tone];
  return (
    <span style={{ padding: '3px 9px', fontSize: 10, fontWeight: 700, borderRadius: 999, background: palette.bg, color: palette.fg, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
      {children}
    </span>
  );
}

function pillTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'ACTIVE') return 'success';
  if (status === 'PENDING_APPROVAL') return 'warning';
  if (status === 'REJECTED' || status === 'SUSPENDED') return 'danger';
  return 'neutral';
}

function kycTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'VERIFIED') return 'success';
  if (status === 'PENDING') return 'warning';
  if (status === 'REJECTED') return 'danger';
  return 'neutral';
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
};

const btnPrimary: React.CSSProperties = {
  padding: '9px 18px',
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

const btnGhost: React.CSSProperties = {
  padding: '9px 16px',
  background: '#fff',
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  color: '#475569',
  cursor: 'pointer',
};

const successBanner: React.CSSProperties = {
  padding: '10px 14px',
  marginBottom: 16,
  background: '#dcfce7',
  border: '1px solid #bbf7d0',
  borderRadius: 8,
  fontSize: 13,
  color: '#15803d',
  fontWeight: 600,
};

const errorBanner: React.CSSProperties = {
  padding: '10px 14px',
  marginTop: 12,
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: 8,
  fontSize: 13,
  color: '#991b1b',
};
