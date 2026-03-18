'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function ImpersonateHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      const token = searchParams.get('token');
      const data = searchParams.get('data');

      if (!token || !data) {
        setError('Invalid impersonation link');
        return;
      }

      const sellerData = JSON.parse(atob(data));

      sessionStorage.setItem('accessToken', token);
      sessionStorage.setItem('seller', JSON.stringify({
        sellerId: sellerData.sellerId,
        sellerName: sellerData.sellerName,
        sellerShopName: sellerData.sellerShopName,
        email: sellerData.email,
        phoneNumber: sellerData.phoneNumber,
      }));
      sessionStorage.setItem('impersonated', 'true');

      router.replace('/dashboard');
    } catch {
      setError('Failed to process impersonation');
    }
  }, [searchParams, router]);

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
