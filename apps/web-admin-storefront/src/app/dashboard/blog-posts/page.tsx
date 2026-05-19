'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { RequirePermission } from '@/lib/permissions';
import {
  adminBlogPostsService,
  type BlogPost,
} from '@/services/admin-blog-posts.service';
import { ConfirmModal } from '../content/_components/ConfirmModal';

type StatusFilter = 'ALL' | 'VISIBLE' | 'HIDDEN';

export default function BlogPostsPage() {
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
  const [items, setItems] = useState<BlogPost[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<BlogPost | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [hoverRowId, setHoverRowId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await adminBlogPostsService.list({ page, limit: 50, search });
      setItems(res.data?.items ?? []);
      setTotal(res.data?.total ?? 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load blog posts');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function performDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setErr(null);
    try {
      await adminBlogPostsService.remove(deleting.id);
      setDeleting(null);
      void reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed');
      setDeleting(null);
    } finally {
      setDeleteBusy(false);
    }
  }

  const visibleCount = items.filter((i) => i.status === 'VISIBLE').length;
  const hiddenCount = items.length - visibleCount;

  const filteredItems = useMemo(() => {
    if (statusFilter === 'ALL') return items;
    return items.filter((i) => i.status === statusFilter);
  }, [items, statusFilter]);

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1240, margin: '0 auto' }}>
      <header style={headerStyle}>
        <div>
          <div style={eyebrow}>CONTENT</div>
          <h1 style={titleStyle}>Blog posts</h1>
          <p style={subtitleStyle}>
            News, reviews, and articles shown on the customer storefront{' '}
            <code style={inlineCode}>/blogs</code> page.
          </p>
        </div>
        <Link href="/dashboard/blog-posts/new" style={primaryLink}>
          <PlusIcon /> Add blog post
        </Link>
      </header>

      <div style={statsRow}>
        <StatCard
          label="Total posts"
          value={total}
          tone="slate"
          icon={<DocsIcon />}
        />
        <StatCard
          label="Visible"
          value={visibleCount}
          tone="success"
          icon={<EyeIcon />}
        />
        <StatCard
          label="Hidden"
          value={hiddenCount}
          tone="amber"
          icon={<EyeOffIcon />}
        />
      </div>

      <div style={toolbar}>
        <div style={searchWrap}>
          <span style={searchIconSlot}>
            <SearchIcon />
          </span>
          <input
            type="search"
            value={search}
            placeholder="Search by title or slug…"
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            style={searchInput}
          />
        </div>
        <div style={chipGroup}>
          {(['ALL', 'VISIBLE', 'HIDDEN'] as StatusFilter[]).map((s) => {
            const count =
              s === 'ALL' ? total : s === 'VISIBLE' ? visibleCount : hiddenCount;
            const active = statusFilter === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                style={chipStyle(active)}
              >
                {s === 'ALL' ? 'All' : s === 'VISIBLE' ? 'Visible' : 'Hidden'}
                <span style={chipCount(active)}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {err && <div style={errBox}>{err}</div>}

      <div style={tableCard}>
        <div style={tableHead}>
          <span></span>
          <span>Title</span>
          <span>Status</span>
          <span>Author</span>
          <span>Category</span>
          <span>Updated</span>
          <span style={{ textAlign: 'right' }}></span>
        </div>

        {loading ? (
          <div style={emptyState}>
            <Spinner /> Loading posts…
          </div>
        ) : filteredItems.length === 0 ? (
          <div style={{ ...emptyState, flexDirection: 'column', gap: 6 }}>
            <div style={emptyIcon}>
              <DocsIcon />
            </div>
            <div style={{ fontWeight: 600, color: '#0F172A', fontSize: 14 }}>
              {search || statusFilter !== 'ALL'
                ? 'No matches'
                : 'No blog posts yet'}
            </div>
            <div style={{ fontSize: 12.5, color: '#64748B' }}>
              {search ? (
                <>Nothing matches &ldquo;{search}&rdquo;.</>
              ) : statusFilter !== 'ALL' ? (
                <>Switch the filter to see other posts.</>
              ) : (
                <Link
                  href="/dashboard/blog-posts/new"
                  style={{ color: '#2563EB', textDecoration: 'none', fontWeight: 600 }}
                >
                  Create the first one →
                </Link>
              )}
            </div>
          </div>
        ) : (
          filteredItems.map((p) => (
            <div
              key={p.id}
              style={tableRow(hoverRowId === p.id)}
              onMouseEnter={() => setHoverRowId(p.id)}
              onMouseLeave={() => setHoverRowId(null)}
            >
              <div style={thumb(p.imageUrl)} aria-hidden="true" />
              <div style={{ overflow: 'hidden' }}>
                <Link
                  href={`/dashboard/blog-posts/${p.id}`}
                  style={titleLink}
                >
                  {p.title}
                </Link>
                <div style={{ marginTop: 3 }}>
                  <code style={slugPill}>{p.slug}</code>
                </div>
              </div>
              <div>
                <StatusBadge status={p.status} />
              </div>
              <div style={authorCell}>
                <Avatar name={p.author} />
                <span style={authorName}>{p.author || '—'}</span>
              </div>
              <div>
                <span style={categoryPill}>{p.category}</span>
              </div>
              <div style={dateText}>{formatDate(p.updatedAt)}</div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setDeleting(p)}
                  style={deleteBtn}
                  title="Delete post"
                  aria-label={`Delete ${p.title}`}
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {total > 50 && (
        <div style={paginationRow}>
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            style={pgBtn}
          >
            ← Prev
          </button>
          <span style={pgInfo}>
            Page <strong>{page}</strong> of {Math.ceil(total / 50)}
          </span>
          <button
            disabled={page >= Math.ceil(total / 50)}
            onClick={() => setPage((p) => p + 1)}
            style={pgBtn}
          >
            Next →
          </button>
        </div>
      )}

      {deleting && (
        <ConfirmModal
          title={`Delete "${deleting.title}"?`}
          confirmLabel="Delete post"
          busy={deleteBusy}
          onCancel={() => (deleteBusy ? null : setDeleting(null))}
          onConfirm={performDelete}
          message={
            <>
              <p style={{ margin: 0 }}>
                This permanently removes the post and its slug{' '}
                <code style={inlineCode}>{deleting.slug}</code> from the
                storefront.
              </p>
              <p style={{ marginTop: 10, marginBottom: 0, color: '#64748B', fontSize: 12.5 }}>
                Customer links to this post will return a 404.
              </p>
            </>
          }
        />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: 'slate' | 'success' | 'amber';
  icon: React.ReactNode;
}) {
  const palette = {
    slate: { bg: '#F1F5F9', fg: '#0F172A' },
    success: { bg: '#DCFCE7', fg: '#15803D' },
    amber: { bg: '#FEF3C7', fg: '#B45309' },
  }[tone];
  return (
    <div style={statCard}>
      <div style={{ ...statIcon, background: palette.bg, color: palette.fg }}>
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={statLabel}>{label}</div>
        <div style={statValue}>{value}</div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: 'VISIBLE' | 'HIDDEN' }) {
  const isVisible = status === 'VISIBLE';
  return (
    <span style={isVisible ? badgeVisible : badgeHidden}>
      <span style={isVisible ? dotVisible : dotHidden} />
      {isVisible ? 'Visible' : 'Hidden'}
    </span>
  );
}

function Avatar({ name }: { name: string | null }) {
  const initials = (name || '?')
    .trim()
    .split(/\s+/)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2);
  const colour = pickAvatarColour(name || 'anon');
  return (
    <div
      style={{
        ...avatar,
        background: colour.bg,
        color: colour.fg,
      }}
      aria-hidden="true"
    >
      {initials || '?'}
    </div>
  );
}

function pickAvatarColour(seed: string) {
  const palette = [
    { bg: '#E0F2FE', fg: '#075985' },
    { bg: '#FCE7F3', fg: '#9D174D' },
    { bg: '#FEF3C7', fg: '#92400E' },
    { bg: '#DCFCE7', fg: '#166534' },
    { bg: '#EDE9FE', fg: '#5B21B6' },
    { bg: '#FFE4E6', fg: '#9F1239' },
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/* ---------- inline SVG icons ---------- */
function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
function DocsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </svg>
  );
}
function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
function Spinner() {
  return (
    <>
      <style>{`@keyframes bp-spin{to{transform:rotate(360deg)}}`}</style>
      <span
        style={{
          display: 'inline-block',
          width: 14,
          height: 14,
          border: '2px solid #E2E8F0',
          borderTopColor: '#64748B',
          borderRadius: '50%',
          animation: 'bp-spin 0.7s linear infinite',
          marginRight: 10,
          verticalAlign: -2,
        }}
      />
    </>
  );
}

/* ---------- styles ---------- */
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  marginBottom: 20,
  gap: 16,
  flexWrap: 'wrap',
};

const eyebrow: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 1.2,
  color: '#64748B',
  marginBottom: 4,
};

const titleStyle: React.CSSProperties = {
  fontSize: 26,
  fontWeight: 700,
  margin: 0,
  color: '#0F172A',
  letterSpacing: '-0.02em',
};

const subtitleStyle: React.CSSProperties = {
  marginTop: 6,
  fontSize: 13.5,
  color: '#64748B',
  lineHeight: 1.55,
  maxWidth: 560,
};

const inlineCode: React.CSSProperties = {
  fontSize: 11.5,
  background: '#F1F5F9',
  color: '#475569',
  padding: '1px 6px',
  borderRadius: 4,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

const primaryLink: React.CSSProperties = {
  background: '#0F1115',
  color: '#fff',
  border: '1px solid #0F1115',
  padding: '10px 16px',
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 600,
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  boxShadow: '0 1px 0 rgba(0,0,0,0.04), 0 4px 12px -4px rgba(15,17,21,0.25)',
};

const statsRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 12,
  marginBottom: 20,
};

const statCard: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #E5E7EB',
  borderRadius: 12,
  padding: '14px 16px',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  boxShadow: '0 1px 0 rgba(15,23,42,0.02)',
};

const statIcon: React.CSSProperties = {
  flexShrink: 0,
  width: 38,
  height: 38,
  borderRadius: 10,
  display: 'grid',
  placeItems: 'center',
};

const statLabel: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 600,
  letterSpacing: 0.4,
  color: '#64748B',
  textTransform: 'uppercase',
};

const statValue: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: '#0F172A',
  lineHeight: 1.15,
  letterSpacing: '-0.01em',
};

const toolbar: React.CSSProperties = {
  marginBottom: 12,
  display: 'flex',
  gap: 12,
  alignItems: 'center',
  flexWrap: 'wrap',
};

const searchWrap: React.CSSProperties = {
  position: 'relative',
  flex: '1 1 280px',
  maxWidth: 360,
};

const searchIconSlot: React.CSSProperties = {
  position: 'absolute',
  left: 12,
  top: '50%',
  transform: 'translateY(-50%)',
  color: '#94A3B8',
  pointerEvents: 'none',
  display: 'inline-flex',
};

const searchInput: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px 9px 34px',
  border: '1px solid #D2D6DC',
  borderRadius: 10,
  fontSize: 13,
  background: '#fff',
  outline: 'none',
};

