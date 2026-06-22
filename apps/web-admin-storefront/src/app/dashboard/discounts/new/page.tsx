'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import DiscountForm from '../_components/DiscountForm';

function NewDiscountContent() {
  const sp = useSearchParams();
  const type = sp.get('type') || 'AMOUNT_OFF_ORDER';
  return <DiscountForm discountType={type} />;
}

export default function NewDiscountPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm opacity-70">Loading…</div>}>
      <NewDiscountContent />
    </Suspense>
  );
}
