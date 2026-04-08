'use client';

import { useParams } from 'next/navigation';
import BrandForm from '../_components/BrandForm';

export default function EditBrandPage() {
  const { id } = useParams<{ id: string }>();
  return <BrandForm brandId={id} />;
}
