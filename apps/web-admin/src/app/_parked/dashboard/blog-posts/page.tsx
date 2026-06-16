'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  adminBlogPostsService,
  BlogPost,
  BlogPostStatus,
  CreateBlogPostInput,
} from '@/services/admin-blog-posts.service';
import { ApiError } from '@/lib/api-client';
// Reuses the flash-sales stylesheet — same table + drawer grammar
import '../flash-sales/flash-sales.css';

// Lowercase, hyphenated, ascii — used to auto-suggest slugs from
// the title field. Admin can override before saving.
function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function tagsFromInput(s: string): string[] {
  return s
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);
}

function tagsToInput(tags: string[]): string {
  return tags.join(', ');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

type DraftState = {
  title: string;
  // Tracks whether the slug has been manually edited. While false, we
  // keep regenerating the slug from the title on every keystroke;
  // once the admin types in the slug field, we stop overwriting.
  slug: string;
  slugTouched: boolean;
  author: string;
  category: string;
  excerpt: string;
  contentHtml: string;
  imageUrl: string;
  tagsRaw: string;
  status: BlogPostStatus;
  metaTitle: string;
  metaDesc: string;
};

const EMPTY_DRAFT: DraftState = {
  title: '',
  slug: '',
  slugTouched: false,
  author: '',
  category: 'STORY',
  excerpt: '',
  contentHtml: '',
  imageUrl: '',
  tagsRaw: '',
  status: 'VISIBLE',
  metaTitle: '',
  metaDesc: '',
};

function draftFromPost(p: BlogPost): DraftState {
  return {
    title: p.title,
    slug: p.slug,
    slugTouched: true, // existing slug — don't auto-regenerate
    author: p.author ?? '',
    category: p.category ?? 'STORY',
    excerpt: p.excerpt ?? '',
    contentHtml: p.contentHtml ?? '',
    imageUrl: p.imageUrl ?? '',
    tagsRaw: tagsToInput(p.tags ?? []),
    status: p.status,
    metaTitle: p.metaTitle ?? '',
    metaDesc: p.metaDesc ?? '',
  };
}

const FILTERS: Array<{
  key: 'all' | BlogPostStatus;
  label: string;
}> = [
  { key: 'all', label: 'All' },
  { key: 'VISIBLE', label: 'Visible' },
  { key: 'HIDDEN', label: 'Hidden' },
];

export default function BlogPostsPage() {
  const [rows, setRows] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | BlogPostStatus>('all');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [showSeo, setShowSeo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminBlogPostsService.list({
        limit: 100,
        search: search.trim() || undefined,
        status: filter === 'all' ? undefined : filter,
      });
      setRows(res.data?.items ?? []);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[blog-posts] list failed', err);
    } finally {
      setLoading(false);
    }
  }, [search, filter]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Filter counts — derived once per load so the pills always reflect
  // the latest fetch even when a server-side filter is active.
  const counts = useMemo(() => {
    return {
      all: rows.length,
      VISIBLE: rows.filter(r => r.status === 'VISIBLE').length,
      HIDDEN: rows.filter(r => r.status === 'HIDDEN').length,
    };
  }, [rows]);

  const openNew = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setShowSeo(false);
    setError(null);
    setDrawerOpen(true);
  };

  const openEdit = (post: BlogPost) => {
    setEditingId(post.id);
    setDraft(draftFromPost(post));
    setShowSeo(!!(post.metaTitle || post.metaDesc));
    setError(null);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    if (submitting) return;
    setDrawerOpen(false);
  };

  // Title→slug autosync. Stops the moment the admin manually edits
  // the slug field, so they keep custom slugs even if they edit the
  // title afterwards.
  const onTitleChange = (val: string) => {
    setDraft(d => ({
      ...d,
      title: val,
      slug: d.slugTouched ? d.slug : slugify(val),
    }));
  };

  const onSubmit = async () => {
    setError(null);
    if (!draft.title.trim()) {
      setError('Title is required.');
      return;
    }

    const slug = slugify(draft.slug || draft.title);
    if (!slug) {
      setError('Slug could not be generated — try a different title.');
      return;
    }

    const blank = (s: string) => (s.trim() ? s.trim() : null);

    const payload: CreateBlogPostInput = {
      title: draft.title.trim(),
      slug,
      excerpt: blank(draft.excerpt),
      contentHtml: draft.contentHtml.trim() || undefined,
      imageUrl: blank(draft.imageUrl),
      author: blank(draft.author),
      category: draft.category.trim() || 'STORY',
      tags: tagsFromInput(draft.tagsRaw),
      status: draft.status,
      metaTitle: blank(draft.metaTitle),
      metaDesc: blank(draft.metaDesc),
    };

    setSubmitting(true);
    try {
      if (editingId) {
        await adminBlogPostsService.update(editingId, payload);
      } else {
        await adminBlogPostsService.create(payload);
      }
      setDrawerOpen(false);
      await reload();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Save failed';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async (post: BlogPost) => {
    // eslint-disable-next-line no-alert
    if (!confirm(`Delete "${post.title}"? This can't be undone.`)) return;
    try {
      await adminBlogPostsService.remove(post.id);
      await reload();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(
        err instanceof Error ? err.message : 'Delete failed — try again.',
      );
    }
  };

  const drawerTitle = editingId ? 'Edit blog post' : 'New blog post';
  const charCount = draft.excerpt.length;
  const charLimit = 200;

  return (
    <div className="fs-page">
      <div className="fs-header">
        <div>
          <h1>Blog posts</h1>
          <p className="sub">
            Stories surfaced on the mobile home "Stories" rail and the
            web storefront blog. The mobile rail reads title, excerpt,
            cover image, category, and reading time (derived from the
            HTML length).
          </p>
        </div>
        <button className="fs-new-btn" onClick={openNew}>
          + New post
        </button>
      </div>

      {/* Filter + search row */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
        }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {FILTERS.map(f => {
            const isActive = filter === f.key;
            const count = counts[f.key];
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                style={{
                  padding: '7px 14px',
                  borderRadius: 16,
                  border: '1px solid',
                  borderColor: isActive ? '#111827' : '#e5e7eb',
                  background: isActive ? '#111827' : '#fff',
                  color: isActive ? '#fff' : '#374151',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}>
                {f.label}
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: 18,
                    height: 18,
                    padding: '0 6px',
                    borderRadius: 9,
                    background: isActive
                      ? 'rgba(255,255,255,0.18)'
                      : '#f3f4f6',
                    color: isActive ? '#fff' : '#6b7280',
                    fontSize: 10,
                    fontWeight: 700,
                  }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <input
          type="text"
          placeholder="Search by title or slug…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1,
            minWidth: 240,
            padding: '8px 12px',
            border: '1px solid #d1d5db',
            borderRadius: 8,
            fontSize: 13,
          }}
        />
      </div>

      <div className="fs-table-wrap">
        {loading ? (
          <div className="fs-empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="fs-empty">
            {search ? (
              <>No posts match &quot;{search}&quot;.</>
            ) : (
              <>
                No blog posts yet. Click <strong>+ New post</strong>{' '}
                to publish your first one.
              </>
            )}
          </div>
        ) : (
          <table className="fs-table">
            <thead>
              <tr>
                <th>Post</th>
                <th>Category</th>
                <th>Author</th>
                <th>Status</th>
                <th>Updated</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(post => (
                <tr key={post.id}>
                  <td>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                      }}>
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 8,
                          background: '#f3f4f6',
                          backgroundImage: post.imageUrl
                            ? `url(${post.imageUrl})`
                            : undefined,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                          border: '1px solid #e5e7eb',
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            color: '#111827',
                            fontSize: 13,
                          }}>
                          {post.title}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: '#6b7280',
                            marginTop: 2,
                            fontFamily: 'ui-monospace, monospace',
                          }}>
                          /{post.slug}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: 0.5,
                        color: '#5b21b6',
                      }}>
                      {post.category}
                    </span>
                  </td>
                  <td
                    style={{
                      color: '#374151',
                      fontSize: 12,
                    }}>
                    {post.author ?? '—'}
                  </td>
                  <td>
                    <span
                      className={`fs-badge ${
                        post.status === 'VISIBLE' ? 'active' : 'inactive'
                      }`}>
                      {post.status === 'VISIBLE' ? 'Visible' : 'Hidden'}
                    </span>
                  </td>
                  <td style={{ color: '#374151', fontSize: 12 }}>
                    {formatDate(post.updatedAt)}
                  </td>
                  <td>
                    <div className="fs-row-actions">
                      <button
                        className="fs-icon-btn"
                        onClick={() => openEdit(post)}>
                        Edit
                      </button>
                      <button
                        className="fs-icon-btn danger"
                        onClick={() => onDelete(post)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {drawerOpen ? (
        <>
          <div className="fs-drawer-backdrop" onClick={closeDrawer} />
          <aside className="fs-drawer" role="dialog" aria-label={drawerTitle}>
            <div className="fs-drawer-header">
              <h2>{drawerTitle}</h2>
              <button
                className="fs-drawer-close"
                onClick={closeDrawer}
                aria-label="Close">
                ×
              </button>
            </div>

            <div className="fs-drawer-body">
              {error ? <div className="fs-error">{error}</div> : null}

              <div className="fs-field">
                <label>Title</label>
                <input
                  type="text"
                  value={draft.title}
                  onChange={e => onTitleChange(e.target.value)}
                  placeholder="The road-runner playbook"
                  maxLength={200}
                />
              </div>

              <div className="fs-field">
                <label>Slug</label>
                <input
                  type="text"
                  value={draft.slug}
                  onChange={e =>
                    setDraft(d => ({
                      ...d,
                      slug: e.target.value,
                      slugTouched: true,
                    }))
                  }
                  placeholder="the-road-runner-playbook"
                  disabled={!!editingId}
                  style={{
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 13,
                    background: editingId ? '#f9fafb' : undefined,
                  }}
                />
                <div className="hint">
                  {editingId
                    ? 'Slug is immutable after the post is published.'
                    : 'Auto-generated from the title. Edit to customize.'}
                </div>
              </div>

              <div className="fs-row-2">
                <div className="fs-field">
                  <label>Category (eyebrow)</label>
                  <input
                    type="text"
                    value={draft.category}
                    onChange={e =>
                      setDraft(d => ({ ...d, category: e.target.value }))
                    }
                    placeholder="GEAR GUIDE"
                  />
                  <div className="hint">
                    Rendered as the small uppercase tag on the home rail
                    card. Try GEAR GUIDE, PRO INSIGHT, ATHLETE STORY.
                  </div>
                </div>
                <div className="fs-field">
                  <label>Author (optional)</label>
                  <input
                    type="text"
                    value={draft.author}
                    onChange={e =>
                      setDraft(d => ({ ...d, author: e.target.value }))
                    }
                    placeholder="Priya Sharma"
                  />
                </div>
              </div>

              <div className="fs-field">
                <label>Cover image URL</label>
                <input
                  type="text"
                  value={draft.imageUrl}
                  onChange={e =>
                    setDraft(d => ({ ...d, imageUrl: e.target.value }))
                  }
                  placeholder="https://cdn.example.com/blog/cover.jpg"
                />
                {draft.imageUrl ? (
                  <div
                    style={{
                      marginTop: 8,
                      width: 160,
                      height: 100,
                      borderRadius: 8,
                      background: `#f3f4f6 url(${draft.imageUrl}) center/cover`,
                      border: '1px solid #e5e7eb',
                    }}
                  />
                ) : null}
              </div>

              <div className="fs-field">
                <label>Excerpt</label>
                <textarea
                  value={draft.excerpt}
                  onChange={e =>
                    setDraft(d => ({ ...d, excerpt: e.target.value }))
                  }
                  placeholder="8 shoes our coaches actually train in"
                  maxLength={charLimit}
                />
                <div
                  className="hint"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}>
                  <span>
                    Used as the subtitle under the title on the home
                    rail card.
                  </span>
                  <span
                    style={{
                      color:
                        charCount > charLimit * 0.9 ? '#b91c1c' : '#6b7280',
                    }}>
                    {charCount}/{charLimit}
                  </span>
                </div>
              </div>

              <div className="fs-field">
                <label>Content (HTML)</label>
                <textarea
                  value={draft.contentHtml}
                  onChange={e =>
                    setDraft(d => ({ ...d, contentHtml: e.target.value }))
                  }
                  placeholder="<p>Full blog body. The mobile rail only shows the excerpt; this is for the web reading view.</p>"
                  style={{ minHeight: 180, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
                />
                <div className="hint">
                  Mobile reading time is estimated from the length here
                  (~1125 chars ≈ 1 minute). Web storefront renders it
                  as the article body.
                </div>
              </div>

              <div className="fs-field">
                <label>Tags (comma-separated)</label>
                <input
                  type="text"
                  value={draft.tagsRaw}
                  onChange={e =>
                    setDraft(d => ({ ...d, tagsRaw: e.target.value }))
                  }
                  placeholder="running, gear, marathon"
                />
              </div>

              {/* SEO accordion */}
              <div
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  marginBottom: 16,
                  overflow: 'hidden',
                }}>
                <button
                  type="button"
                  onClick={() => setShowSeo(v => !v)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    background: '#fafafa',
                    border: 'none',
                    textAlign: 'left',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#374151',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}>
                  SEO metadata
                  <span style={{ fontSize: 14 }}>
                    {showSeo ? '−' : '+'}
                  </span>
                </button>
                {showSeo ? (
                  <div style={{ padding: 14 }}>
                    <div className="fs-field" style={{ marginBottom: 12 }}>
                      <label>Meta title</label>
                      <input
                        type="text"
                        value={draft.metaTitle}
                        onChange={e =>
                          setDraft(d => ({
                            ...d,
                            metaTitle: e.target.value,
                          }))
                        }
                        placeholder="Overrides the page <title> tag"
                      />
                    </div>
                    <div className="fs-field" style={{ marginBottom: 0 }}>
                      <label>Meta description</label>
                      <textarea
                        value={draft.metaDesc}
                        onChange={e =>
                          setDraft(d => ({
                            ...d,
                            metaDesc: e.target.value,
                          }))
                        }
                        placeholder="Search engine description (150–160 chars)"
                        maxLength={300}
                      />
                    </div>
                  </div>
                ) : null}
              </div>

              <label
                className={`fs-checkbox${
                  draft.status === 'VISIBLE' ? ' on' : ''
                }`}>
                <input
                  type="checkbox"
                  checked={draft.status === 'VISIBLE'}
                  onChange={e =>
                    setDraft(d => ({
                      ...d,
                      status: e.target.checked ? 'VISIBLE' : 'HIDDEN',
                    }))
                  }
                />
                Visible on the storefront — uncheck to keep as a draft
              </label>
            </div>

            <div className="fs-drawer-footer">
              <button className="fs-cancel" onClick={closeDrawer}>
                Cancel
              </button>
              <button
                className="fs-submit"
                onClick={onSubmit}
                disabled={submitting}>
                {submitting
                  ? 'Saving…'
                  : editingId
                    ? 'Save changes'
                    : 'Publish post'}
              </button>
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}
