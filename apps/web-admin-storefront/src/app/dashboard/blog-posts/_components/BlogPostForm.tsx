'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import RichTextEditor from '@/components/RichTextEditor';
import {
  adminBlogPostsService,
  type BlogPost,
  type BlogPostStatus,
} from '@/services/admin-blog-posts.service';

interface Props {
  /** Existing post for edit mode; null for create mode. */
  initial: BlogPost | null;
}

/**
 * Shared form for create + edit. In create mode the image upload is
 * disabled until the post has been saved (we need an id to upload
 * against). On save we redirect to the edit page.
 */
export default function BlogPostForm({ initial }: Props) {
  const router = useRouter();
  const editMode = !!initial;

  const [title, setTitle] = useState(initial?.title ?? '');
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [excerpt, setExcerpt] = useState(initial?.excerpt ?? '');
  const [contentHtml, setContentHtml] = useState(initial?.contentHtml ?? '');
  const [author, setAuthor] = useState(initial?.author ?? '');
  const [category, setCategory] = useState(initial?.category ?? 'News');
  const [tagsText, setTagsText] = useState((initial?.tags ?? []).join(', '));
  const [status, setStatus] = useState<BlogPostStatus>(initial?.status ?? 'HIDDEN');
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? '');
  const [metaTitle, setMetaTitle] = useState(initial?.metaTitle ?? '');
  const [metaDesc, setMetaDesc] = useState(initial?.metaDesc ?? '');

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSave() {
    setErr(null);
    if (!title.trim()) {
      setErr('Title is required');
      return;
    }
    setSaving(true);
    try {
      const tags = tagsText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const payload = {
        title: title.trim(),
        slug: slug.trim() || undefined,
        excerpt: excerpt.trim() || null,
        contentHtml,
        author: author.trim() || null,
        category: category.trim() || 'News',
        tags,
        status,
        metaTitle: metaTitle.trim() || null,
        metaDesc: metaDesc.trim() || null,
      };
      if (editMode && initial) {
        await adminBlogPostsService.update(initial.id, payload);
        // Stay on the page; refresh just the data.
        router.refresh();
      } else {
        const res = await adminBlogPostsService.create(payload);
        const newId = res.data?.id;
        if (newId) {
          router.push(`/dashboard/blog-posts/${newId}`);
        } else {
          router.push('/dashboard/blog-posts');
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!initial) {
      setErr('Save the post first, then upload an image.');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setUploading(true);
    setErr(null);
    try {
      const res = await adminBlogPostsService.uploadImage(initial.id, file);
      if (res.data?.imageUrl) setImageUrl(res.data.imageUrl);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: '#0f172a' }}>
          {editMode ? 'Edit blog post' : 'Add blog post'}
        </h1>
      </div>

      {err && (
        <div
          style={{
            padding: 12,
            background: '#FEF2F2',
            border: '1px solid #FCA5A5',
            color: '#B91C1C',
            fontSize: 13,
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          {err}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 320px',
          gap: 24,
          alignItems: 'flex-start',
        }}
      >
        {/* Main column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <label style={lbl}>Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., India's historic victory in the ICC Men's T20 World Cup 2026"
              style={input}
            />

            <label style={lbl}>Content</label>
            <RichTextEditor
              value={contentHtml}
              onChange={setContentHtml}
              placeholder="Write the article body. Add images, headings, links, etc."
              minHeight={320}
            />
          </Card>

          <Card>
            <label style={lbl}>Excerpt</label>
            <textarea
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              placeholder="Add a summary of the post to appear on your home page or blog."
              rows={3}
              style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </Card>

          <Card>
            <label style={lbl}>Search engine listing</label>
            <p style={{ fontSize: 12, color: '#64748B', margin: '0 0 12px' }}>
              How this post appears in a search engine listing.
            </p>
            <label style={subLbl}>Meta title</label>
            <input
              type="text"
              value={metaTitle}
              onChange={(e) => setMetaTitle(e.target.value)}
              placeholder={title || 'Blog post title'}
              style={input}
            />
            <label style={subLbl}>Meta description</label>
            <textarea
              value={metaDesc}
              onChange={(e) => setMetaDesc(e.target.value)}
              placeholder="One-paragraph summary shown in search results."
              rows={3}
              style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }}
            />
            <label style={subLbl}>URL slug</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder={editMode ? initial?.slug : 'auto-generated from title'}
              style={input}
            />
            <p style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
              /blogs/{slug || '<auto>'}
            </p>
          </Card>
        </div>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <label style={lbl}>Visibility</label>
            <label style={radio}>
              <input
                type="radio"
                name="status"
                checked={status === 'VISIBLE'}
                onChange={() => setStatus('VISIBLE')}
              />
              Visible
            </label>
            <label style={radio}>
              <input
                type="radio"
                name="status"
                checked={status === 'HIDDEN'}
                onChange={() => setStatus('HIDDEN')}
              />
              Hidden
            </label>
          </Card>

          <Card>
            <label style={lbl}>Image</label>
            <div
              style={{
                aspectRatio: '16 / 9',
                background: imageUrl
                  ? `#0F1115 url(${imageUrl}) center/cover no-repeat`
                  : 'repeating-linear-gradient(45deg, #F3F4F6 0 8px, #E5E7EB 8px 16px)',
                borderRadius: 8,
                border: '1px solid #E5E7EB',
                marginBottom: 8,
                display: 'grid',
                placeItems: 'center',
                color: '#64748B',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {!imageUrl && 'Add image'}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleUpload}
              disabled={uploading || !editMode}
              style={{ fontSize: 12 }}
            />
            {!editMode && (
              <p style={{ fontSize: 11, color: '#92400E', marginTop: 6 }}>
                Save the post first, then upload an image.
              </p>
            )}
            {uploading && (
              <div style={{ fontSize: 12, color: '#2563EB', marginTop: 4 }}>
                Uploading…
              </div>
            )}
            <p style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
              JPEG / PNG / WebP, ≤ 5 MB. Stored on Cloudinary.
            </p>
          </Card>

          <Card>
            <label style={lbl}>Organization</label>
            <label style={subLbl}>Author</label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Admin name"
              style={input}
            />
            <label style={subLbl}>Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={input}
            >
              <option value="News">News</option>
              <option value="Reviews">Reviews</option>
              <option value="Guides">Guides</option>
              <option value="Announcements">Announcements</option>
            </select>
            <label style={subLbl}>Tags</label>
            <input
              type="text"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="cricket, t20, finals"
              style={input}
            />
            <p style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
              Comma-separated.
            </p>
          </Card>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => router.push('/dashboard/blog-posts')}
              style={ghostBtn}
            >
              Cancel
            </button>
            <div style={{ flex: 1 }} />
            <button onClick={handleSave} disabled={saving} style={primaryBtn}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #E5E7EB',
        borderRadius: 10,
        padding: 20,
      }}
    >
      {children}
    </div>
  );
}

const lbl: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: '#525A65',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 8,
};
const subLbl: React.CSSProperties = { ...lbl, marginTop: 14 };
const input: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid #D2D6DC',
  borderRadius: 8,
  fontSize: 13,
  fontFamily: 'inherit',
  marginBottom: 4,
};
const radio: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  marginBottom: 6,
};
const primaryBtn: React.CSSProperties = {
  background: '#0F1115',
  color: '#fff',
  border: '1px solid #0F1115',
  padding: '8px 18px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
  background: '#fff',
  color: '#0F1115',
  border: '1px solid #D2D6DC',
  padding: '8px 18px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};
