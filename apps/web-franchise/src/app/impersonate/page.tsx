'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

function ImpersonateHandler() {
  const router = useRouter();
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      // Token + payload arrive in the URL fragment (see the franchise-admin
      // impersonate modal). Fragments aren't sent to the server or in
      // cross-origin Referer, so reading from window.location.hash — not
      // searchParams — is the whole point of the scheme. Parse, store, then
      // strip the hash from history so the next page load can't re-read stale
      // credentials.
      const rawHash = window.location.hash.startsWith('#')
        ? window.location.hash.slice(1)
        : window.location.hash;
      const params = new URLSearchParams(rawHash);
      const token = params.get('token');
      const data = params.get('data');

      if (!token || !data) {
        setError('Invalid impersonation link');
        return;
      }

      const franchiseData = JSON.parse(atob(data));

      sessionStorage.setItem('accessToken', token);
      // The franchise portal keys its session under `franchise` (not `seller`,
      // like the D2C/Retail portals). The dashboard layout refetches
      // /franchise/profile on mount and overwrites this with the authoritative
      // status/verification fields, so we only need enough to render before
      // that resolves.
      sessionStorage.setItem('franchise', JSON.stringify({
        franchiseId: franchiseData.franchiseId,
        franchiseCode: franchiseData.franchiseCode,
        ownerName: franchiseData.ownerName,
        businessName: franchiseData.businessName,
        email: franchiseData.email,
        phoneNumber: franchiseData.phoneNumber,
      }));
      sessionStorage.setItem('impersonated', 'true');

      // Clear the hash so the token no longer sits in window.location or
      // browser history after the handoff completes.
      window.history.replaceState(null, '', window.location.pathname);

      router.replace('/dashboard');
    } catch {
      setError('Failed to process impersonation');
    }
  }, [router]);

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ marginBottom: 8 }}>Impersonation Error</h2>
          <p style={{ color: '#6b7280' }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <p>Setting up impersonation session...</p>
    </div>
  );
}

export default function ImpersonatePage() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif' }}>
        <p>Loading...</p>
      </div>
    }>
      <ImpersonateHandler />
    </Suspense>
  );
}
