'use client';

import { useParams } from 'next/navigation';
import DiscountForm from '../_components/DiscountForm';

export default function EditDiscountPage() {
  const { id } = useParams<{ id: string }>();
  return <DiscountForm discountId={id} />;
}
