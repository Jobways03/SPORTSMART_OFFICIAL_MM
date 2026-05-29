'use client';

import { useEffect, useState, useMemo, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import { profileService, CustomerProfile } from '@/services/profile.service';
import { ApiError } from '@/lib/api-client';
import { useModal } from '@sportsmart/ui';
import { useAuthGuard } from '@/lib/useAuthGuard';

const formatPhoneWithCountryCode = (phone: string | null | undefined): string => {
  if (!phone) return '';
  const trimmed = phone.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`;
};

const ICONS = {
  user: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  eye: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  eyeOff: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  alert: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
};

function calcPasswordStrength(pwd: string): { score: number; label: string; tone: 'weak' | 'fair' | 'good' | 'strong' } {
  if (!pwd) return { score: 0, label: '', tone: 'weak' };
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 12) score++;
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score++;
  if (/\d/.test(pwd)) score++;
  if (/[^a-zA-Z0-9]/.test(pwd)) score++;
  const capped = Math.min(score, 4);
  const tone = (['weak', 'weak', 'fair', 'good', 'strong'] as const)[capped];
  const label = (['Too short', 'Weak', 'Fair', 'Good', 'Strong'] as const)[capped];
  return { score: capped, label, tone };
}

export default function ProfilePage() {
  const { notify } = useModal();
  const router = useRouter();
  const authStatus = useAuthGuard();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Profile form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Password form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus !== 'authed') return;
    profileService
      .getProfile()
      .then((res) => {
        if (res.data) {
          setProfile(res.data);
          setFirstName(res.data.firstName || '');
          setLastName(res.data.lastName || '');
          setEmail(res.data.email || '');
          setPhone(res.data.phone || '');
        }
      })
      .catch(() => router.push('/login'))
      .finally(() => setLoading(false));
  }, [authStatus, router]);

  const isProfileDirty = useMemo(() => {
    if (!profile) return false;
    return (
      firstName !== (profile.firstName || '') ||
      lastName !== (profile.lastName || '') ||
      email !== (profile.email || '') ||
      phone !== (profile.phone || '')
    );
  }, [profile, firstName, lastName, email, phone]);

  const handleResetProfile = () => {
    if (!profile) return;
    setFirstName(profile.firstName || '');
    setLastName(profile.lastName || '');
    setEmail(profile.email || '');
    setPhone(profile.phone || '');
    setProfileError(null);
    setProfileSuccess(null);
  };

  const handleProfileSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    setProfileSuccess(null);

    if (!firstName.trim() || !lastName.trim()) {
      setProfileError('First name and last name are required.');
      return;
    }

    if (!email.trim()) {
      setProfileError('Email is required.');
      return;
    }

    let normalizedPhone: string | null = null;
    if (phone.trim()) {
      const formatted = formatPhoneWithCountryCode(phone);
      const digits = formatted.replace(/\D/g, '');
      if (digits.length < 10) {
        setProfileError('Phone number must be at least 10 digits.');
        return;
      }
      normalizedPhone = formatted;
    }

    setSavingProfile(true);
    try {
      const res = await profileService.updateProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: normalizedPhone,
      });
      if (res.data) {
        setProfile(res.data);
        setFirstName(res.data.firstName || '');
        setLastName(res.data.lastName || '');
        setEmail(res.data.email || '');
        setPhone(res.data.phone || '');
      }
      setProfileSuccess('Profile updated successfully.');
    } catch (err) {
      const msg = err instanceof ApiError ? err.body.message : 'Failed to update profile.';
      setProfileError(msg || 'Failed to update profile.');
      void notify(msg || 'Failed to update profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordError(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('All password fields are required.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.');
      return;
    }

    setChangingPassword(true);
    try {
      await profileService.changePassword({ currentPassword, newPassword, confirmPassword });
      try {
        sessionStorage.removeItem('accessToken');
        sessionStorage.removeItem('refreshToken');
        sessionStorage.removeItem('user');
      } catch {
        // ignore storage errors
      }
      void notify('Password changed — please log in again');
      router.push('/login');
    } catch (err) {
      const msg = err instanceof ApiError ? err.body.message : 'Failed to change password.';
      setPasswordError(msg || 'Failed to change password.');
      void notify(msg || 'Failed to change password.');
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading) {
    return (
      <StorefrontShell>
        <div className="products-loading">
          <div className="loading-spinner"></div>
          <span>Loading profile...</span>
        </div>
      </StorefrontShell>
    );
  }

  const strength = calcPasswordStrength(newPassword);

  return (
    <StorefrontShell>
      <div className="account-page">
        <div className="account-breadcrumb">
          <Link href="/account">My Account</Link>
          <span>&rsaquo;</span>
          <span>Profile</span>
        </div>

        <div className="account-page-header">
          <h1 className="account-page-title">My Profile</h1>
          <p className="account-page-subtitle">
            Update your personal information and password
          </p>
        </div>

        <section className="profile-section">
          <div className="profile-section-header">
            <div className="profile-section-icon profile-section-icon-blue">
              {ICONS.user}
            </div>
            <div className="profile-section-header-text">
              <h2 className="profile-section-title">Personal Information</h2>
              <p className="profile-section-desc">
                Update your name, email, and phone number
              </p>
            </div>
          </div>

          <form onSubmit={handleProfileSubmit}>
            <div className="profile-form-grid">
              <div className="profile-field">
                <label htmlFor="firstName">First Name</label>
                <input
                  id="firstName"
                  type="text"
                  className="profile-input"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                />
              </div>

              <div className="profile-field">
                <label htmlFor="lastName">Last Name</label>
                <input
                  id="lastName"
                  type="text"
                  className="profile-input"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                />
              </div>

              <div className="profile-field">
                <label htmlFor="email">
                  Email
                  {profile && (
                    <span
                      className={
                        profile.emailVerified ? 'profile-verified-badge' : 'profile-unverified-badge'
                      }
                    >
                      {profile.emailVerified ? (
                        <>
                          <span className="profile-badge-icon">{ICONS.check}</span>
                          Verified
                        </>
                      ) : (
                        <>
                          <span className="profile-badge-icon">{ICONS.alert}</span>
                          Unverified
                        </>
                      )}
                    </span>
                  )}
                </label>
                <input
                  id="email"
                  type="email"
                  className="profile-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                {profile && !profile.emailVerified && (
                  <div className="profile-field-helper">
                    Verify your email to receive order updates and security alerts.
                  </div>
                )}
              </div>

              <div className="profile-field">
                <label htmlFor="phone">Phone</label>
                <input
                  id="phone"
                  type="tel"
                  className="profile-input"
                  placeholder="+91XXXXXXXXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
                <div className="profile-field-helper">
                  Used for delivery updates and one-time passwords.
                </div>
              </div>
            </div>

            {profileSuccess && (
              <div className="profile-alert profile-alert-success">
                <span className="profile-alert-icon">{ICONS.check}</span>
                {profileSuccess}
              </div>
            )}
            {profileError && (
              <div className="profile-alert profile-alert-error">
                <span className="profile-alert-icon">{ICONS.alert}</span>
                {profileError}
              </div>
            )}

            <div className="profile-section-footer">
              <button
                type="button"
                className="profile-btn-secondary"
                onClick={handleResetProfile}
                disabled={!isProfileDirty || savingProfile}
              >
                Reset
              </button>
              <button
                type="submit"
                className="profile-btn-primary"
                disabled={savingProfile || !isProfileDirty}
              >
                {savingProfile ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </section>

        <section className="profile-section">
          <div className="profile-section-header">
            <div className="profile-section-icon profile-section-icon-rose">
              {ICONS.lock}
            </div>
            <div className="profile-section-header-text">
              <h2 className="profile-section-title">Change Password</h2>
              <p className="profile-section-desc">
                Use at least 8 characters. You&apos;ll be signed out after changing.
              </p>
            </div>
          </div>

          <form onSubmit={handlePasswordSubmit}>
            <div className="profile-form-grid">
              <div className="profile-field profile-field-full">
                <label htmlFor="currentPassword">Current Password</label>
                <div className="profile-input-wrap">
                  <input
                    id="currentPassword"
                    type={showCurrent ? 'text' : 'password'}
                    className="profile-input profile-input-with-icon"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="profile-input-toggle"
                    onClick={() => setShowCurrent((v) => !v)}
                    aria-label={showCurrent ? 'Hide password' : 'Show password'}
                  >
                    {showCurrent ? ICONS.eyeOff : ICONS.eye}
                  </button>
                </div>
              </div>

              <div className="profile-field">
                <label htmlFor="newPassword">New Password</label>
                <div className="profile-input-wrap">
                  <input
                    id="newPassword"
                    type={showNew ? 'text' : 'password'}
                    className="profile-input profile-input-with-icon"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="profile-input-toggle"
                    onClick={() => setShowNew((v) => !v)}
                    aria-label={showNew ? 'Hide password' : 'Show password'}
                  >
                    {showNew ? ICONS.eyeOff : ICONS.eye}
                  </button>
                </div>
                {newPassword && (
                  <div className="profile-pwd-strength">
                    <div className="profile-pwd-strength-track">
                      {[0, 1, 2, 3].map((i) => (
                        <span
                          key={i}
                          className={`profile-pwd-strength-bar${i < strength.score ? ` is-${strength.tone}` : ''}`}
                        />
                      ))}
                    </div>
                    <span className={`profile-pwd-strength-label is-${strength.tone}`}>
                      {strength.label}
                    </span>
                  </div>
                )}
              </div>

              <div className="profile-field">
                <label htmlFor="confirmPassword">Confirm New Password</label>
                <div className="profile-input-wrap">
                  <input
                    id="confirmPassword"
                    type={showConfirm ? 'text' : 'password'}
                    className="profile-input profile-input-with-icon"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="profile-input-toggle"
                    onClick={() => setShowConfirm((v) => !v)}
                    aria-label={showConfirm ? 'Hide password' : 'Show password'}
                  >
                    {showConfirm ? ICONS.eyeOff : ICONS.eye}
                  </button>
                </div>
                {confirmPassword && newPassword && confirmPassword !== newPassword && (
                  <div className="profile-field-helper profile-field-helper-error">
                    Passwords don&apos;t match
                  </div>
                )}
              </div>
            </div>

            {passwordError && (
              <div className="profile-alert profile-alert-error">
                <span className="profile-alert-icon">{ICONS.alert}</span>
                {passwordError}
              </div>
            )}

            <div className="profile-section-footer">
              <button
                type="submit"
                className="profile-btn-primary"
                disabled={changingPassword}
              >
                {changingPassword ? 'Changing…' : 'Change password'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </StorefrontShell>
  );
}