const chipGroup: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  borderBottom: '1px solid #E5E7EB',
};

const chipStyle = (active: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 14px',
  marginBottom: -1,
  fontSize: 13,
  fontWeight: 600,
  background: 'transparent',
  border: 'none',
  borderBottom: active ? '2px solid #0F1115' : '2px solid transparent',
  color: active ? '#0F1115' : '#525A65',
  cursor: 'pointer',
  fontFamily: 'inherit',
  transition: 'color 120ms ease, border-color 120ms ease',
});

const chipCount = (active: boolean): React.CSSProperties => ({
  fontSize: 11,
  fontWeight: 600,
  background: active ? '#0F1115' : '#F3F4F6',
  color: active ? '#fff' : '#525A65',
  padding: '1px 7px',
  borderRadius: 9999,
  fontVariantNumeric: 'tabular-nums',
});

const errBox: React.CSSProperties = {
  padding: 12,
  background: '#FEF2F2',
  border: '1px solid #FCA5A5',
  color: '#B91C1C',
  fontSize: 13,
  borderRadius: 8,
  marginBottom: 12,
};

const tableCard: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #E5E7EB',
  borderRadius: 12,
  overflow: 'hidden',
  boxShadow: '0 1px 0 rgba(15,23,42,0.02)',
};

const gridCols = '64px minmax(260px, 1fr) 110px 180px 130px 130px 44px';

