'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { profileService, CustomerProfile } from '@/services/profile.service';
import { ApiError } from '@/lib/api-client';

const formatPhoneWithCountryCode = (phone: string | null | undefined): string => {
  if (!phone) return '';
  const trimmed = phone.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`;
};

export default function ProfilePage() {
  const router = useRouter();
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
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (!sessionStorage.getItem('accessToken')) {
        router.push('/login');
        return;
      }
    } catch {
      router.push('/login');
      return;
    }

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
  }, [router]);

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
      alert(msg || 'Failed to update profile.');
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
      alert('Password changed \u2014 please log in again');
      router.push('/login');
    } catch (err) {
      const msg = err instanceof ApiError ? err.body.message : 'Failed to change password.';
      setPasswordError(msg || 'Failed to change password.');
      alert(msg || 'Failed to change password.');
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="products-loading">
          <div className="loading-spinner"></div>
          <span>Loading profile...</span>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="account-page">
        <div className="account-breadcrumb">
          <Link href="/account">My Account</Link>
          <span>&rsaquo;</span>
          <span>Profile</span>
        </div>
        <h1 className="orders-page-title">My Profile</h1>

        <section className="profile-section">
          <h2 className="profile-section-title">Personal Information</h2>
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
                      {profile.emailVerified ? 'Verified' : 'Unverified'}
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
              </div>

              <div className="profile-field">
                <label htmlFor="phone">
                  Phone
                  {profile && profile.phone && (
                    <span
                      className={
                        profile.phoneVerified ? 'profile-verified-badge' : 'profile-unverified-badge'
                      }
                    >
                      {profile.phoneVerified ? 'Verified' : 'Unverified'}
                    </span>
                  )}
                </label>
                <input
                  id="phone"
                  type="tel"
                  className="profile-input"
                  placeholder="+91XXXXXXXXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>

            {profileSuccess && <div className="profile-success-msg">{profileSuccess}</div>}
            {profileError && <div className="profile-error-msg">{profileError}</div>}

            <button type="submit" className="profile-save-btn" disabled={savingProfile}>
              {savingProfile ? 'Saving...' : 'Save Changes'}
            </button>
          </form>
        </section>

        <section className="profile-section">
          <h2 className="profile-section-title">Change Password</h2>
          <form onSubmit={handlePasswordSubmit}>
            <div className="profile-form-grid">
              <div className="profile-field profile-field-full">
                <label htmlFor="currentPassword">Current Password</label>
                <input
                  id="currentPassword"
                  type="password"
                  className="profile-input"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>

              <div className="profile-field">
                <label htmlFor="newPassword">New Password</label>
                <input
                  id="newPassword"
                  type="password"
                  className="profile-input"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>

              <div className="profile-field">
                <label htmlFor="confirmPassword">Confirm New Password</label>
                <input
                  id="confirmPassword"
                  type="password"
                  className="profile-input"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            {passwordError && <div className="profile-error-msg">{passwordError}</div>}

            <button type="submit" className="profile-save-btn" disabled={changingPassword}>
              {changingPassword ? 'Changing...' : 'Change Password'}
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
