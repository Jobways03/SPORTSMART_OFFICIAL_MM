'use client';

import { RequirePermission } from '@/lib/permissions';
import BlogPostForm from '../_components/BlogPostForm';

export default function NewBlogPostPage() {
  return (
    <RequirePermission
      anyOf={['content.write']}
      fallback={<div style={{ padding: 24 }}>Loading…</div>}
    >
      <BlogPostForm initial={null} />
    </RequirePermission>
  );
}