const tableHead: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: gridCols,
  gap: 12,
  padding: '12px 18px',
  background: '#F8FAFC',
  borderBottom: '1px solid #E5E7EB',
  fontSize: 10.5,
  fontWeight: 700,
  color: '#64748B',
  textTransform: 'uppercase',
  letterSpacing: 0.6,
};

const tableRow = (hover: boolean): React.CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: gridCols,
  gap: 12,
  padding: '14px 18px',
  borderBottom: '1px solid #F1F5F9',
  alignItems: 'center',
  fontSize: 13,
  background: hover ? '#F8FAFC' : '#fff',
  transition: 'background 100ms ease',
});

const thumb = (url: string | null): React.CSSProperties => ({
  width: 48,
  height: 48,
  borderRadius: 8,
  background: url
    ? `#F1F5F9 url(${url}) center/cover no-repeat`
    : 'linear-gradient(135deg, #F1F5F9 0%, #E2E8F0 100%)',
  border: '1px solid #E5E7EB',
  flexShrink: 0,
});

const titleLink: React.CSSProperties = {
  color: '#0F172A',
  fontWeight: 600,
  textDecoration: 'none',
  display: 'block',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  fontSize: 13.5,
};

const slugPill: React.CSSProperties = {
  fontSize: 11,
  color: '#64748B',
  background: '#F1F5F9',
  padding: '1px 6px',
  borderRadius: 4,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

const badgeBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11.5,
  fontWeight: 600,
  padding: '3px 10px 3px 8px',
  borderRadius: 999,
  border: '1px solid',
};

