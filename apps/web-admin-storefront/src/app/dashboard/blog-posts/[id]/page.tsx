'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { RequirePermission } from '@/lib/permissions';
import {
  adminBlogPostsService,
  type BlogPost,
} from '@/services/admin-blog-posts.service';
import BlogPostForm from '../_components/BlogPostForm';

export default function EditBlogPostPage() {
  return (
    <RequirePermission
      anyOf={['content.write', 'content.read']}
      fallback={<div style={{ padding: 24 }}>Loading…</div>}
    >
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [post, setPost] = useState<BlogPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    adminBlogPostsService
      .getOne(id)
      .then((res) => {
        if (cancelled) return;
        setPost(res.data ?? null);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : 'Failed to load post');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;
  if (err) return <div style={{ padding: 24, color: '#B91C1C' }}>{err}</div>;
  if (!post) return <div style={{ padding: 24 }}>Not found.</div>;
  return <BlogPostForm initial={post} />;
}
