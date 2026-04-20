'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { profileService, CustomerProfile } from '@/services/profile.service';

export default function AccountHubPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);

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
        if (res.data) setProfile(res.data);
      })
      .catch(() => router.push('/login'))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="products-loading">
          <div className="loading-spinner"></div>
          <span>Loading account...</span>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="account-page">
        <h1 className="orders-page-title">My Account</h1>

        {profile && (
          <div className="account-hero">
            <div className="account-hero-avatar">
              {profile.firstName.charAt(0).toUpperCase()}
              {profile.lastName.charAt(0).toUpperCase()}
            </div>
            <div className="account-hero-info">
              <div className="account-hero-name">
                {profile.firstName} {profile.lastName}
              </div>
              <div className="account-hero-email">{profile.email}</div>
            </div>
          </div>
        )}

        <div className="account-hub-grid">
          <Link href="/account/profile" className="account-card">
            <div className="account-card-icon">&#128100;</div>
            <div className="account-card-title">My Profile</div>
            <div className="account-card-desc">Manage personal details and password</div>
          </Link>

          <Link href="/account/addresses" className="account-card">
            <div className="account-card-icon">&#127968;</div>
            <div className="account-card-title">My Addresses</div>
            <div className="account-card-desc">Add and edit shipping addresses</div>
          </Link>

          <Link href="/orders" className="account-card">
            <div className="account-card-icon">&#128230;</div>
            <div className="account-card-title">My Orders</div>
            <div className="account-card-desc">Track orders and view history</div>
          </Link>

          <Link href="/returns" className="account-card">
            <div className="account-card-icon">&#128230;</div>
            <div className="account-card-title">My Returns</div>
            <div className="account-card-desc">View and manage return requests</div>
          </Link>
        </div>
      </div>
    </>
  );
}
