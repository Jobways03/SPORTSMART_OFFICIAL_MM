'use client';

import { useSearchParams } from 'next/navigation';
import DiscountForm from '../_components/DiscountForm';

export default function NewDiscountPage() {
  const sp = useSearchParams();
  const type = sp.get('type') || 'AMOUNT_OFF_ORDER';
  return <DiscountForm discountType={type} />;
}