const badgeVisible: React.CSSProperties = {
  ...badgeBase,
  background: '#F0FDF4',
  color: '#15803D',
  borderColor: '#BBF7D0',
};

const badgeHidden: React.CSSProperties = {
  ...badgeBase,
  background: '#FFFBEB',
  color: '#B45309',
  borderColor: '#FDE68A',
};

const dotBase: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  display: 'inline-block',
};

const dotVisible: React.CSSProperties = { ...dotBase, background: '#22C55E' };
const dotHidden: React.CSSProperties = { ...dotBase, background: '#F59E0B' };

const authorCell: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  overflow: 'hidden',
};

const avatar: React.CSSProperties = {
  flexShrink: 0,
  width: 26,
  height: 26,
  borderRadius: '50%',
  display: 'grid',
  placeItems: 'center',
  fontSize: 10.5,
  fontWeight: 700,
};

const authorName: React.CSSProperties = {
  color: '#334155',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const categoryPill: React.CSSProperties = {
  display: 'inline-block',
  fontSize: 11.5,
  fontWeight: 600,
  color: '#3730A3',
  background: '#EEF2FF',
  border: '1px solid #C7D2FE',
  padding: '2px 9px',
  borderRadius: 999,
};

const dateText: React.CSSProperties = {
  color: '#64748B',
  fontSize: 12.5,
  fontVariantNumeric: 'tabular-nums',
};

const deleteBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid transparent',
  color: '#94A3B8',
  width: 30,
  height: 30,
  borderRadius: 8,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease',
};

const emptyState: React.CSSProperties = {
  padding: 48,
  textAlign: 'center',
  fontSize: 13,
  color: '#64748B',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const emptyIcon: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 12,
  background: '#F1F5F9',
  color: '#94A3B8',
  display: 'grid',
  placeItems: 'center',
  margin: '0 auto 4px',
};

const paginationRow: React.CSSProperties = {
  marginTop: 16,
  display: 'flex',
  gap: 8,
  justifyContent: 'center',
  alignItems: 'center',
};

const pgBtn: React.CSSProperties = {
  padding: '6px 14px',
  border: '1px solid #D2D6DC',
  borderRadius: 8,
  background: '#fff',
  fontSize: 12.5,
  fontWeight: 600,
  color: '#334155',
  cursor: 'pointer',
};

const pgInfo: React.CSSProperties = {
  fontSize: 12.5,
  color: '#64748B',
  padding: '0 8px',
};
