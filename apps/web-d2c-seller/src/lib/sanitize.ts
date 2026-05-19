import DOMPurify from 'isomorphic-dompurify';

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'blockquote',
  'a',
  'span',
];

const ALLOWED_ATTR = ['href', 'rel', 'target', 'style'];

/**
 * Defense-in-depth sanitizer for seller-authored HTML rendered via
 * dangerouslySetInnerHTML in the seller dashboard. The API applies
 * sanitize-html at write time (see apps/api/src/core/utils/rich-text-sanitizer.ts),
 * but rendering raw HTML from any source without a second pass is fragile:
 * legacy rows, backend-sanitizer regressions, or admin-impersonation views
 * would all expose XSS. Allowlist mirrors the backend plus `style` which
 * the profile page uses for its "no description yet" placeholders.
 */
export function sanitizeRichHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:(?:https?):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
}
