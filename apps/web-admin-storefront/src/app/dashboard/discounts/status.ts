// Phase 243 — single source of truth for discount status -> badge colors.
// Lives in a sibling module (not the route page.tsx) because Next.js 15 App
// Router page files may only have a default export plus reserved exports
// (metadata, generateMetadata, etc.) — a named `STATUS` export from page.tsx
// fails the build. Shared by the list page, the create/edit form sidebar
// badge, and the detail-page lifecycle controls so they render identical
// colors. Covers the operator-settable states plus the abuse-suspend state.
export const STATUS: Record<string, { bg: string; fg: string; dot: string }> = {
  ACTIVE:    { bg: '#dcfce7', fg: '#15803d', dot: '#22c55e' },
  SCHEDULED: { bg: '#fef9c3', fg: '#854d0e', dot: '#eab308' },
  EXPIRED:   { bg: '#f3f4f6', fg: '#6b7280', dot: '#9ca3af' },
  DRAFT:     { bg: '#f3f4f6', fg: '#6b7280', dot: '#9ca3af' },
  PAUSED:    { bg: '#fef3c7', fg: '#92400e', dot: '#f59e0b' },
  ARCHIVED:  { bg: '#e5e7eb', fg: '#4b5563', dot: '#6b7280' },
  SUSPENDED_FOR_ABUSE: { bg: '#fee2e2', fg: '#991b1b', dot: '#ef4444' },
};
