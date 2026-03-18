'use client';

import { useParams } from 'next/navigation';
import CollectionForm from '../_components/CollectionForm';

export default function EditCollectionPage() {
  const { id } = useParams<{ id: string }>();
  return <CollectionForm collectionId={id} />;
}
